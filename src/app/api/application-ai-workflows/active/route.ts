// GET /api/application-ai-workflows/active
// Slim endpoint for polling: returns workflow status fields plus the minimum
// candidate/job label data needed to tell cards apart at a glance (a single
// indexed join, not a full application/job hydration). The client diffs by
// id+updated_at and only re-renders changed cards.

import { NextRequest, NextResponse } from "next/server";
import { query as neonQuery } from "@/server/db/neon";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { backgroundDispatch } from "@/server/lib/waitUntil";

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
    const limit = 50;
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
    // reliability guarantee at that granularity). A workflow that's plainly
    // 'queued' (auto-trigger created the row but the self-fetch chain never
    // fired) or 'running' with an expired claim is stuck until *something*
    // calls the dispatcher.
    //
    // MUST self-fetch a fresh POST to /dispatch rather than calling
    // dispatchNextQueuedWorkflow() directly in-process here. Confirmed live:
    // calling it in-process (wrapped in backgroundDispatch/ctx.waitUntil off
    // this GET request) worked fine for fast stages (Job Lens, ~10-20s on
    // Flash) but every Resume Forge stage (gemini-2.5-pro, meaningfully
    // slower) got orphaned mid-run - claimed, started, then silently
    // abandoned with the stage_run stuck at 'running' forever, eventually
    // exhausting recovery_count and failing with "each claim orphaned
    // without completing or erroring cleanly." A piggybacked waitUntil
    // extension off an already-answered GET apparently doesn't grant the
    // same execution budget as a genuine fresh HTTP invocation - every other
    // dispatch trigger in this codebase (triggerAiWorkflowForApplication,
    // processWorkflowStage's own stage-to-stage continuation) already
    // self-fetches a new request for exactly this reason; this endpoint was
    // the one place that didn't.
    const hasQueuedOrStalledWork = rows.some(
      (r: any) =>
        r.status === "queued" ||
        (r.status === "running" && r.claim_expires_at && new Date(r.claim_expires_at).getTime() < Date.now())
    );
    if (hasQueuedOrStalledWork) {
      const baseUrl = process.env.TALENTOS_BASE_URL || "https://talent.skarion.com";
      await backgroundDispatch(
        fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, { method: "POST" }).catch((err) => {
          console.error("[active-workflows-poll] Opportunistic dispatch fetch failed:", err);
        })
      );
    }

    // Belt-and-suspenders: the self-fetch above (Worker calling its own
    // public URL from inside a request it's still handling) is unreliable
    // in production - confirmed live, a batch of 10 freshly queued
    // workflows sat completely untouched for 5+ minutes despite this route
    // being polled every 6s the whole time (ruling out the caching issue
    // force-dynamic above already fixed), while a plain client-initiated
    // POST to /dispatch from a real browser tab succeeded instantly, every
    // single time, no exceptions. Surface that signal so callers (the
    // application-queue and resume-parsing-status pollers) can also fire a
    // real, separate client->server POST instead of depending solely on
    // this Worker-to-itself fetch.
    return NextResponse.json({ workflows: rows, needsDispatch: hasQueuedOrStalledWork });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
