// GET /api/application-ai-workflows/active
// Slim endpoint for polling: returns workflow status fields plus the minimum
// candidate/job label data needed to tell cards apart at a glance (a single
// indexed join, not a full application/job hydration). The client diffs by
// id+updated_at and only re-renders changed cards.

import { NextRequest, NextResponse } from "next/server";
import { query as neonQuery } from "@/server/db/neon";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  try {
    const limit = 50;
    const rows = await neonQuery<any>(
      `SELECT w.id, w.status, w.current_stage, w.last_error, w.updated_at, w.match_score, w.match_reason,
              w.application_id, w.base_resume_id,
              c.name AS candidate_name,
              w.config_snapshot -> 'job' ->> 'title' AS job_title,
              w.config_snapshot -> 'job' ->> 'company' AS job_company,
              a.tailored_resume_version_id
       FROM application_ai_workflows w
       JOIN applications a ON a.id = w.application_id
       JOIN candidates c ON c.id = a.candidate_id
       WHERE w.status IN ('queued', 'running', 'waiting', 'failed')
          OR (w.status IN ('completed', 'cancelled') AND w.updated_at >= NOW() - INTERVAL '2 hours')
       ORDER BY w.updated_at DESC
       LIMIT $1`,
      [limit]
    );
    return NextResponse.json({ workflows: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
