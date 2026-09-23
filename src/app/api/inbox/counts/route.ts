// src/app/api/inbox/counts/route.ts
// GET -> aggregate counts for the /inbox stats strip. Did not exist before
// Chunk E: candidate-dashboard/route.ts returns statusCounts/sourceCounts
// for applications only, and gmail-communications/route.ts returns only a
// single `total`. Two round trips (one per table), each a single
// COUNT(*) FILTER (WHERE ...) query rather than N separate queries.

import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { CLEARANCE_KEYWORDS, clearanceExclusionSql } from "@/lib/mailClearanceFilter";

export const dynamic = "force-dynamic";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const candidateId = (url.searchParams.get("candidateId") || "").trim();
  if (candidateId && !isUuid(candidateId)) {
    return NextResponse.json({ error: "Invalid candidateId." }, { status: 400 });
  }
  const candidateFilter = candidateId || null;

  const [approvalsRow, mailRow, draftsRow, unassignedRow, categoryRows] = await Promise.all([
    queryOne<{
      pending_approvals: number; urgent_approvals: number; needs_reply: number;
      interviews: number; untracked: number; conflicts: number; escalated: number;
      approved_today: number; rejected_today: number;
      handovers_assigned_to_me: number; handovers_overdue: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE ai.type = 'status_change_approval' AND ai.status IN ('open', 'in_progress')
                               AND ai.application_id IS NOT NULL
                               AND ai.proposed_status IS NOT NULL
                               AND approval_app.status IS DISTINCT FROM ai.proposed_status)::int AS pending_approvals,
         COUNT(*) FILTER (WHERE ai.type = 'status_change_approval' AND ai.status IN ('open', 'in_progress')
                                AND ai.priority = 'urgent' AND ai.application_id IS NOT NULL
                                AND ai.proposed_status IS NOT NULL
                                AND approval_app.status IS DISTINCT FROM ai.proposed_status)::int AS urgent_approvals,
         COUNT(*) FILTER (WHERE ai.type = 'needs_reply' AND ai.status IN ('open', 'in_progress'))::int AS needs_reply,
         COUNT(*) FILTER (WHERE ai.type = 'interview_followup' AND ai.status IN ('open', 'in_progress'))::int AS interviews,
         COUNT(*) FILTER (WHERE ai.type = 'untracked_application' AND ai.status IN ('open', 'in_progress'))::int AS untracked,
         COUNT(*) FILTER (WHERE ai.type = 'calendar_conflict' AND ai.status IN ('open', 'in_progress'))::int AS conflicts,
         COUNT(*) FILTER (WHERE ai.status IN ('open', 'in_progress') AND ai.escalated_at IS NOT NULL)::int AS escalated,
         COUNT(*) FILTER (WHERE ai.decision = 'approved' AND ai.decided_at >= date_trunc('day', now()))::int AS approved_today,
         COUNT(*) FILTER (WHERE ai.decision = 'rejected' AND ai.decided_at >= date_trunc('day', now()))::int AS rejected_today,
         COUNT(*) FILTER (WHERE ai.type = 'team_handover' AND ai.status = 'open' AND ai.assigned_to_user_id = $2)::int AS handovers_assigned_to_me,
         COUNT(*) FILTER (WHERE ai.type = 'team_handover' AND ai.status = 'open' AND ai.assigned_to_user_id = $2 AND ai.due_at < now())::int AS handovers_overdue
       FROM action_items ai
       LEFT JOIN applications approval_app ON approval_app.id = ai.application_id
       WHERE ($1::uuid IS NULL OR ai.candidate_id = $1)`,
      [candidateFilter, context.profile.user_id],
    ),
    queryOne<{ relevant: number; awaiting_reply: number; hidden: number; total: number; last_message_at: string | null }>(
      // Count at the THREAD level, not the email level, using the same
      // representative-row logic (most recent message per gmail_thread_id)
      // that the mail list itself uses. This ensures "Inbox (N)" in the tab
      // matches the number of conversations the user actually sees.
      `WITH thread_reps AS (
         SELECT ec.*,
                ROW_NUMBER() OVER (
                  PARTITION BY ec.gmail_thread_id
                  ORDER BY ec.sent_at DESC, ec.id DESC
                ) AS thread_row
           FROM email_communications ec
           LEFT JOIN applications a  ON a.id  = ec.ai_matched_application_id
           LEFT JOIN jobs         j  ON j.id  = a.job_id
          WHERE ec.direction = 'inbound'
            AND ($1::uuid IS NULL OR ec.candidate_id = $1)
            AND ${clearanceExclusionSql("$2")}
       )
       SELECT
         -- Threads visible in the default inbox view:
         -- relevant, not suppressed, and not currently pending an approval action.
         COUNT(*) FILTER (
           WHERE thread_row = 1
             AND ai_relevant IS DISTINCT FROM false
             AND suppression_reason IS NULL
             AND NOT EXISTS (
               SELECT 1
                 FROM action_items ai3
                 JOIN applications approval_app3
                   ON approval_app3.id = ai3.application_id
                WHERE ai3.email_communication_id = thread_reps.id
                  AND ai3.type = 'status_change_approval'
                  AND ai3.status IN ('open', 'in_progress')
                  AND ai3.proposed_status IS NOT NULL
                  AND approval_app3.status IS DISTINCT FROM ai3.proposed_status
             )
         )::int AS relevant,
         COUNT(*) FILTER (WHERE thread_row = 1 AND needs_reply AND replied_at IS NULL)::int AS awaiting_reply,
         COUNT(*) FILTER (WHERE thread_row = 1 AND suppression_reason IS NOT NULL)::int AS hidden,
         COUNT(*) FILTER (WHERE thread_row = 1)::int AS total,
         MAX(sent_at) AS last_message_at
       FROM thread_reps`,
      [candidateFilter, CLEARANCE_KEYWORDS],
    ),
    queryOne<{ total_drafts: number }>(
      `SELECT COUNT(*)::int AS total_drafts
       FROM inbox_drafts
       WHERE sent_at IS NULL AND discarded_at IS NULL AND ($1::uuid IS NULL OR candidate_id = $1)`,
      [candidateFilter]
    ),
    // candidateFilter is intentionally ignored here - an unassigned message
    // has no candidate_id to filter by; this is a system-wide queue.
    queryOne<{ total_unassigned: number }>(
      `SELECT COUNT(*)::int AS total_unassigned FROM email_communications WHERE candidate_id IS NULL AND direction = 'inbound'`
    ),
    // Category breakdown for the clickable category chips - scoped to the
    // same "clean" default view the mail list itself shows (relevant mail,
    // federal/clearance jobs excluded), so the counts on each chip match
    // what clicking it will actually return.
    query<{ category: string | null; count: number }>(
      `SELECT ec.ai_category AS category, COUNT(*)::int AS count
         FROM email_communications ec
         LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
         LEFT JOIN jobs j ON j.id = a.job_id
        WHERE ec.direction = 'inbound'
          AND ($1::uuid IS NULL OR ec.candidate_id = $1)
          AND ec.suppression_reason IS NULL AND ec.ai_relevant IS DISTINCT FROM false
          AND ${clearanceExclusionSql("$2")}
        GROUP BY ec.ai_category
        ORDER BY count DESC`,
      [candidateFilter, CLEARANCE_KEYWORDS]
    ),
  ]);

  return NextResponse.json({
    approvals: {
      pending: approvalsRow?.pending_approvals ?? 0,
      urgent: approvalsRow?.urgent_approvals ?? 0,
      approvedToday: approvalsRow?.approved_today ?? 0,
      rejectedToday: approvalsRow?.rejected_today ?? 0,
    },
    tasks: {
      needsReply: approvalsRow?.needs_reply ?? 0,
      interviews: approvalsRow?.interviews ?? 0,
      untracked: approvalsRow?.untracked ?? 0,
      conflicts: approvalsRow?.conflicts ?? 0,
      escalated: approvalsRow?.escalated ?? 0,
    },
    mail: {
      relevant: mailRow?.relevant ?? 0,
      awaitingReply: mailRow?.awaiting_reply ?? 0,
      hidden: mailRow?.hidden ?? 0,
      total: mailRow?.total ?? 0,
      lastMessageAt: mailRow?.last_message_at ?? null,
    },
    drafts: {
      total: draftsRow?.total_drafts ?? 0,
    },
    unassigned: {
      total: unassignedRow?.total_unassigned ?? 0,
    },
    handovers: {
      assignedToMe: approvalsRow?.handovers_assigned_to_me ?? 0,
      overdue: approvalsRow?.handovers_overdue ?? 0,
    },
    categories: (categoryRows ?? [])
      .filter((r) => r.category)
      .map((r) => ({ category: r.category as string, count: r.count })),
  });
}
