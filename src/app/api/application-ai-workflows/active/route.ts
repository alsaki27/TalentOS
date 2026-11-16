// GET /api/application-ai-workflows/active
// Slim endpoint for polling: returns workflow status fields plus the minimum
// candidate/job label data needed to tell cards apart at a glance (a single
// indexed join, not a full application/job hydration). The client diffs by
// id+updated_at and only re-renders changed cards. The board shows every
// workflow updated within the selected 1-7 day window; there is no card-count cap.

import { NextRequest, NextResponse } from "next/server";
import { query as neonQuery } from "@/server/db/neon";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { APPLICATION_AGENT_METAS } from "@/lib/ai/application-agents/types";
import { resumeStages } from "@/lib/ai/application-agents/workflowStages";
import { getAiRuntimeConfig, resumePipelineSettings } from "@/server/repositories/aiRuntimeConfigRepository";

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
    const params = new URL(request.url).searchParams;
    const requestedDays = Number.parseInt(params.get("days") ?? "3", 10);
    const days = Number.isFinite(requestedDays) ? Math.min(7, Math.max(1, requestedDays)) : 3;
    const queueView = params.get("view") === "application-queue";
    const settings = resumePipelineSettings(await getAiRuntimeConfig());

    const rows = await neonQuery<any>(
      `SELECT w.id, w.status, w.current_stage, w.last_error, w.updated_at, w.match_score, w.match_reason,
              w.application_id, w.base_resume_id, w.claim_expires_at, w.heartbeat_at, w.next_retry_at,
              w.config_snapshot->>'pipelineVariant' AS pipeline_variant,
              to_jsonb(w)->>'recovery_reason' AS recovery_reason,
              w.cooldown_retry_count, COALESCE(history.attempt_count,0) AS attempt_count,
              (w.status = 'running' AND (
                 (w.claim_expires_at < NOW() AND COALESCE(w.heartbeat_at,w.claimed_at,w.created_at)
                   < NOW() - make_interval(secs => $2))
                 OR (NULLIF(to_jsonb(w)->>'stage_deadline_at','')::timestamptz >= w.claimed_at
                   AND NULLIF(to_jsonb(w)->>'stage_deadline_at','')::timestamptz < NOW())
              )) AS recovery_needed,
              (w.status = 'waiting' AND w.current_stage = 1
                AND w.config_snapshot->>'waitForHiringPanelApproval' = 'true'
                AND EXISTS (
                  SELECT 1 FROM application_ai_stage_runs sr
                  JOIN application_ai_artifacts artifact ON artifact.id = sr.output_artifact_id
                  WHERE sr.workflow_id = w.id AND sr.automation_id = 'application_hiring_panel'
                    AND sr.status = 'success' AND artifact.workflow_id = w.id
                    AND artifact.automation_id = sr.automation_id
                    AND sr.attempt_number > COALESCE((w.config_snapshot->'resumeReplayThrough'->>sr.sequence_number::text)::integer, 0)
                )) AS review_pending,
              c.name AS candidate_name,
              w.config_snapshot -> 'job' ->> 'title' AS job_title,
              w.config_snapshot -> 'job' ->> 'company' AS job_company,
              a.tailored_resume_version_id, a.review_status,
              (rv.status = 'approved' AND to_jsonb(rv)->'release_receipt' IS NOT NULL) AS resume_released,
              hp.ats_score, hp.role_fit_score
       FROM application_ai_workflows w
       JOIN applications a ON a.id = w.application_id
       JOIN candidates c ON c.id = a.candidate_id
       LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id AND rv.workflow_id = w.id
       LEFT JOIN LATERAL (
         SELECT count(*)::integer AS attempt_count FROM application_ai_stage_runs sr
         WHERE sr.workflow_id = w.id AND sr.sequence_number = w.current_stage + 1
       ) history ON true
       LEFT JOIN LATERAL (
         SELECT (data ->> 'atsScore')::numeric AS ats_score,
                (data ->> 'roleFitScore')::numeric AS role_fit_score
         FROM application_ai_artifacts
         WHERE workflow_id = w.id AND automation_id = 'application_hiring_panel'
         ORDER BY created_at DESC LIMIT 1
       ) hp ON true
       WHERE w.updated_at >= NOW() - ($1::int * INTERVAL '1 day')
       ${queueView ? `
         AND w.status IN ('queued','running','waiting','completed','failed')
         AND NOT EXISTS (
           SELECT 1 FROM application_ai_workflows newer
           WHERE newer.application_id = w.application_id
             AND newer.status IN ('queued','running','waiting','completed','failed')
             AND (newer.created_at, newer.id) > (w.created_at, w.id)
         )` : ""}
       ORDER BY w.updated_at DESC`,
      [days, settings.staleHeartbeatSeconds]
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
    const workflows = rows.map(row => {
      const id = resumeStages({ pipelineVariant: row.pipeline_variant })[row.current_stage];
      const health = row.status === "completed" && row.pipeline_variant === "resume_evidence_v2"
        ? (row.resume_released ? "Approved" : row.review_status === "changes_requested" ? "Changes requested" : "Pending approval")
        : row.recovery_needed ? "Recovering"
        : row.status === "waiting" ? (row.review_pending ? "Pending approval" : "Needs integrity repair")
          : row.status === "queued" ? (row.cooldown_retry_count > 0 ? "Provider cooldown"
            : row.recovery_reason && row.next_retry_at ? "Recovering"
              : row.next_retry_at ? "Retry scheduled" : "Queued for capacity")
            : row.status.charAt(0).toUpperCase() + row.status.slice(1);
      return { ...row, stage_name: id ? APPLICATION_AGENT_METAS[id].displayName : null, health };
    });
    return NextResponse.json({ workflows, needsDispatch: hasQueuedOrStalledWork });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
