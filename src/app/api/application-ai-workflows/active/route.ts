// GET /api/application-ai-workflows/active
// Slim endpoint for polling: returns workflow status fields plus the minimum
// candidate/job label data needed to tell cards apart at a glance (a single
// indexed join, not a full application/job hydration). The client diffs by
// id+updated_at and only re-renders changed cards.

import { NextRequest, NextResponse } from "next/server";
import { query as neonQuery } from "@/server/db/neon";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { dispatchNextQueuedWorkflow } from "@/server/services/applicationAiWorkflowService";

export async function GET(request: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  try {
    const limit = 50;
    const rows = await neonQuery<any>(
      `SELECT w.id, w.status, w.current_stage, w.last_error, w.updated_at, w.match_score, w.match_reason,
              w.application_id, w.base_resume_id, w.claim_expires_at,
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

    // The in-process chain-dispatch between stages (backgroundDispatch /
    // ctx.waitUntil) doesn't reliably survive in production - documented in
    // scheduled-jobs.yml's own comment - and the GitHub Actions cron meant to
    // catch stalled workflows has been observed running 30-40+ minutes apart
    // instead of its intended ~5 minutes (GitHub Actions cron has no
    // reliability guarantee at that granularity). A 'running' workflow whose
    // claim already expired is stuck until *something* calls the dispatcher.
    // Piggyback that call on this page's own 6s poll - anyone with the
    // status page open becomes a much faster safety net than the cron gap,
    // without blocking this response (dispatchNextQueuedWorkflow is
    // idempotent via SKIP LOCKED, so concurrent pollers are harmless).
    const hasStalledClaim = rows.some(
      (r: any) => r.status === "running" && r.claim_expires_at && new Date(r.claim_expires_at).getTime() < Date.now()
    );
    if (hasStalledClaim) {
      await backgroundDispatch(
        dispatchNextQueuedWorkflow().catch((err) => {
          console.error("[active-workflows-poll] Opportunistic dispatch failed:", err);
        })
      );
    }

    return NextResponse.json({ workflows: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
