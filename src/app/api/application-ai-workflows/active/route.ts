// GET /api/application-ai-workflows/active
// Slim endpoint for polling: returns workflow status fields plus the minimum
// candidate/job label data needed to tell cards apart at a glance (a single
// indexed join, not a full application/job hydration). The client diffs by
// id+updated_at and only re-renders changed cards. The board shows every
// workflow updated within the selected 1-7 day window; there is no card-count cap.

import { NextRequest, NextResponse } from "next/server";
import { query as neonQuery } from "@/server/db/neon";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";

// Every other route in this family (dispatch, [id], overview, review) sets
// this explicitly - this was the one exception. Without it, Next.js/OpenNext
// can serve a cached/static response on Cloudflare instead of re-running the
// handler on each poll, which would mean the opportunistic self-dispatch
// fetch below silently never re-fires: confirmed live, a freshly queued
// workflow sat untouched (status/updated_at unchanged) for 5+ minutes despite
// this endpoint being polled repeatedly during that window.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  try {
    const requestedDays = Number.parseInt(new URL(request.url).searchParams.get("days") ?? "3", 10);
    const days = Number.isFinite(requestedDays) ? Math.min(7, Math.max(1, requestedDays)) : 3;

    const rows = await neonQuery<any>(
      `SELECT w.id, w.status, w.current_stage, w.last_error, w.updated_at, w.match_score, w.match_reason,
              w.application_id, w.base_resume_id, w.claim_expires_at,
              c.name AS candidate_name,
              w.config_snapshot -> 'job' ->> 'title' AS job_title,
              w.config_snapshot -> 'job' ->> 'company' AS job_company,
              a.tailored_resume_version_id,
              hp.ats_score, hp.role_fit_score
       FROM application_ai_workflows w
       JOIN applications a ON a.id = w.application_id
       JOIN candidates c ON c.id = a.candidate_id
       LEFT JOIN LATERAL (
         SELECT (data ->> 'atsScore')::numeric AS ats_score,
                (data ->> 'roleFitScore')::numeric AS role_fit_score
         FROM application_ai_artifacts
         WHERE workflow_id = w.id AND automation_id = 'application_hiring_panel'
         ORDER BY created_at DESC LIMIT 1
       ) hp ON true
       WHERE w.updated_at >= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY w.updated_at DESC`,
      [days]
    );

    // Keep opportunistic dispatch independent from the board's selected
    // display window so an older queued/stalled workflow is still recovered.
    const pendingRows = await neonQuery<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM application_ai_workflows
       WHERE status = 'queued'
          OR (status = 'running' AND claim_expires_at IS NOT NULL AND claim_expires_at < NOW())`
    );

    // A queued workflow or an expired running claim needs the dispatcher.
    // Browser pollers can kick it immediately; the awaited Cloudflare Cron is
    // the durable fallback when no operator page is open.
    //
    // Do not start an AI stage via this polling request's waitUntil: Cloudflare
    // only grants HTTP waitUntil up to 30 seconds after response. The browser
    // pollers issue a separate POST when needsDispatch is true, and an awaited
    // Cloudflare Cron is the durable fallback when no queue page is open.
    const hasQueuedOrStalledWork = (pendingRows[0]?.n ?? 0) > 0;

    // Surface this signal so the application-queue and resume-parsing-status
    // pollers can issue a separate client->server POST when work is waiting.
    return NextResponse.json({ workflows: rows, needsDispatch: hasQueuedOrStalledWork });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
