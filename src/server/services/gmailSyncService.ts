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
  updateGmailBackfillState,
  saveGmailWatch,
  type GmailAccountRow,
} from "@/server/repositories/gmailIntegrationRepository";
import { refreshGmailAccessToken, listMessageIds, listHistory, getMessage, getProfile, modifyMessage, ensureUserLabel, watchGmailMailbox, type GmailMessage } from "@/lib/integrations/gmailApi";
import { triageEmail, INTERVIEW_EXTRACTION_CONFIDENCE, type TriageCandidateContext } from "@/lib/ai/emailTriage";
import { extractInterviewDetails } from "@/lib/ai/emailInterviewExtraction";
import { classifyGmailMessage } from "@/lib/integrations/gmailSuppression";
import { changeApplicationStatus, emailStageTarget } from "@/server/services/applicationStatusService";
import { loadEmailTriagePolicy, decideStatusWrite, type EmailTriagePolicy } from "@/server/services/emailApprovalPolicy";
import { drainRecruitingContactSync, queueRecruitingContact, syncQueuedRecruitingContact } from "@/server/services/skarionCrmContactSyncService";

const UNREPLIED_FOLLOWUP_HOURS = 72;
const BACKFILL_PAGES_PER_RUN = Math.max(1, Number(process.env.GMAIL_BACKFILL_PAGES_PER_RUN || 8));
const BACKFILL_MESSAGES_PER_RUN = Math.max(50, Number(process.env.GMAIL_BACKFILL_MESSAGES_PER_RUN || 1200));
const MESSAGE_FETCH_CONCURRENCY = Math.max(1, Number(process.env.GMAIL_MESSAGE_FETCH_CONCURRENCY || 8));
const SYNC_TIME_BUDGET_MS = Math.max(5_000, Number(process.env.GMAIL_SYNC_TIME_BUDGET_MS || 25_000));
const TRIAGE_MESSAGES_PER_RUN = Math.max(0, Number(process.env.GMAIL_TRIAGE_MESSAGES_PER_RUN || 40));

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

type MessageFetchResult = {
  ids: string[];
  nextBackfillPageToken: string | null;
  backfillComplete: boolean;
  fromHistory: boolean;
};

async function fetchNewMessageIds(accessToken: string, account: GmailAccountRow): Promise<MessageFetchResult> {
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
      return { ids: Array.from(ids), nextBackfillPageToken: null, backfillComplete: true, fromHistory: true };
    } catch {
      // historyId likely expired (Gmail retains ~1 week) — fall through to backfill.
    }
  }

  // Initial import is not date-limited: candidates asked for historical mail.
  // Spam/trash are excluded, while gmailSuppressionReason still prevents
  // personal/promotional messages from being stored or sent to AI triage.
  const page = await listMessageIds(
    accessToken,
    "in:anywhere -in:spam -in:trash",
    account.gmail_backfill_page_token ?? undefined,
  );
  return {
    ids: Array.from(new Set((page.messages ?? []).map((message) => message.id))),
    nextBackfillPageToken: page.nextPageToken ?? null,
    backfillComplete: !page.nextPageToken,
    fromHistory: false,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function tryAccountLock(accountId: string): Promise<boolean> {
  const row = await queryOne<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
    [`gmail-sync:${accountId}`],
  );
  return Boolean(row?.locked);
}

async function releaseAccountLock(accountId: string) {
  await execute("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`gmail-sync:${accountId}`]);
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
        gmail_label_ids, gmail_is_unread, gmail_is_important, attachment_metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (gmail_message_id) DO NOTHING
     RETURNING id`,
    [candidateId, integrationAccountId, msg.id, msg.threadId, msg.direction, msg.from, msg.to, msg.subject, msg.snippet, msg.bodyText, msg.sentAt, msg.labelIds, msg.labelIds.includes("UNREAD"), msg.labelIds.includes("IMPORTANT"), JSON.stringify(msg.attachments)]
  );

  if (row && msg.from) {
    const contactEmail = msg.from.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() || msg.from.trim().toLowerCase();
    const contactName = msg.from.match(/^\s*(.*?)\s*<[^>]+>/)?.[1]?.trim() || null;
    await execute(
      `INSERT INTO gmail_contact_profiles (candidate_id, email, display_name, last_seen_at, inbound_count, outbound_count, last_subject)
       VALUES ($1, $2, $3, now(), CASE WHEN $4 = 'inbound' THEN 1 ELSE 0 END, CASE WHEN $4 = 'outbound' THEN 1 ELSE 0 END, $5)
       ON CONFLICT (candidate_id, email) DO UPDATE SET
         display_name = COALESCE(EXCLUDED.display_name, gmail_contact_profiles.display_name),
         last_seen_at = now(),
         inbound_count = gmail_contact_profiles.inbound_count + EXCLUDED.inbound_count,
         outbound_count = gmail_contact_profiles.outbound_count + EXCLUDED.outbound_count,
         last_subject = EXCLUDED.last_subject`,
      [candidateId, contactEmail, contactName, msg.direction, msg.subject]
    );
  }

  if (row && msg.direction === "outbound") {
    // An outbound reply in this thread clears "needs_reply" on any prior
    // unanswered inbound message in the same thread.
    await execute(
      `UPDATE email_communications SET needs_reply = false, replied_at = $1, workflow_state = 'resolved', escalation_level = 0
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

// Exported for src/test/services/gmailSyncService.triageStoredMessage.test.ts,
// which asserts the status_change_approval proposal insert always uses
// resolution_rule='manual_only' - the easiest bug to introduce here, since a
// 'manual_or_thread_reply' proposal would be silently auto-closed by
// storeRawMessage's thread-reply sweep the moment anyone replied in-thread.
//
// policyOverride lets tests and the retriage service (Chunk H) inject the
// email_triage approval policy deterministically instead of hitting the DB
// (and the 60s module-scope cache) on every call.
export async function triageStoredMessage(id: string, accessToken: string, policyOverride?: EmailTriagePolicy) {
  const row = await queryOne<{
    id: string; candidate_id: string; subject: string | null; snippet: string | null; body_text: string; from_email: string | null; direction: string; gmail_message_id: string;
  }>(
    "SELECT id, candidate_id, subject, snippet, body_text, from_email, direction, gmail_message_id FROM email_communications WHERE id = $1",
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
  const verdict = classifyGmailMessage({ from: row.from_email, subject: row.subject, snippet: row.snippet, bodyText });
  const senderAddress = (row.from_email || "").match(/<([^>]+)>/)?.[1]?.toLowerCase() || (row.from_email || "").toLowerCase();
  const senderDomain = senderAddress.split("@")[1] || null;
  const senderRule = await queryOne<{ sender_class: string; creates_tasks: boolean; can_change_stage: boolean }>(
    `SELECT sender_class, creates_tasks, can_change_stage FROM gmail_sender_rules
      WHERE (sender_email IS NOT NULL AND lower(sender_email) = $1)
         OR (sender_domain IS NOT NULL AND lower(sender_domain) = $2)
      ORDER BY sender_email NULLS LAST LIMIT 1`,
    [senderAddress, senderDomain],
  );
  const taskAllowedByRule = senderRule ? senderRule.creates_tasks : true;
  if (verdict.suppress || verdict.storeButHide) {
    // storeButHide is the reachable case here: it passes runGmailSync's
    // pre-storage suppress gate (classifyGmailMessage(msg).suppress is
    // false) so the row gets stored, then lands here. suppress is a
    // defensive fallback for any future caller of triageStoredMessage that
    // skips that gate. Either way: same zero-AI-cost outcome as a
    // pre-storage drop, but recoverable via the "Show hidden mail" toggle
    // since the row still exists — and unlike the old prose-only
    // ai_summary, suppression_reason/suppression_rule are the queryable
    // columns the /inbox UI and hidden-mail count already read.
    await execute(
      `UPDATE email_communications SET
         ai_relevant = false, ai_category = 'other', ai_confidence = 1, ai_summary = $1,
         needs_reply = false, suppression_reason = $2, suppression_rule = $3, triaged_at = now()
       WHERE id = $4`,
      [`Filtered by ${verdict.rule}.`, verdict.reason, verdict.rule, id]
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

  // A sender that structurally cannot receive a reply (no-reply address,
  // job-board alert) can never need one, regardless of what the AI
  // inferred from the message content - this is a logical invariant, not a
  // heuristic, applied on top of the model's own needsReply judgment.
  const needsReply = triage.needsReply && !verdict.forceNeedsReplyFalse;

  await execute(
    `UPDATE email_communications SET
       ai_relevant = $1, ai_category = $2, ai_confidence = $3, ai_summary = $4,
       ai_matched_application_id = $5, needs_reply = $6,
       response_due_at = CASE WHEN $6 THEN now() + CASE $2 WHEN 'interview_invite' THEN interval '12 hours' WHEN 'scheduling' THEN interval '12 hours' WHEN 'offer' THEN interval '8 hours' WHEN 'recruiter_reply' THEN interval '24 hours' ELSE interval '48 hours' END ELSE NULL END,
       workflow_state = CASE WHEN $6 THEN 'needs_action' WHEN NOT $1 THEN 'suppressed' ELSE 'observed' END,
       ai_evidence = jsonb_build_object('category', $2, 'confidence', $3, 'summary', $4, 'matched_application_id', $5),
       triaged_at = now()
     WHERE id = $7`,
    [triage.relevant, triage.category, triage.confidence, triage.summary, triage.matchedApplicationId, needsReply, id]
  );

  if (row.from_email && verdict.senderClass === "human") {
    const contactType = senderRule?.sender_class === "hiring_manager"
      ? "hiring_manager"
      : senderRule?.sender_class === "human_recruiter"
        ? "recruiter"
        : ["interview_invite", "scheduling", "recruiter_reply", "application_invite"].includes(triage.category)
          ? "recruiter"
          : triage.category === "offer" ? "hiring_manager" : "unknown";
    const contactEmail = row.from_email.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() || row.from_email.trim().toLowerCase();
    await execute(
      `UPDATE gmail_contact_profiles SET contact_type = CASE WHEN contact_type = 'unknown' OR $1 = 'hiring_manager' THEN $1 ELSE contact_type END WHERE candidate_id = $2 AND email = $3`,
      [contactType, row.candidate_id, contactEmail]
    );
    if (contactType !== "unknown") {
      const matchedJob = triage.matchedApplicationId
        ? await queryOne<{ company: string | null }>("SELECT j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1", [triage.matchedApplicationId])
        : null;
      await queueRecruitingContact({ candidateId: row.candidate_id, applicationId: triage.matchedApplicationId, emailCommunicationId: id, email: contactEmail, displayName: row.from_email.match(/^\s*(.*?)\s*<[^>]+>/)?.[1]?.trim() || null, contactType, company: matchedJob?.company || null, subject: row.subject });
      const queued = await queryOne<{ id: string }>("SELECT id FROM crm_contact_sync_queue WHERE candidate_id=$1 AND contact_email=$2", [row.candidate_id, contactEmail]);
      if (queued) await syncQueuedRecruitingContact(queued.id);
    }
  }

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
      `INSERT INTO application_email_links
         (application_id, email_communication_id, match_method, match_confidence)
       VALUES ($1, $2, 'ai', $3)
       ON CONFLICT (application_id, email_communication_id) DO UPDATE
         SET match_confidence = EXCLUDED.match_confidence`,
      [triage.matchedApplicationId, id, triage.confidence],
    );
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
      const interviewText = `${row.subject || ""}\n${bodyText}`;
      const cancelled = /\b(cancel(?:led|lation)?|no longer moving forward|position has been filled)\b/i.test(interviewText);
      const rescheduled = /\b(reschedul|new time|different time|calendar update)\b/i.test(interviewText);
      if (cancelled) {
        await execute("UPDATE interview_schedules SET status = 'cancelled' WHERE application_id = $1 AND status NOT IN ('completed','cancelled')", [triage.matchedApplicationId]);
        await execute(
          `INSERT INTO action_items (candidate_id, application_id, email_communication_id, type, title, description, priority, status, resolution_rule, dedupe_key)
           VALUES ($1, $2, $3, 'interview_followup', 'Interview cancellation requires review', 'An email appears to cancel or withdraw an interview. Confirm the application stage and notify the candidate if needed.', 'high', 'open', 'manual_only', $4)
           ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
          [row.candidate_id, triage.matchedApplicationId, id, `email:${id}:interview-cancelled`]
        );
      }
      if (details.scheduledAt && details.confidence >= INTERVIEW_EXTRACTION_CONFIDENCE) {
        const existing = await queryOne<{ id: string }>("SELECT id FROM interview_schedules WHERE application_id = $1 AND scheduled_at = $2 LIMIT 1", [triage.matchedApplicationId, details.scheduledAt]);
        if (existing) {
          await execute("UPDATE interview_schedules SET status = 'scheduled', duration_minutes = COALESCE($2, duration_minutes), location = COALESCE($3, location), meeting_link = COALESCE($4, meeting_link) WHERE id = $1", [existing.id, details.durationMinutes || null, details.location, details.meetingLink]);
        } else await execute(
            "INSERT INTO interview_schedules (application_id, round_number, round_name, scheduled_at, duration_minutes, location, meeting_link, status, created_by) VALUES ($1, 1, $2, $3, $4, $5, $6, 'scheduled', 'email-ai')",
            [triage.matchedApplicationId, rescheduled ? "Rescheduled interview" : "Email-detected interview", details.scheduledAt, details.durationMinutes || 60, details.location, details.meetingLink]
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

  if (triage.category === "application_confirmation" && !triage.matchedApplicationId && verdict.senderClass === "human" && taskAllowedByRule) {
    await execute(
      `INSERT INTO action_items (candidate_id, email_communication_id, type, title, description, suggested_action, priority, status, resolution_rule, dedupe_key)
       VALUES ($1, $2, 'untracked_application', 'Application found outside TalentOS', $3, 'AE: confirm company and role, then add the application manually.', 'high', 'open', 'manual_only', $4)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [row.candidate_id, id, triage.summary, `email:${id}:untracked-application`]
    );
    await execute("UPDATE action_items SET due_at = COALESCE(due_at, now() + interval '48 hours') WHERE email_communication_id = $1 AND type = 'untracked_application'", [id]);
    return;
  }

  const stageTarget = emailStageTarget(triage.category);
  const policy = policyOverride ?? (await loadEmailTriagePolicy());
  const decision = decideStatusWrite(policy, {
    category: triage.category,
    confidence: triage.confidence,
    hasMatchedApplication: Boolean(triage.matchedApplicationId),
    stageTarget,
  });
  const canAutoWrite = decision.action === "auto_write" && (!senderRule || senderRule.can_change_stage);

  // A plausible status-change signal that isn't confident/eligible enough to
  // auto-write yet becomes a proposal for AE review, instead of silently
  // doing nothing or falling into the generic needs_reply bucket below.
  // MUST be resolution_rule='manual_only': storeRawMessage auto-closes any
  // open item with resolution_rule='manual_or_thread_reply' whose source
  // email shares a thread with a later outbound message, which would
  // silently discard a pending decision the moment anyone replied in the
  // thread - a proposal must never be closeable that way.
  let proposalCreated = false;
  if (decision.action === "propose") {
    const proposedFromStatus = applications.find((a) => a.applicationId === triage.matchedApplicationId)?.status ?? null;
    const priority = triage.category === "offer" ? "urgent" : (triage.category === "interview_invite" || triage.category === "rejection") ? "high" : "normal";
    const { rowCount } = await execute(
      `INSERT INTO action_items
         (candidate_id, application_id, email_communication_id, type, title, description, priority, status,
          resolution_rule, dedupe_key, proposed_status, proposed_from_status, ai_confidence, proposal_source,
          approval_policy_at_creation)
       VALUES ($1, $2, $3, 'status_change_approval', $4, $5, $6, 'open',
               'manual_only', $7, $8, $9, $10, 'email_triage', $11)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
      [
        row.candidate_id, triage.matchedApplicationId, id,
        `AI proposes moving application to "${stageTarget}"`,
        triage.summary, priority, `email:${id}:status-approval`,
        stageTarget, proposedFromStatus, triage.confidence, policy.policy,
      ],
    );
    proposalCreated = rowCount > 0;
  }

  if (canAutoWrite) {
    const result = await changeApplicationStatus({
      applicationId: triage.matchedApplicationId!,
      toStatus: stageTarget!,
      actorType: "ai",
      actorName: "Email Triage (AI)",
      source: "email_ai",
      reason: triage.summary || `Email classified as ${triage.category}.`,
      emailCommunicationId: id,
      confidence: triage.confidence,
    });
    if (result.changed) {
      await execute(
        `INSERT INTO action_items
           (candidate_id, application_id, email_communication_id, type, title, description, priority, status,
            resolution_rule, resolution_kind, dedupe_key,
            decision, decided_at, proposed_status, ai_confidence)
         VALUES ($1, $2, $3, 'status_change_review', $4, $5, 'low', 'done',
                 'informational', 'informational', $6,
                 'auto_approved', now(), $7, $8)
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
        [row.candidate_id, triage.matchedApplicationId, id, `Email moved application to "${stageTarget}" (FYI)`, triage.summary, `email:${id}:status-update`, stageTarget, triage.confidence],
      );
      return;
    }
  }

  if (proposalCreated || !taskAllowedByRule) return;

  // A sender that structurally can't receive a reply, or a job-board
  // "application invite" alert (the exact shape behind the historical
  // needs_reply backlog - see gmailSuppression.ts), never gets a generic
  // action item either: there is nothing an AE can actually do with it.
  if (verdict.senderClass !== "human" || triage.category === "application_invite") return;

  // Same corrected needsReply as the email_communications UPDATE above -
  // otherwise a no-reply/job-board sender would still generate a
  // "needs_reply / high priority" action item even though the stored
  // column says false, leaving the actual dashboard backlog undefused.
  const type = needsReply ? "needs_reply" : "status_change_review";
  const priority = triage.category === "offer" ? "urgent" : needsReply ? "high" : "normal";
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
      needsReply ? "Candidate email needs a reply" : `Review: ${triage.category.replace("_", " ")}`,
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
  const overdueEmails = await query<{ id: string; candidate_id: string; ai_matched_application_id: string | null; escalation_level: number }>(
    `SELECT id, candidate_id, ai_matched_application_id, escalation_level
       FROM email_communications
      WHERE needs_reply = true AND replied_at IS NULL
        AND response_due_at IS NOT NULL AND response_due_at < now()
        AND escalation_level < 2`
  );
  for (const email of overdueEmails) {
    await execute("UPDATE email_communications SET escalation_level = escalation_level + 1, last_escalated_at = now(), workflow_state = 'needs_action' WHERE id = $1", [email.id]);
    await logWorkflowEvent({ candidateId: email.candidate_id, applicationId: email.ai_matched_application_id, emailCommunicationId: email.id, eventType: "email_response_escalated", payload: { previousEscalationLevel: email.escalation_level } });
  }
  return overdue.length + overdueEmails.length;
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

async function cleanKnownNonActionableTasks() {
  // Older triage versions could create reply tasks for job-board alerts before
  // sender-class guardrails ran. Keep the email rows for search/audit, but
  // remove the false AE workload deterministically and reversibly.
  const result = await execute(
    `UPDATE action_items ai
        SET status = 'dismissed', resolved_at = COALESCE(resolved_at, now()),
            decision = COALESCE(decision, 'rejected'),
            decision_note = COALESCE(decision_note, 'Automatically dismissed: non-actionable job-board sender')
      FROM email_communications ec
     WHERE ai.email_communication_id = ec.id
       AND ai.type IN ('needs_reply', 'status_change_review', 'untracked_application')
       AND ai.status IN ('open', 'in_progress')
       AND (ec.suppression_rule LIKE 'job_board:%'
            OR lower(COALESCE(ec.from_email, '')) ~ '(indeed|ziprecruiter|glassdoor|monster|linkedin|careerbuilder)')
       AND lower(COALESCE(ec.from_email, '')) NOT LIKE '%recruiter%'
       AND lower(COALESCE(ec.from_email, '')) NOT LIKE '%hiring%'`,
  );
  return result.rowCount;
}

async function triageStoredBacklog(candidateId: string, accessToken: string, limit: number) {
  if (limit <= 0) return 0;
  const rows = await query<{ id: string }>(
    `SELECT id FROM email_communications
      WHERE candidate_id = $1 AND triaged_at IS NULL
      ORDER BY sent_at ASC, id ASC LIMIT $2`,
    [candidateId, limit],
  );
  let processed = 0;
  for (const row of rows) {
    await triageStoredMessage(row.id, accessToken);
    processed++;
  }
  return processed;
}

export async function runGmailSync(options: { retryErrored?: boolean } = {}): Promise<{ accounts: SyncOutcome[]; followUpsEnqueued: number }> {
  const accounts = await listActiveCandidateGmailAccounts(Boolean(options.retryErrored));
  const outcomes: SyncOutcome[] = [];

  for (const accountRow of accounts) {
    const outcome: SyncOutcome = { accountId: accountRow.id, candidateId: accountRow.candidate_id, fetched: 0, triaged: 0, suppressed: 0 };
    const locked = await tryAccountLock(accountRow.id);
    if (!locked) continue;
    const startedAt = Date.now();
    try {
      const account = await getDecryptedGmailAccount(accountRow.id);
      if (!account) continue;

      const accessToken = await ensureFreshAccessToken(account);
      let fetchResult = await fetchNewMessageIds(accessToken, account);
      let pages = 0;
      let processedMessages = 0;
      let triagedMessages = 0;
      while (true) {
        const messages = (await mapWithConcurrency(fetchResult.ids, MESSAGE_FETCH_CONCURRENCY, (messageId) => getMessage(accessToken, messageId, account.email)))
          .filter((msg): msg is GmailMessage => Boolean(msg));
        for (const msg of messages) {
        if (classifyGmailMessage(msg).suppress) {
          outcome.suppressed++;
          continue;
        }
        const storedId = await storeRawMessage(account.candidate_id, account.id, msg);
        outcome.fetched++;
        // Mailbox replication is the critical path.  AI triage is deliberately
        // capped so a large historical page cannot hold the Gmail cursor open
        // for minutes; subsequent scheduled runs continue triage safely.
        if (storedId && triagedMessages < TRIAGE_MESSAGES_PER_RUN) {
          await triageStoredMessage(storedId, accessToken);
          outcome.triaged++;
          triagedMessages++;
        }
          processedMessages++;
        }
        pages++;
        if (fetchResult.fromHistory) break;
        await updateGmailBackfillState(accountRow.id, fetchResult.nextBackfillPageToken, fetchResult.backfillComplete);
        if (fetchResult.backfillComplete || pages >= BACKFILL_PAGES_PER_RUN || processedMessages >= BACKFILL_MESSAGES_PER_RUN || Date.now() - startedAt >= SYNC_TIME_BUDGET_MS) break;
        const nextPage = await listMessageIds(accessToken, "in:anywhere -in:spam -in:trash", fetchResult.nextBackfillPageToken ?? undefined);
        fetchResult = {
          ids: Array.from(new Set((nextPage.messages ?? []).map((message) => message.id))),
          nextBackfillPageToken: nextPage.nextPageToken ?? null,
          backfillComplete: !nextPage.nextPageToken,
          fromHistory: false,
        };
      }
      if (fetchResult.fromHistory || fetchResult.backfillComplete) {
        const profile = await getProfile(accessToken);
        if (profile.historyId) await updateGmailHistoryId(accountRow.id, profile.historyId);
      }
      // Continue older untriaged rows independently of mailbox replication so
      // the queue drains across scheduled runs instead of only classifying the
      // messages imported in the current page.
      const backlogTriaged = await triageStoredBacklog(account.candidate_id, accessToken, TRIAGE_MESSAGES_PER_RUN);
      outcome.triaged += backlogTriaged;
    } catch (err: any) {
      const message = err?.message === "invalid_grant" || err?.message === "no_refresh_token"
        ? "Gmail access was revoked or expired — candidate needs to reconnect."
        : err?.message || "Gmail sync failed";
      outcome.error = message;
      await markGmailAccountError(accountRow.id, message);
    } finally {
      await releaseAccountLock(accountRow.id);
    }
    outcomes.push(outcome);
  }

  await escalateOverdueActionItems();
  await cleanKnownNonActionableTasks();
  await enforceEmailRetention();
  await drainRecruitingContactSync(25);
  const followUpsEnqueued = await enqueueOverdueFollowUps();
  return { accounts: outcomes, followUpsEnqueued };
}

export async function registerGmailWatches() {
  const topic = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topic) throw new Error("GMAIL_PUBSUB_TOPIC is not configured");
  const accounts = await listActiveCandidateGmailAccounts(false);
  const results: Array<{ accountId: string; ok: boolean; error?: string }> = [];
  for (const row of accounts) {
    try {
      const account = await getDecryptedGmailAccount(row.id);
      if (!account) continue;
      const token = await ensureFreshAccessToken(account);
      const watch = await watchGmailMailbox(token, topic);
      await saveGmailWatch(row.id, crypto.randomUUID(), watch.expiration, watch.historyId);
      results.push({ accountId: row.id, ok: true });
    } catch (error: any) { results.push({ accountId: row.id, ok: false, error: error?.message || "watch_failed" }); }
  }
  return results;
}
