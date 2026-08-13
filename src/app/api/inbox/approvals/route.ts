// src/app/api/inbox/approvals/route.ts
// GET -> list status_change_approval proposals, joined to their source
// email, matched application, and job - with the application's CURRENT
// status included so the UI can warn when it's already moved since the
// proposal was created (e.g. an AE resolved it manually in the queue
// before this proposal was reviewed).

import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// Maps the UI's four tabs (Pending / Approved / Rejected / All) onto the
// actual status/decision columns, so the frontend never needs to know the
// underlying state-machine values (see applicationStatusService/Chunk C).
const VIEW_PREDICATES: Record<string, string> = {
  pending: "ai.status IN ('open', 'in_progress')",
  approved: "ai.decision IN ('approved', 'auto_approved')",
  rejected: "ai.decision = 'rejected'",
  all: "1=1",
};

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "pending";
  const candidateId = (url.searchParams.get("candidateId") || "").trim();
  const priority = (url.searchParams.get("priority") || "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));

  if (!VIEW_PREDICATES[view]) return NextResponse.json({ error: "Invalid view." }, { status: 400 });
  if (candidateId && !isUuid(candidateId)) return NextResponse.json({ error: "Invalid candidateId." }, { status: 400 });
  if (priority && !["low", "normal", "high", "urgent"].includes(priority)) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }

  const params: unknown[] = [];
  const predicates = ["ai.type = 'status_change_approval'", VIEW_PREDICATES[view]];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (candidateId) predicates.push(`ai.candidate_id = ${add(candidateId)}`);
  if (priority) predicates.push(`ai.priority = ${add(priority)}`);

  const whereSql = predicates.join(" AND ");

  const count = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM action_items ai
      WHERE ${whereSql}`,
    params,
  );

  const offsetParam = add((page - 1) * pageSize);
  const limitParam = add(pageSize);
  const items = await query<any>(
    `SELECT ai.id, ai.candidate_id, c.name AS candidate_name, ai.application_id,
            ai.title, ai.description, ai.priority, ai.status, ai.created_at, ai.due_at, ai.escalated_at,
            ai.proposed_status, ai.proposed_from_status, ai.ai_confidence, ai.approval_policy_at_creation,
            ai.decision, ai.decided_at, ai.decision_note, ai.decided_by_user_id,
            ec.id AS email_id, ec.subject, ec.from_email, ec.snippet, ec.sent_at,
            ec.gmail_thread_id, ec.ai_summary, ec.ai_category,
            a.status AS application_current_status,
            j.title AS job_title, j.company AS company_name
       FROM action_items ai
       JOIN candidates c ON c.id = ai.candidate_id
       LEFT JOIN email_communications ec ON ec.id = ai.email_communication_id
       LEFT JOIN applications a ON a.id = ai.application_id
       LEFT JOIN jobs j ON j.id = a.job_id
      WHERE ${whereSql}
      ORDER BY CASE ai.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               ai.created_at DESC
      OFFSET ${offsetParam} LIMIT ${limitParam}`,
    params,
  );

  const total = Number(count?.total || 0);
  return NextResponse.json({ items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
}
