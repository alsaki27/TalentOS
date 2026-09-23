// GET /api/application-ai-workflows/overview
// Bulk status view across all AI pipeline workflows at once - built for
// running hundreds of tickets through the pipeline together, where checking
// each workflow by ID individually isn't practical. Returns status counts,
// current concurrency vs the cap (see MAX_CONCURRENT_AI_WORKFLOWS), the list
// of everything currently queued/running, and the most recent failures.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { getAiRuntimeConfig } from "@/server/repositories/aiRuntimeConfigRepository";

export const dynamic = "force-dynamic";

interface OverviewRow {
  id: string;
  status: string;
  current_stage: number;
  last_error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  claim_expires_at: string | null;
  application_id: string;
  candidate_name: string | null;
  job_title: string | null;
  job_company: string | null;
}

export async function GET(_req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;
  const runtimeConfig = await getAiRuntimeConfig();

  const counts = await query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM application_ai_workflows GROUP BY status`
  );

  const activeCount = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM application_ai_workflows
     WHERE status = 'running' AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()`
  );

  const inFlight = await query<OverviewRow>(
    `SELECT w.id, w.status, w.current_stage, w.last_error, w.created_at, w.started_at,
            w.completed_at, w.claim_expires_at, w.application_id,
            c.name AS candidate_name, j.title AS job_title, j.company AS job_company
     FROM application_ai_workflows w
     JOIN applications a ON w.application_id = a.id
     LEFT JOIN candidates c ON a.candidate_id = c.id
     LEFT JOIN jobs j ON a.job_id = j.id
     WHERE w.status IN ('queued', 'running', 'waiting')
     ORDER BY w.created_at ASC
     LIMIT 500`
  );

  const recentFailures = await query<OverviewRow>(
    `SELECT w.id, w.status, w.current_stage, w.last_error, w.created_at, w.started_at,
            w.completed_at, w.claim_expires_at, w.application_id,
            c.name AS candidate_name, j.title AS job_title, j.company AS job_company
     FROM application_ai_workflows w
     JOIN applications a ON w.application_id = a.id
     LEFT JOIN candidates c ON a.candidate_id = c.id
     LEFT JOIN jobs j ON a.job_id = j.id
     WHERE w.status = 'failed'
     ORDER BY w.completed_at DESC NULLS LAST, w.created_at DESC
     LIMIT 50`
  );

  const statusCounts: Record<string, number> = {};
  for (const row of counts ?? []) statusCounts[row.status] = row.n;

  return NextResponse.json({
    concurrency: {
      active: activeCount?.[0]?.n ?? 0,
      max: runtimeConfig.workflow_max_concurrency,
    },
    statusCounts,
    inFlight: inFlight ?? [],
    recentFailures: recentFailures ?? [],
  });
}
