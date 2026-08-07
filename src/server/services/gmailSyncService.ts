// src/server/services/gmailSyncService.ts
// Orchestrates: refresh token -> pull new Gmail messages (incremental history,
// falling back to a bounded backfill) -> store raw -> AI-triage untriaged rows ->
// auto-update application status for high-confidence matches -> create manager
// action items -> track unreplied threads -> enqueue follow-up sequence entries
// via the existing email_sequences engine. Entry point is /api/cron/gmail-sync.

import { query, queryOne, execute } from "@/server/db/neon";
import {
  listActiveCandidateGmailAccounts,
  getDecryptedGmailAccount,
  saveEncryptedGmailTokens,
  markGmailAccountError,
  updateGmailHistoryId,
  type GmailAccountRow,
} from "@/server/repositories/gmailIntegrationRepository";
import { refreshGmailAccessToken, listMessageIds, listHistory, getMessage, type GmailMessage } from "@/lib/integrations/gmailApi";
import { triageEmail, AUTO_WRITE_CATEGORIES, AUTO_WRITE_CONFIDENCE_THRESHOLD, type TriageCandidateContext } from "@/lib/ai/emailTriage";
import { logActivity } from "@/lib/activity";

const UNREPLIED_FOLLOWUP_HOURS = 72;

interface SyncOutcome {
  accountId: string;
  candidateId: string;
  fetched: number;
  triaged: number;
  error?: string;
}

async function ensureFreshAccessToken(account: NonNullable<Awaited<ReturnType<typeof getDecryptedGmailAccount>>>) {
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const needsRefresh = !expiresAt || expiresAt < Date.now() + 60_000;
  if (!needsRefresh) return account.access_token;

  if (!account.refresh_token) {
    throw new Error("no_refresh_token");
  }
  const refreshed = await refreshGmailAccessToken(account.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  await saveEncryptedGmailTokens({ id: account.id, accessToken: refreshed.access_token, tokenExpiresAt: newExpiresAt });
  return refreshed.access_token;
}

async function fetchNewMessageIds(accessToken: string, account: GmailAccountRow, enrolledAt: string | null): Promise<string[]> {
  if (account.gmail_history_id) {
    try {
      const ids = new Set<string>();
      let pageToken: string | undefined;
      let latestHistoryId = account.gmail_history_id;
      do {
        const page = await listHistory(accessToken, account.gmail_history_id, pageToken);
        for (const h of page.history ?? []) {
          for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
        }
        latestHistoryId = page.historyId || latestHistoryId;
        pageToken = page.nextPageToken;
      } while (pageToken);
      await updateGmailHistoryId(account.id, latestHistoryId);
      return Array.from(ids);
    } catch {
      // historyId likely expired (Gmail retains ~1 week) — fall through to backfill.
    }
  }

  const ids = new Set<string>();
  const afterClause = enrolledAt ? `after:${enrolledAt.replace(/-/g, "/")}` : "newer_than:90d";
  const backfillQuery = `${afterClause} -category:promotions -category:social -category:forums`;
  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await listMessageIds(accessToken, backfillQuery, pageToken);
    for (const m of page.messages ?? []) ids.add(m.id);
    pageToken = page.nextPageToken;
    pages++;
  } while (pageToken && pages < 5); // cap: 90-day backfill, ~250 messages max per account per run

  return Array.from(ids);
}

async function getCandidateApplicationContext(candidateId: string): Promise<TriageCandidateContext[]> {
  const rows = await query<{ id: string; title: string; company: string; status: string }>(
    `SELECT a.id, j.title, j.company, a.status
     FROM applications a JOIN jobs j ON a.job_id = j.id
     WHERE a.candidate_id = $1 AND a.status NOT IN ('rejected', 'withdrawn')
     ORDER BY a.applied_at DESC LIMIT 30`,
    [candidateId]
  );
  return rows.map((r) => ({ applicationId: r.id, jobTitle: r.title, company: r.company, status: r.status }));
}

async function storeRawMessage(candidateId: string, integrationAccountId: string, msg: GmailMessage) {
  const existing = await queryOne<{ id: string }>(
    "SELECT id FROM email_communications WHERE gmail_message_id = $1",
    [msg.id]
  );
  if (existing) return null;

  const row = await queryOne<{ id: string }>(
    `INSERT INTO email_communications
       (candidate_id, integration_account_id, gmail_message_id, gmail_thread_id, direction,
        from_email, to_emails, subject, snippet, body_text, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (gmail_message_id) DO NOTHING
     RETURNING id`,
    [candidateId, integrationAccountId, msg.id, msg.threadId, msg.direction, msg.from, msg.to, msg.subject, msg.snippet, msg.bodyText, msg.sentAt]
  );

  if (row && msg.direction === "outbound") {
    // An outbound reply in this thread clears "needs_reply" on any prior
    // unanswered inbound message in the same thread.
    await execute(
      `UPDATE email_communications SET needs_reply = false, replied_at = $1
       WHERE gmail_thread_id = $2 AND direction = 'inbound' AND needs_reply = true AND replied_at IS NULL`,
      [msg.sentAt, msg.threadId]
    );

    // A qualifying outbound message is the machine-verifiable resolution for
    // invitation/reply tasks. Manual takeover remains available for cases
    // where the AE handled the conversation outside Gmail.
    await execute(
      `UPDATE action_items ai
       SET status = 'done', resolved_at = COALESCE(resolved_at, now()),
           resolution_kind = 'outbound_thread_reply',
           resolved_by_email_communication_id = $1
       WHERE ai.status IN ('open', 'in_progress')
         AND ai.resolution_rule = 'manual_or_thread_reply'
         AND EXISTS (
           SELECT 1 FROM email_communications inbound
           WHERE inbound.id = ai.email_communication_id
             AND inbound.gmail_thread_id = $2
             AND inbound.direction = 'inbound'
         )`,
      [row.id, msg.threadId]
    );
  }

  return row?.id ?? null;
}

async function triageStoredMessage(id: string) {
  const row = await queryOne<{
    id: string; candidate_id: string; subject: string | null; body_text: string; from_email: string | null; direction: string;
  }>(
    "SELECT id, candidate_id, subject, body_text, from_email, direction FROM email_communications WHERE id = $1",
    [id]
  );
  if (!row || row.direction !== "inbound") {
    // Outbound messages aren't triaged for status signal — just logged.
    if (row) await execute("UPDATE email_communications SET triaged_at = now() WHERE id = $1", [id]);
    return;
  }

  const applications = await getCandidateApplicationContext(row.candidate_id);
  let triage;
  try {
    triage = await triageEmail({ subject: row.subject, bodyText: row.body_text, fromEmail: row.from_email, applications });
  } catch (err: any) {
    await execute("UPDATE email_communications SET triaged_at = now() WHERE id = $1", [id]);
    return;
  }

  await execute(
    `UPDATE email_communications SET
       ai_relevant = $1, ai_category = $2, ai_confidence = $3, ai_summary = $4,
       ai_matched_application_id = $5, needs_reply = $6, triaged_at = now()
     WHERE id = $7`,
    [triage.relevant, triage.category, triage.confidence, triage.summary, triage.matchedApplicationId, triage.needsReply, id]
  );

  if (!triage.relevant) return;

  // Every relevant message becomes an application timeline note. It is kept
  // internal by default and is deduplicated by source email.
  if (triage.matchedApplicationId) {
    await execute(
      `INSERT INTO application_comments
         (application_id, commenter_name, body, visible_to_candidate, source_type, email_communication_id, ai_confidence)
       VALUES ($1, 'Email Triage (AI)', $2, false, 'email_ai', $3, $4)
       ON CONFLICT (email_communication_id) WHERE email_communication_id IS NOT NULL DO NOTHING`,
      [triage.matchedApplicationId, triage.summary || `Relevant ${triage.category.replace("_", " ")} email detected.`, id, triage.confidence]
    );
  }

  const canAutoWrite =
    triage.matchedApplicationId &&
    triage.suggestedStatus &&
    AUTO_WRITE_CATEGORIES.has(triage.category) &&
    triage.confidence >= AUTO_WRITE_CONFIDENCE_THRESHOLD;

  if (canAutoWrite) {
    await execute("UPDATE applications SET status = $1 WHERE id = $2", [triage.suggestedStatus, triage.matchedApplicationId]);
    await logActivity({
      actorName: "Email Triage (AI)",
      actorType: "ai",
      type: "email_triage_status_change",
      description: `Gmail triage set application status to "${triage.suggestedStatus}" from a ${triage.category} email (confidence ${(triage.confidence * 100).toFixed(0)}%)`,
      entityType: "application",
      entityId: triage.matchedApplicationId!,
    });
    await execute(
      `INSERT INTO action_items
         (candidate_id, application_id, email_communication_id, type, title, description, priority, status,
          resolution_rule, resolution_kind, dedupe_key)
       VALUES ($1, $2, $3, 'status_change_review', $4, $5, 'low', 'done',
               'informational', 'informational', $6)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [
        row.candidate_id,
        triage.matchedApplicationId,
        id,
        `Auto-updated status to "${triage.suggestedStatus}" (FYI)`,
        triage.summary,
        `email:${id}:status-update`,
      ]
    );
    return;
  }

  const type = triage.needsReply ? "needs_reply" : "status_change_review";
  const priority = triage.category === "offer" ? "urgent" : triage.needsReply ? "high" : "normal";
  await execute(
    `INSERT INTO action_items
       (candidate_id, application_id, email_communication_id, type, title, description, suggested_action, priority, status,
        resolution_rule, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open', 'manual_or_thread_reply', $9)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [
      row.candidate_id,
      triage.matchedApplicationId,
      id,
      type,
      triage.needsReply ? "Candidate email needs a reply" : `Review: ${triage.category.replace("_", " ")}`,
      triage.summary,
      triage.suggestedStatus ? `Consider updating application status to "${triage.suggestedStatus}"` : null,
      priority,
      `email:${id}:action`,
    ]
  );
}

async function enqueueOverdueFollowUps() {
  // Anything sitting unreplied past the threshold, that hasn't already been
  // queued, gets nudged into the existing email_sequences/email_queue engine —
  // no new sequencing logic, just a trigger into what's already built.
  const overdue = await query<{ id: string; candidate_id: string }>(
    `SELECT id, candidate_id FROM email_communications
     WHERE needs_reply = true AND replied_at IS NULL
       AND sent_at < now() - interval '${UNREPLIED_FOLLOWUP_HOURS} hours'`
  );

  if (overdue.length === 0) return 0;

  const sequence = await queryOne<{ id: string }>(
    "SELECT id FROM email_sequences WHERE trigger_event = 'gmail_unreplied' AND is_active = true LIMIT 1"
  );
  if (!sequence) return 0; // no sequence configured for this trigger yet — nothing to enqueue into

  const firstStep = await queryOne<{ step_number: number; template_id: string; delay_hours: number }>(
    "SELECT step_number, template_id, delay_hours FROM email_sequence_steps WHERE sequence_id = $1 ORDER BY step_number ASC LIMIT 1",
    [sequence.id]
  );
  if (!firstStep) return 0;

  let enqueued = 0;
  for (const row of overdue) {
    const already = await queryOne<{ id: string }>(
      "SELECT id FROM email_queue WHERE candidate_id = $1 AND sequence_id = $2 AND status = 'pending'",
      [row.candidate_id, sequence.id]
    );
    if (already) continue;
    await execute(
      `INSERT INTO email_queue (candidate_id, sequence_id, step_number, template_id, delay_hours, trigger_at, status)
       VALUES ($1, $2, $3, $4, $5, now(), 'pending')`,
      [row.candidate_id, sequence.id, firstStep.step_number, firstStep.template_id, firstStep.delay_hours]
    );
    enqueued++;
  }
  return enqueued;
}

export async function runGmailSync(): Promise<{ accounts: SyncOutcome[]; followUpsEnqueued: number }> {
  const accounts = await listActiveCandidateGmailAccounts();
  const outcomes: SyncOutcome[] = [];

  for (const accountRow of accounts) {
    const outcome: SyncOutcome = { accountId: accountRow.id, candidateId: accountRow.candidate_id, fetched: 0, triaged: 0 };
    try {
      const account = await getDecryptedGmailAccount(accountRow.id);
      if (!account) continue;

      const accessToken = await ensureFreshAccessToken(account);
      const candidate = await queryOne<{ skarion_enrolled_at: string | null }>(
        "SELECT skarion_enrolled_at FROM candidates WHERE id = $1",
        [account.candidate_id]
      );
      const messageIds = await fetchNewMessageIds(accessToken, account, candidate?.skarion_enrolled_at ?? null);

      for (const messageId of messageIds) {
        const msg = await getMessage(accessToken, messageId, account.email);
        if (!msg) continue;
        const storedId = await storeRawMessage(account.candidate_id, account.id, msg);
        outcome.fetched++;
        if (storedId) {
          await triageStoredMessage(storedId);
          outcome.triaged++;
        }
      }
    } catch (err: any) {
      const message = err?.message === "invalid_grant" || err?.message === "no_refresh_token"
        ? "Gmail access was revoked or expired — candidate needs to reconnect."
        : err?.message || "Gmail sync failed";
      outcome.error = message;
      await markGmailAccountError(accountRow.id, message);
    }
    outcomes.push(outcome);
  }

  const followUpsEnqueued = await enqueueOverdueFollowUps();
  return { accounts: outcomes, followUpsEnqueued };
}
