// src/server/services/emailRetriageService.ts
// One-time (but repeatable/resumable), deterministic re-application of
// Chunk A's filter rules to already-stored email - for every message that
// was triaged before those rules existed. Dismisses the action_items the
// new rules would never have created.
//
// Must NOT go in sql/neon_fixes/: that directory re-runs on every deploy
// with no applied-migrations ledger, which would re-dismiss items an AE
// deliberately reopened, forever - the exact failure mode that made the
// deleted Bhaskar Roy base resumes keep reappearing (see
// 061_seed_bhaskar_cad_mechanical_base_resumes.sql's header comment).
// A data cleanup script belongs here, in application code invoked once by
// hand, not in a directory whose entire contract is "runs on every deploy."

import { query, execute } from "@/server/db/neon";
import { classifyGmailMessage } from "@/lib/integrations/gmailSuppression";
import { logActivity } from "@/lib/activity";

export interface RetriageOptions {
  /** Default true. No row is written unless this is explicitly false. */
  dryRun: boolean;
  batchId: string;
  candidateId?: string | null;
  /** Rows scanned per invocation. Default 500. */
  limit?: number;
  /** One-time ai_agent_configs seed from Chunk D's design - sets email_triage
   *  to risk_based/8.5. NOT invoked by default: as of 2026-08-13 the live
   *  row was deliberately set to always_human by explicit user choice, and
   *  this flag would silently override that. Only pass true if that's
   *  actually the intent at the time this runs. */
  applyPolicySeed?: boolean;
}

export interface RetriageSample {
  emailId: string;
  from: string;
  subject: string;
  rule: string;
  effect: "suppressed" | "needs_reply_cleared";
}

export interface RetriageReport {
  batchId: string;
  dryRun: boolean;
  scanned: number;
  remaining: number;
  emailsSuppressed: number;
  emailsNeedsReplyCleared: number;
  actionItemsDismissed: { total: number; byType: Record<string, number> };
  samples: RetriageSample[];
  policySeedApplied: boolean;
}

const DEFAULT_LIMIT = 500;
const SAMPLE_LIMIT = 20;

// Never auto-dismissed, regardless of what the new rules would have done -
// the cost of missing a real interview dwarfs the cost of a stale task.
const PROTECTED_ACTION_ITEM_TYPES = ["interview_followup", "calendar_conflict"];

interface EmailRow {
  id: string;
  candidate_id: string;
  from_email: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  ai_relevant: boolean | null;
  needs_reply: boolean;
}

export async function retriageEmailBacklog(opts: RetriageOptions): Promise<RetriageReport> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const apply = opts.dryRun === false;

  const pageParams: unknown[] = [opts.batchId];
  let candidateFilter = "";
  if (opts.candidateId) {
    candidateFilter = ` AND candidate_id = $${pageParams.length + 1}`;
    pageParams.push(opts.candidateId);
  }
  pageParams.push(limit);
  const limitIdx = pageParams.length;

  // retriage_batch_id IS DISTINCT FROM $1 is what makes a re-run resume
  // rather than redo: rows already stamped with this batch's id in a prior
  // page of the same run are skipped, and a completed run (every row
  // stamped) naturally returns zero rows on the next call.
  const rows = await query<EmailRow>(
    `SELECT id, candidate_id, from_email, subject, snippet, body_text, ai_relevant, needs_reply
       FROM email_communications
      WHERE direction = 'inbound' AND retriage_batch_id IS DISTINCT FROM $1${candidateFilter}
      ORDER BY sent_at DESC
      LIMIT $${limitIdx}`,
    pageParams,
  );

  // Grouped by (reason, rule) rather than a single flat list - classifyGmailMessage
  // can suppress for several distinct reasons (job_board_alert, personal_transaction,
  // bulk_marketing, job_alert) with different rule strings, and suppression_reason/
  // suppression_rule are the queryable columns the /inbox UI's "Hidden by filters"
  // badge and tooltip read (gmail-communications/route.ts, inbox/page.tsx). A single
  // hardcoded label for every suppressed row in the batch would mislabel most of them.
  const suppressGroups = new Map<string, { reason: string; rule: string; ids: string[] }>();
  const suppressIds: string[] = [];
  const needsReplyClearIds: string[] = [];
  const unchangedIds: string[] = [];
  const samples: RetriageSample[] = [];

  // Deterministic only - classifyGmailMessage is the exact same function
  // the live sync path calls, with the exact same field set (from, subject,
  // snippet, bodyText) it receives there. No AI is called: re-running
  // triageEmail over hundreds of stored messages would cost money and
  // produce nondeterministic, unauditable results - the whole reason the
  // new filtering lives in deterministic code rather than the prompt.
  for (const row of rows) {
    const verdict = classifyGmailMessage({ from: row.from_email, subject: row.subject, snippet: row.snippet, bodyText: row.body_text });
    if ((verdict.suppress || verdict.storeButHide) && row.ai_relevant !== false) {
      const reason = verdict.reason || "job_board_alert";
      const key = `${reason}|${verdict.rule}`;
      if (!suppressGroups.has(key)) suppressGroups.set(key, { reason, rule: verdict.rule, ids: [] });
      suppressGroups.get(key)!.ids.push(row.id);
      suppressIds.push(row.id);
      if (samples.length < SAMPLE_LIMIT) samples.push({ emailId: row.id, from: row.from_email || "", subject: row.subject || "", rule: verdict.rule, effect: "suppressed" });
    } else if (verdict.forceNeedsReplyFalse && row.needs_reply) {
      needsReplyClearIds.push(row.id);
      if (samples.length < SAMPLE_LIMIT) samples.push({ emailId: row.id, from: row.from_email || "", subject: row.subject || "", rule: verdict.rule, effect: "needs_reply_cleared" });
    } else {
      unchangedIds.push(row.id);
    }
  }

  let dismissedByType: Record<string, number> = {};

  if (apply) {
    // One array-UPDATE per distinct (reason, rule) group, not one round trip
    // per row - critical on a per-request-billed Worker with an HTTP DB
    // driver, and still far fewer than 500 calls since most pages only
    // surface a handful of distinct rules. Never DELETE: it would lose the
    // audit trail, and the message would just re-import on the next Gmail
    // backfill anyway.
    for (const group of suppressGroups.values()) {
      await execute(
        `UPDATE email_communications
            SET ai_relevant = false, needs_reply = false,
                suppression_reason = $1, suppression_rule = $2,
                retriage_batch_id = $3, retriaged_at = now()
          WHERE id = ANY($4::uuid[])`,
        [group.reason, group.rule, opts.batchId, group.ids],
      );
    }
    if (needsReplyClearIds.length > 0) {
      await execute(
        `UPDATE email_communications
            SET needs_reply = false, retriage_batch_id = $1, retriaged_at = now()
          WHERE id = ANY($2::uuid[])`,
        [opts.batchId, needsReplyClearIds],
      );
    }
    if (unchangedIds.length > 0) {
      await execute(
        `UPDATE email_communications SET retriage_batch_id = $1, retriaged_at = now() WHERE id = ANY($2::uuid[])`,
        [opts.batchId, unchangedIds],
      );
    }

    // Dismiss action items the new rules would never have created.
    // - Suppressed/hidden emails: the email itself would never have
    //   reached AI triage under the new rules, so none of its open items
    //   (except the protected types) should exist either.
    // - needs-reply-cleared emails are still relevant; only the needs_reply
    //   type item (created because the AI thought a reply was needed) is
    //   now wrong - other item types on the same email are untouched.
    const dismissed: { id: string; type: string; candidate_id: string }[] = [];
    if (suppressIds.length > 0) {
      const rows2 = await query<{ id: string; type: string; candidate_id: string }>(
        `UPDATE action_items
            SET status = 'dismissed', resolution_kind = 'dismissed', resolved_at = now(),
                resolution_note = 'Auto-dismissed by re-triage ' || $1 || ': source email reclassified as suppressed/hidden noise.',
                retriage_batch_id = $1, retriage_rule = 'email_suppressed_on_retriage'
          WHERE status IN ('open', 'in_progress')
            AND email_communication_id = ANY($2::uuid[])
            AND type <> ALL($3::text[])
            AND retriage_batch_id IS DISTINCT FROM $1
        RETURNING id, type, candidate_id`,
        [opts.batchId, suppressIds, PROTECTED_ACTION_ITEM_TYPES],
      );
      dismissed.push(...rows2);
    }
    if (needsReplyClearIds.length > 0) {
      const rows3 = await query<{ id: string; type: string; candidate_id: string }>(
        `UPDATE action_items
            SET status = 'dismissed', resolution_kind = 'dismissed', resolved_at = now(),
                resolution_note = 'Auto-dismissed by re-triage ' || $1 || ': sender cannot receive a reply.',
                retriage_batch_id = $1, retriage_rule = 'needs_reply_cleared_on_retriage'
          WHERE status IN ('open', 'in_progress')
            AND type = 'needs_reply'
            AND email_communication_id = ANY($2::uuid[])
            AND retriage_batch_id IS DISTINCT FROM $1
        RETURNING id, type, candidate_id`,
        [opts.batchId, needsReplyClearIds],
      );
      dismissed.push(...rows3);
    }

    for (const item of dismissed) {
      dismissedByType[item.type] = (dismissedByType[item.type] ?? 0) + 1;
      await execute(
        `INSERT INTO candidate_workflow_events (candidate_id, action_item_id, event_type, actor_type, payload)
         VALUES ($1, $2, 'action_item_retriage_dismissed', 'system', $3)`,
        [item.candidate_id, item.id, JSON.stringify({ batchId: opts.batchId })],
      );
    }

    if (dismissed.length > 0) {
      await logActivity({
        actorName: "Email re-triage",
        actorType: "system",
        type: "email_retriage_batch",
        description: `Re-triage batch ${opts.batchId}: ${suppressIds.length} emails suppressed, ${needsReplyClearIds.length} needs_reply cleared, ${dismissed.length} action items dismissed.`,
        entityType: "email_retriage_batch",
        entityId: opts.batchId,
      });
    }

    if (opts.applyPolicySeed) {
      await execute(
        `UPDATE ai_agent_configs SET approval_policy = 'risk_based', minimum_score = 8.5, updated_at = now() WHERE automation_id = 'email_triage'`,
      );
    }
  }

  const remainingParams: unknown[] = [opts.batchId];
  let remainingCandidateFilter = "";
  if (opts.candidateId) {
    remainingCandidateFilter = ` AND candidate_id = $${remainingParams.length + 1}`;
    remainingParams.push(opts.candidateId);
  }
  const remainingRow = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM email_communications
      WHERE direction = 'inbound' AND retriage_batch_id IS DISTINCT FROM $1${remainingCandidateFilter}`,
    remainingParams,
  );

  return {
    batchId: opts.batchId,
    dryRun: !apply,
    scanned: rows.length,
    // Under dryRun this is intentionally the full unscanned total, not just
    // "minus this preview page" - nothing gets marked without apply=true,
    // so a dry run never advances how much is left to do.
    remaining: remainingRow[0]?.n ?? 0,
    emailsSuppressed: suppressIds.length,
    emailsNeedsReplyCleared: needsReplyClearIds.length,
    actionItemsDismissed: {
      total: Object.values(dismissedByType).reduce((a, b) => a + b, 0),
      byType: dismissedByType,
    },
    samples,
    policySeedApplied: apply && Boolean(opts.applyPolicySeed),
  };
}
