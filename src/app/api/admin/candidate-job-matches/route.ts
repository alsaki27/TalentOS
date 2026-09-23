import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const reviewStatus = ["pending", "approved", "rejected", "all"].includes(status) ? status : "pending";
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit")) || 100));
  const items = await query<any>(
    `SELECT d.id, d.run_id, d.candidate_id, c.name AS candidate_name,
            d.base_resume_id, br.name AS base_resume_name, d.job_id,
            j.title AS job_title, j.company, j.location, j.source_url, j.posted_at,
            d.score, d.tier, d.outcome, d.reason, d.matched_terms,
            d.dismissed_term_hits, d.score_breakdown, d.hard_gates,
            d.review_status, d.review_note, d.reviewed_at, d.application_id,
            d.created_at, r.mode, r.status AS run_status
       FROM candidate_job_match_decisions d
       JOIN candidate_job_match_runs r ON r.id = d.run_id
       JOIN candidates c ON c.id = d.candidate_id
       JOIN base_resumes br ON br.id = d.base_resume_id
       JOIN jobs j ON j.id = d.job_id
      WHERE d.outcome = 'recommended'
        AND ($1 = 'all' OR d.review_status = $1)
      ORDER BY CASE d.review_status WHEN 'pending' THEN 0 ELSE 1 END,
               d.score DESC, d.created_at DESC
      LIMIT $2`,
    [reviewStatus, limit],
  );
  const counts = await queryOne<any>(
    `SELECT COUNT(*) FILTER (WHERE review_status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE review_status = 'approved')::int AS approved,
            COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS rejected
       FROM candidate_job_match_decisions WHERE outcome = 'recommended'`,
  );
  return NextResponse.json({ items, counts: counts ?? { pending: 0, approved: 0, rejected: 0 } });
}
