import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, CANDIDATE_JOB_REVIEW_ROLES } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { parseCandidateReviewFilters, candidateReviewFilterSql } from "@/lib/candidateReviewFilters";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireCurrentUser(CANDIDATE_JOB_REVIEW_ROLES);
  if (auth.response) return auth.response;

  let filters;
  try { filters = parseCandidateReviewFilters(request.nextUrl.searchParams); }
  catch (error) { return NextResponse.json({error: error instanceof Error ? error.message : "Invalid filters."}, {status:400}); }
  const statuses = filters.status === "all" ? ["pending", "approved", "rejected"] : [filters.status];
  const scope = candidateReviewFilterSql(filters);

  try {
    const [counts, candidates, staff] = await Promise.all([
      query<{status: string; count: number; strong_count: number; adjacent_count: number; stretch_count: number}>(`SELECT q.status,COUNT(*)::int AS count,
        COUNT(*) FILTER(WHERE q.ai_tier='strong')::int AS strong_count,
        COUNT(*) FILTER(WHERE q.ai_tier='adjacent')::int AS adjacent_count,
        COUNT(*) FILTER(WHERE q.ai_tier='stretch')::int AS stretch_count
        FROM candidate_job_review_queue q WHERE ${scope.where} GROUP BY q.status`, scope.values),
      // Picker rosters are independent of queue contents and current filters.
      // Include paused/not-started candidates without enabling their automation.
      query<{id:string; name:string; pipeline_stage:string}>(`SELECT c.id,c.name,COALESCE(c.pipeline_stage,'not_started') AS pipeline_stage
        FROM candidates c WHERE COALESCE(c.pipeline_stage,'not_started') = ANY($1::text[])
        ORDER BY c.name,c.id`, [["applying","not_started","paused"]]),
      query<{id:string; name:string; role:string}>(`SELECT p.user_id AS id,COALESCE(NULLIF(BTRIM(p.display_name),''),'Unnamed staff') AS name,p.role
        FROM profiles p WHERE p.is_active = true AND p.role = ANY($1::text[])
        ORDER BY name,id`, [CANDIDATE_JOB_REVIEW_ROLES]),
    ]);
    const countsByStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const row of counts) if (row.status in countsByStatus) (countsByStatus as any)[row.status] = row.count;
    const total = filters.status === "all" ? Object.values(countsByStatus).reduce((a,b)=>a+b,0) : countsByStatus[filters.status];
    const pageSize = 50;
    const page = Math.min(filters.page, Math.max(1, Math.ceil(total / pageSize)));
    const itemScope = candidateReviewFilterSql(filters, 2);
    const limitParameter = itemScope.values.length + 2;
    const items = await query<any>(
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
          WHERE q.status = ANY($1::text[]) AND ${itemScope.where}
          ORDER BY CASE q.status WHEN 'pending' THEN 0 ELSE 1 END,
                   CASE q.ai_tier WHEN 'strong' THEN 0 WHEN 'adjacent' THEN 1 WHEN 'stretch' THEN 2 ELSE 3 END,
                   q.created_at DESC, q.id DESC
          LIMIT $${limitParameter} OFFSET $${limitParameter + 1}`,
        [statuses,...itemScope.values,pageSize,(page-1)*pageSize],
      );
    const pending = counts.find(row=>row.status==='pending');
    return NextResponse.json({items,counts:countsByStatus,pendingTiers:{strong:pending?.strong_count ?? 0,adjacent:pending?.adjacent_count ?? 0,stretch:pending?.stretch_count ?? 0},filterOptions:{candidates,staff},pagination:{page,pageSize,total}});
  } catch (error) {
    console.error("[candidate-job-review] List failed:", error);
    return NextResponse.json({ error: "Could not load the review queue." }, { status: 500 });
  }
}
