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

  const [approvalsRow, mailRow, draftsRow, categoryRows] = await Promise.all([
    queryOne<{
      pending_approvals: number; urgent_approvals: number; needs_reply: number;
      interviews: number; untracked: number; conflicts: number; escalated: number;
      approved_today: number; rejected_today: number;
      handovers_assigned_to_me: number; handovers_overdue: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'status_change_approval' AND status IN ('open', 'in_progress'))::int AS pending_approvals,
         COUNT(*) FILTER (WHERE type = 'status_change_approval' AND status IN ('open', 'in_progress') AND priority = 'urgent')::int AS urgent_approvals,
         COUNT(*) FILTER (WHERE type = 'needs_reply' AND status IN ('open', 'in_progress'))::int AS needs_reply,
         COUNT(*) FILTER (WHERE type = 'interview_followup' AND status IN ('open', 'in_progress'))::int AS interviews,
         COUNT(*) FILTER (WHERE type = 'untracked_application' AND status IN ('open', 'in_progress'))::int AS untracked,
         COUNT(*) FILTER (WHERE type = 'calendar_conflict' AND status IN ('open', 'in_progress'))::int AS conflicts,
         COUNT(*) FILTER (WHERE status IN ('open', 'in_progress') AND escalated_at IS NOT NULL)::int AS escalated,
         COUNT(*) FILTER (WHERE decision = 'approved' AND decided_at >= date_trunc('day', now()))::int AS approved_today,
         COUNT(*) FILTER (WHERE decision = 'rejected' AND decided_at >= date_trunc('day', now()))::int AS rejected_today,
         COUNT(*) FILTER (WHERE type = 'team_handover' AND status = 'open' AND assigned_to_user_id = $2)::int AS handovers_assigned_to_me,
         COUNT(*) FILTER (WHERE type = 'team_handover' AND status = 'open' AND due_at < now())::int AS handovers_overdue
       FROM action_items
       WHERE ($1::uuid IS NULL OR candidate_id = $1)`,
      [candidateFilter, context.profile.user_id],
    ),
    queryOne<{ relevant: number; awaiting_reply: number; hidden: number; total: number; last_message_at: string | null }>(
      `SELECT
         COUNT(*) FILTER (WHERE ai_relevant)::int AS relevant,
         COUNT(*) FILTER (WHERE needs_reply AND replied_at IS NULL)::int AS awaiting_reply,
         COUNT(*) FILTER (WHERE suppression_reason IS NOT NULL)::int AS hidden,
         COUNT(*)::int AS total,
         MAX(sent_at) AS last_message_at
       FROM email_communications
       WHERE direction = 'inbound' AND ($1::uuid IS NULL OR candidate_id = $1)`,
      [candidateFilter],
    ),
    queryOne<{ total_drafts: number }>(
      `SELECT COUNT(*)::int AS total_drafts
       FROM inbox_drafts
       WHERE sent_at IS NULL AND discarded_at IS NULL AND ($1::uuid IS NULL OR candidate_id = $1)`,
      [candidateFilter]
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
    handovers: {
      assignedToMe: approvalsRow?.handovers_assigned_to_me ?? 0,
      overdue: approvalsRow?.handovers_overdue ?? 0,
    },
    categories: (categoryRows ?? [])
      .filter((r) => r.category)
      .map((r) => ({ category: r.category as string, count: r.count })),
  });
}
