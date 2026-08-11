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
import { refreshGmailAccessToken, listMessageIds, listHistory, getMessage, getProfile, modifyMessage, ensureUserLabel, type GmailMessage } from "@/lib/integrations/gmailApi";
import { triageEmail, AUTO_WRITE_CATEGORIES, AUTO_WRITE_CONFIDENCE_THRESHOLD, type TriageCandidateContext } from "@/lib/ai/emailTriage";
import { extractInterviewDetails } from "@/lib/ai/emailInterviewExtraction";
import { logActivity } from "@/lib/activity";
import { gmailSuppressionReason } from "@/lib/integrations/gmailSuppression";

const UNREPLIED_FOLLOWUP_HOURS = 72;

interface SyncOutcome {
  accountId: string;
  candidateId: string;
  fetched: number;
  triaged: number;
  suppressed: number;
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
  const enrolledEpoch = enrolledAt ? Math.floor(new Date(enrolledAt).getTime() / 1000) : 0;
  const afterClause = enrolledEpoch > 0 ? `after:${enrolledEpoch}` : "newer_than:90d";
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
        from_email, to_emails, subject, snippet, body_text, sent_at,
        gmail_label_ids, gmail_is_unread, gmail_is_important)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (gmail_message_id) DO NOTHING
     RETURNING id`,
    [candidateId, integrationAccountId, msg.id, msg.threadId, msg.direction, msg.from, msg.to, msg.subject, msg.snippet, msg.bodyText, msg.sentAt, msg.labelIds, msg.labelIds.includes("UNREAD"), msg.labelIds.includes("IMPORTANT")]
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

type EmailStageTarget = "applied" | "interview" | "offer" | "rejected";

function emailStageTarget(category: string): EmailStageTarget | null {
  if (category === "application_confirmation") return "applied";
  if (category === "interview_invite" || category === "scheduling") return "interview";
  if (category === "offer") return "offer";
  if (category === "rejection") return "rejected";
  return null;
}

function shouldAcceptEmailStage(currentStatus: string, target: EmailStageTarget) {
  if (currentStatus === target) return false;
  if (currentStatus === "withdrawn") return false;
  if (currentStatus === "offer" && target !== "offer") return false;
  if (currentStatus === "rejected" && target !== "rejected") return false;
  if (target === "rejected") return currentStatus !== "offer";
  if (target === "interview") return !["offer", "rejected", "withdrawn"].includes(currentStatus);
  if (target === "applied") return !["interview", "offer", "rejected", "withdrawn"].includes(currentStatus);
  return true;
}

async function applyEmailStageDecision(applicationId: string, category: string, confidence: number, summary: string) {
  const target = emailStageTarget(category);
  if (!target) return false;

  const current = await queryOne<{
    status: string;
    ae_stage: string | null;
    application_stage: string | null;
    applied_at: string | null;
  }>(
    "SELECT status, ae_stage, application_stage, applied_at FROM applications WHERE id = $1",
    [applicationId],
  );
  if (!current || !shouldAcceptEmailStage(current.status, target)) return false;

  const now = new Date().toISOString();
  const updated = await queryOne<{ status: string }>(
    `UPDATE applications
        SET status = $2,
            application_stage = $2,
            application_stage_changed_at = $3,
            application_stage_changed_by_name = 'Email Triage (AI)',
            applied_at = CASE WHEN $2 = 'applied' THEN COALESCE(applied_at, $3) ELSE applied_at END,
            updated_at = $3
      WHERE id = $1
      RETURNING status`,
    [applicationId, target, now],
  );
  if (!updated) return false;

  const fromStage = current.application_stage || current.ae_stage || current.status;
  await execute(
    `INSERT INTO application_stage_history
       (application_id, from_stage, to_stage, changed_at, changed_by_name, reason, source)
     VALUES ($1, $2, $3, $4, 'Email Triage (AI)', $5, 'email_ai')`,
    [applicationId, fromStage, target, now, summary || `Email classified as ${category}.`],
  );
  await execute(
    `INSERT INTO application_events (application_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4)`,
    [applicationId, current.status, target, `Email Triage (AI): ${summary || category} (${Math.round(confidence * 100)}% confidence).`],
  );
  await logActivity({
    actorName: "Email Triage (AI)",
    actorType: "ai",
    type: "email_triage_status_change",
    description: `Email triage moved application from "${current.status}" to "${target}" (${Math.round(confidence * 100)}% confidence)`,
    entityType: "application",
    entityId: applicationId,
  });
  return true;
}

async function triageStoredMessage(id: string, accessToken: string) {
  const row = await queryOne<{
    id: string; candidate_id: string; subject: string | null; body_text: string; from_email: string | null; direction: string; gmail_message_id: string;
  }>(
    "SELECT id, candidate_id, subject, body_text, from_email, direction, gmail_message_id FROM email_communications WHERE id = $1",
    [id]
  );
  if (!row || row.direction !== "inbound") {
    // Outbound messages aren't triaged for status signal — just logged.
    if (row) await execute("UPDATE email_communications SET triaged_at = now() WHERE id = $1", [id]);
    return;
  }

  const applications = await getCandidateApplicationContext(row.candidate_id);
  const bodyText = row.body_text || "";
  const subject = (row.subject || "").toLowerCase();
  const suppressionReason = gmailSuppressionReason({ from: row.from_email, subject: row.subject, bodyText });
  if (suppressionReason) {
    await execute(
      "UPDATE email_communications SET ai_relevant = false, ai_category = 'other', ai_confidence = 1, ai_summary = $1, needs_reply = false, triaged_at = now() WHERE id = $2",
      [`Suppressed before AI processing: ${suppressionReason}.`, id]
    );
    return;
  }
  let triage;
  try {
    triage = await triageEmail({ subject: row.subject, bodyText, fromEmail: row.from_email, applications });
  } catch (err: any) {
    await execute("UPDATE email_communications SET triaged_at = now() WHERE id = $1", [id]);
    return;
  }

  const applicationConfirmationSignal = /(application (was )?(received|submitted)|thank you for applying|we received your application|application confirmation|successfully applied)/i.test(subject + "\n" + bodyText);
  if (applicationConfirmationSignal && (!triage.relevant || !triage.matchedApplicationId)) {
    triage.relevant = true;
    triage.category = "application_confirmation";
    triage.needsReply = false;
    triage.summary = triage.matchedApplicationId
      ? "Application confirmation detected."
      : "Application confirmation detected, but no matching TalentOS application was found.";
    triage.confidence = Math.max(triage.confidence, 0.9);
  }

  await execute(
    `UPDATE email_communications SET
       ai_relevant = $1, ai_category = $2, ai_confidence = $3, ai_summary = $4,
       ai_matched_application_id = $5, needs_reply = $6, triaged_at = now()
     WHERE id = $7`,
    [triage.relevant, triage.category, triage.confidence, triage.summary, triage.matchedApplicationId, triage.needsReply, id]
  );

  if (!triage.relevant) return;
  await logWorkflowEvent({ candidateId: row.candidate_id, applicationId: triage.matchedApplicationId, emailCommunicationId: id, eventType: "email_triaged_relevant", payload: { category: triage.category, confidence: triage.confidence, needsReply: triage.needsReply } });

  try {
    const labelName = triage.category === "interview_invite" || triage.category === "scheduling" ? "TalentOS/Interview" : triage.category === "offer" ? "TalentOS/Offer" : "TalentOS/Recruiter";
    const labelId = await ensureUserLabel(accessToken, labelName);
    const addLabels = [labelId];
    if (["interview_invite", "scheduling", "offer", "recruiter_reply"].includes(triage.category)) addLabels.push("STARRED");
    await modifyMessage(accessToken, row.gmail_message_id, addLabels);
    await execute(
      `UPDATE email_communications
          SET gmail_label_ids = ARRAY(
                SELECT DISTINCT unnest(COALESCE(gmail_label_ids, '{}') || $1::text[])
              ),
              gmail_is_starred = $2
        WHERE id = $3`,
      [addLabels, addLabels.includes("STARRED"), id],
    );
  } catch (labelError) {
    console.warn("[Gmail sync] Could not apply Gmail label/star:", labelError);
  }

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

  if (triage.matchedApplicationId && (triage.category === "interview_invite" || triage.category === "scheduling")) {
    try {
      const details = await extractInterviewDetails(row.subject, bodyText);
      await execute("UPDATE email_communications SET interview_details = $1 WHERE id = $2", [JSON.stringify(details), id]);
      if (details.scheduledAt && details.confidence >= 0.75) {
        const existing = await queryOne<{ id: string }>("SELECT id FROM interview_schedules WHERE application_id = $1 AND scheduled_at = $2 LIMIT 1", [triage.matchedApplicationId, details.scheduledAt]);
        if (!existing) await execute(
          "INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, duration_minutes, location, meeting_link, status, created_by) VALUES ($1, 1, $2, $3, $4, $5, $6, 'scheduled', 'email-ai')",
          [triage.matchedApplicationId, "Email-detected interview", details.scheduledAt, details.durationMinutes || 60, details.location, details.meetingLink]
        );
        const conflict = await queryOne<{ id: string }>(
          `SELECT s.id FROM interview_schedules s
           JOIN applications a ON a.id = s.application_id
           WHERE a.candidate_id = $1 AND s.application_id <> $2
             AND s.scheduled_at IS NOT NULL
             AND s.scheduled_at < ($3::timestamptz + ($4 * interval '1 minute'))
             AND (s.scheduled_at + (COALESCE(s.duration_minutes, 60) * interval '1 minute')) > $3::timestamptz
           LIMIT 1`,
          [row.candidate_id, triage.matchedApplicationId, details.scheduledAt, details.durationMinutes || 60]
        );
        if (conflict) {
          await execute(
            `INSERT INTO action_items (candidate_id, application_id, email_communication_id, type, title, description, priority, status, resolution_rule, dedupe_key)
             VALUES ($1, $2, $3, 'calendar_conflict', 'Interview calendar conflict detected', 'Another interview overlaps this scheduled time. AE must resolve the conflict.', 'urgent', 'open', 'manual_only', $4)
             ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
            [row.candidate_id, triage.matchedApplicationId, id, `email:${id}:calendar-conflict`]
          );
        }
      }
      await execute(
        `INSERT INTO action_items (candidate_id, application_id, email_communication_id, type, title, description, priority, status, resolution_rule, dedupe_key)
         VALUES ($1, $2, $3, 'interview_followup', $4, $5, 'urgent', 'open', 'manual_or_thread_reply', $6)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [row.candidate_id, triage.matchedApplicationId, id, details.scheduledAt ? "Interview detected — confirm attendance" : "Interview email detected — review details", details.scheduledAt || "Interview logistics need AE review.", `email:${id}:interview`]
      );
      await execute("UPDATE action_items SET due_at = COALESCE(due_at, now() + interval '24 hours') WHERE email_communication_id = $1 AND status = 'open'", [id]);
    } catch (interviewError) {
      console.warn("[Gmail sync] Interview extraction failed:", interviewError);
    }
  }

  if (triage.category === "application_confirmation" && !triage.matchedApplicationId) {
    await execute(
      `INSERT INTO action_items (candidate_id, email_communication_id, type, title, description, suggested_action, priority, status, resolution_rule, dedupe_key)
       VALUES ($1, $2, 'untracked_application', 'Application found outside TalentOS', $3, 'AE: confirm company and role, then add the application manually.', 'high', 'open', 'manual_only', $4)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [row.candidate_id, id, triage.summary, `email:${id}:untracked-application`]
    );
    await execute("UPDATE action_items SET due_at = COALESCE(due_at, now() + interval '48 hours') WHERE email_communication_id = $1 AND type = 'untracked_application'", [id]);
    return;
  }

  const canAutoWrite =
    triage.matchedApplicationId &&
    (AUTO_WRITE_CATEGORIES.has(triage.category) || triage.category === "application_confirmation") &&
    triage.confidence >= (triage.category === "application_confirmation" ? 0.9 : AUTO_WRITE_CONFIDENCE_THRESHOLD);

  if (canAutoWrite) {
    const changed = await applyEmailStageDecision(triage.matchedApplicationId!, triage.category, triage.confidence, triage.summary);
    if (changed) {
      const stage = emailStageTarget(triage.category);
      await execute(
        `INSERT INTO action_items
           (candidate_id, application_id, email_communication_id, type, title, description, priority, status,
            resolution_rule, resolution_kind, dedupe_key)
         VALUES ($1, $2, $3, 'status_change_review', $4, $5, 'low', 'done',
                 'informational', 'informational', $6)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [row.candidate_id, triage.matchedApplicationId, id, `Email moved application to "${stage}" (FYI)`, triage.summary, `email:${id}:status-update`],
      );
      return;
    }
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
  await execute("UPDATE action_items SET due_at = COALESCE(due_at, now() + CASE WHEN priority = 'high' THEN interval '48 hours' ELSE interval '72 hours' END) WHERE email_communication_id = $1 AND status = 'open'", [id]);
}

async function escalateOverdueActionItems() {
  const overdue = await query<{ id: string; candidate_id: string; application_id: string | null; priority: string }>(
    `SELECT id, candidate_id, application_id, priority FROM action_items
     WHERE status IN ('open', 'in_progress') AND due_at IS NOT NULL AND due_at < now()
       AND escalated_at IS NULL`
  );
  for (const item of overdue) {
    await execute("UPDATE action_items SET priority = 'urgent', escalated_at = now(), escalation_count = escalation_count + 1 WHERE id = $1", [item.id]);
    await logWorkflowEvent({ candidateId: item.candidate_id, applicationId: item.application_id, actionItemId: item.id, eventType: "action_item_escalated", payload: { previousPriority: item.priority } });
  }
  return overdue.length;
}

async function enforceEmailRetention() {
  await execute(
    `DELETE FROM email_communications ec
     USING candidates c
     WHERE ec.candidate_id = c.id
       AND ec.sent_at < now() - (interval '1 day' * c.email_retention_days)`
  );
  await execute(
    `DELETE FROM candidate_email_drafts d
     USING candidates c
     WHERE d.candidate_id = c.id
       AND d.created_at < now() - (interval '1 day' * c.email_retention_days)`
  );
}

async function logWorkflowEvent(params: {
  candidateId: string;
  applicationId?: string | null;
  actionItemId?: string | null;
  emailCommunicationId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
}) {
  await execute(
    `INSERT INTO candidate_workflow_events
       (candidate_id, application_id, action_item_id, email_communication_id, event_type, actor_type, payload)
     VALUES ($1, $2, $3, $4, $5, 'ai', $6)`,
    [params.candidateId, params.applicationId || null, params.actionItemId || null, params.emailCommunicationId || null, params.eventType, JSON.stringify(params.payload || {})]
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

export async function runGmailSync(options: { retryErrored?: boolean } = {}): Promise<{ accounts: SyncOutcome[]; followUpsEnqueued: number }> {
  const accounts = await listActiveCandidateGmailAccounts(Boolean(options.retryErrored));
  const outcomes: SyncOutcome[] = [];

  for (const accountRow of accounts) {
    const outcome: SyncOutcome = { accountId: accountRow.id, candidateId: accountRow.candidate_id, fetched: 0, triaged: 0, suppressed: 0 };
    try {
      const account = await getDecryptedGmailAccount(accountRow.id);
      if (!account) continue;

      const accessToken = await ensureFreshAccessToken(account);
      const candidate = await queryOne<{ email_consent_at: string | null }>(
        "SELECT email_consent_at FROM candidates WHERE id = $1",
        [account.candidate_id]
      );
      const messageIds = await fetchNewMessageIds(accessToken, account, candidate?.email_consent_at ?? null);

      for (const messageId of messageIds) {
        const msg = await getMessage(accessToken, messageId, account.email);
        if (!msg) continue;
        if (gmailSuppressionReason(msg)) {
          outcome.suppressed++;
          continue;
        }
        const storedId = await storeRawMessage(account.candidate_id, account.id, msg);
        outcome.fetched++;
        if (storedId) {
          await triageStoredMessage(storedId, accessToken);
          outcome.triaged++;
        }
      }
      const profile = await getProfile(accessToken);
      if (profile.historyId) await updateGmailHistoryId(accountRow.id, profile.historyId);
    } catch (err: any) {
      const message = err?.message === "invalid_grant" || err?.message === "no_refresh_token"
        ? "Gmail access was revoked or expired — candidate needs to reconnect."
        : err?.message || "Gmail sync failed";
      outcome.error = message;
      await markGmailAccountError(accountRow.id, message);
    }
    outcomes.push(outcome);
  }

  await escalateOverdueActionItems();
  await enforceEmailRetention();
  const followUpsEnqueued = await enqueueOverdueFollowUps();
  return { accounts: outcomes, followUpsEnqueued };
}
