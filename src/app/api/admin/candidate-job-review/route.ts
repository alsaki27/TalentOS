import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (auth.response) return auth.response;

  const status = request.nextUrl.searchParams.get("status") || "pending";
  const statuses = status === "all" ? ["pending", "approved", "rejected"] : [status];

  try {
    const [items, counts] = await Promise.all([
      query<any>(
        `SELECT q.id, q.source, q.candidate_id, c.name AS candidate_name,
                q.job_id, j.title AS job_title, j.company, j.apply_url,
                q.base_resume_id, br.name AS base_resume_name,
                q.alternate_resumes, q.ats_score, q.ai_status, q.ai_tier, q.ai_score,
                q.ai_reason, q.ai_failure_reason, q.hard_gates, q.status, q.priority,
                q.assigned_to_user_id, assignee.display_name AS assigned_to_name,
                q.reviewed_by_user_id, reviewer.display_name AS reviewed_by_name,
                q.reviewed_at, q.review_note, q.application_id, q.created_at, q.updated_at
           FROM candidate_job_review_queue q
           JOIN candidates c ON c.id = q.candidate_id
           JOIN jobs j ON j.id = q.job_id
           LEFT JOIN base_resumes br ON br.id = q.base_resume_id
           LEFT JOIN profiles assignee ON assignee.user_id = q.assigned_to_user_id
           LEFT JOIN profiles reviewer ON reviewer.user_id = q.reviewed_by_user_id
          WHERE q.status = ANY($1::text[])
          ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END,
                   CASE q.ai_tier WHEN 'strong' THEN 0 WHEN 'adjacent' THEN 1 WHEN 'stretch' THEN 2 ELSE 3 END,
                   q.created_at DESC
          LIMIT 300`,
        [statuses],
      ),
      query<{ status: string; count: number }>(
        `SELECT status, COUNT(*)::int AS count FROM candidate_job_review_queue GROUP BY status`,
      ),
    ]);
    const countsByStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const row of counts) if (row.status in countsByStatus) (countsByStatus as any)[row.status] = row.count;
    return NextResponse.json({ items, counts: countsByStatus });
  } catch (error) {
    console.error("[candidate-job-review] List failed:", error);
    return NextResponse.json({ error: "Could not load the review queue." }, { status: 500 });
  }
}
