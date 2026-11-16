import { EVIDENCE_RESUME_STAGES, LEGACY_RESUME_STAGES, RESUME_EVIDENCE_VARIANT } from "@/lib/ai/application-agents/workflowStages";
import { execute, query, queryOne } from "@/server/db/neon";
import type { resumePipelineSettings } from "./aiRuntimeConfigRepository";
import type { ResumeRouteSnapshot } from "@/lib/ai/routing";

type Settings = ReturnType<typeof resumePipelineSettings>;
const stageArrays = [LEGACY_RESUME_STAGES, EVIDENCE_RESUME_STAGES, RESUME_EVIDENCE_VARIANT];

// Identify a stage's output by its successful attempt, not by an orphaned
// artifact with the same automation ID.
const stageProgressSql = `
  SELECT COALESCE(MIN(seq - 1) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM application_ai_stage_runs sr
    JOIN application_ai_artifacts a ON a.id = sr.output_artifact_id
      AND a.workflow_id = w.id AND a.automation_id = wanted.agent
    WHERE sr.workflow_id = w.id AND sr.automation_id = wanted.agent
      AND sr.sequence_number = wanted.seq AND sr.status = 'success'
      AND sr.attempt_number > COALESCE((w.config_snapshot->'resumeReplayThrough'->>sr.sequence_number::text)::integer, 0)
  )), count(*))::integer AS first_missing, count(*)::integer AS stage_count
  FROM unnest(CASE WHEN w.config_snapshot->>'pipelineVariant' = $3
                   THEN $2::text[] ELSE $1::text[] END)
       WITH ORDINALITY AS wanted(agent, seq)`;

export async function recoverResumeWorkflows(settings: Settings) {
  const eligible = `w.status = 'waiting' OR (w.status = 'running' AND (
    (COALESCE(w.claim_expires_at, w.created_at) < NOW()
      AND COALESCE(w.heartbeat_at, w.claimed_at, w.created_at) < NOW() - make_interval(secs => $4))
    OR (NULLIF(to_jsonb(w)->>'stage_deadline_at', '')::timestamptz >= w.claimed_at
      AND NULLIF(to_jsonb(w)->>'stage_deadline_at', '')::timestamptz < NOW() - make_interval(secs => $6))
  ))`;
  const candidates = `SELECT w.id, p.first_missing,
    CASE WHEN w.status = 'waiting' THEN 'missing_artifact'
         WHEN NULLIF(to_jsonb(w)->>'stage_deadline_at', '')::timestamptz < NOW() - make_interval(secs => $6)
           THEN 'stage_timeout' ELSE 'orphaned_worker' END AS reason
    FROM application_ai_workflows w
    JOIN applications app ON app.id = w.application_id
    CROSS JOIN LATERAL (${stageProgressSql}) p
    WHERE (${eligible}) AND app.applied_at IS NULL AND app.ai_workflow_id = w.id
      AND (w.status <> 'waiting' OR p.first_missing < 2
        OR w.current_stage <> 1
        OR COALESCE(w.config_snapshot->>'waitForHiringPanelApproval', 'false') <> 'true')
    ORDER BY COALESCE(w.heartbeat_at, w.created_at), w.id
    LIMIT $5`;
  const params = [...stageArrays, settings.staleHeartbeatSeconds, settings.recoveryBatch, settings.recoveryDelaySeconds];
  if (settings.recoveryMode === "report") {
    return query<{ id: string; reason: string; first_missing: number }>(candidates, params);
  }
  return query<{ id: string; reason: string; first_missing: number }>(
    `WITH ready AS MATERIALIZED (${candidates} FOR UPDATE OF w SKIP LOCKED),
      fixed AS (
        UPDATE application_ai_workflows w SET
          status = CASE WHEN w.recovery_count >= $7::integer THEN 'failed' ELSE 'queued' END,
          current_stage = ready.first_missing, lock_version = w.lock_version + 1,
          recovery_count = w.recovery_count + 1,
          stage_retry_count = CASE WHEN w.current_stage = ready.first_missing THEN w.stage_retry_count ELSE 0 END,
          cooldown_retry_count = CASE WHEN w.current_stage = ready.first_missing THEN w.cooldown_retry_count ELSE 0 END,
          last_error = 'Workflow recovery: ' || ready.reason,
          recovery_reason = ready.reason, recovery_due_at = NOW() + make_interval(secs => $6),
          next_retry_at = CASE WHEN w.recovery_count >= $7::integer THEN NULL ELSE NOW() + make_interval(secs => $6) END,
          claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL, heartbeat_at = NULL, stage_deadline_at = NULL,
          updated_at = NOW()
        FROM ready WHERE ready.id = w.id
        RETURNING w.id, w.status, w.application_id, w.last_error, ready.reason, ready.first_missing
      ), attempts AS (
        UPDATE application_ai_stage_runs sr SET status = 'failed', completed_at = NOW(),
          error_code = fixed.reason, error_message = fixed.last_error
        FROM fixed WHERE sr.workflow_id = fixed.id AND sr.status = 'running'
      ), applications_synced AS (
        UPDATE applications app SET resume_generation_status = fixed.status,
          resume_generation_error = fixed.last_error FROM fixed
        WHERE app.id = fixed.application_id AND app.ai_workflow_id = fixed.id AND app.applied_at IS NULL
      )
      SELECT id, reason, first_missing FROM fixed`,
    [...params, settings.recoveryLimit],
  );
}

export async function setStageDeadline(id: string, lockVersion: number, budgetMs: number) {
  const result = await execute(
    `UPDATE application_ai_workflows SET stage_deadline_at = NOW() + make_interval(secs => $3::double precision / 1000)
      WHERE id = $1 AND lock_version = $2 AND status = 'running' AND claim_expires_at >= NOW()`,
    [id, lockVersion, budgetMs],
  );
  return result.rowCount > 0;
}

export async function manualResumeTransition(input: {
  id: string; stage: number | null; staleHeartbeatSeconds: number;
  action: "rerun" | "retry" | "restart" | "cancel" | "approve" | "reject" | "reject_and_restart";
  note?: string | null; reviewerId?: string | null;
  routing?: {
    routingStateId: string | null;
    routeSnapshot: ResumeRouteSnapshot[];
    evidenceRouteChains: Record<string, ResumeRouteSnapshot[]>;
    evidenceRoutes: null;
  };
}) {
  return queryOne<{ status: string; current_stage: number }>(
    `WITH owned AS MATERIALIZED (
       SELECT w.id, w.application_id, p.stage_count, p.first_missing,
         CASE WHEN $6 = 'approve' THEN 2 WHEN $6 = 'restart' THEN 0
              WHEN $6 = 'rerun' THEN $5::integer ELSE p.first_missing END AS chosen_stage
       FROM application_ai_workflows w
       JOIN applications app ON app.id = w.application_id
       CROSS JOIN LATERAL (${stageProgressSql}) p
       WHERE w.id = $4 AND app.applied_at IS NULL AND app.ai_workflow_id = w.id
         AND (
           ($6 IN ('approve','reject','reject_and_restart') AND w.status = 'waiting'
             AND w.current_stage = 1 AND p.first_missing >= 2
             AND w.config_snapshot->>'waitForHiringPanelApproval' = 'true')
           OR ($6 IN ('retry','restart','rerun') AND w.status IN ('failed','cancelled'))
           OR ($6 = 'cancel' AND w.status IN ('queued','running','waiting'))
           OR ($6 = 'rerun' AND w.status IN ('queued','waiting')
             AND (w.status <> 'waiting' OR COALESCE(w.config_snapshot->>'waitForHiringPanelApproval','false') <> 'true'))
           OR ($6 = 'rerun' AND w.status = 'running' AND COALESCE(w.claim_expires_at, w.created_at) < NOW()
             AND COALESCE(w.heartbeat_at, w.claimed_at, w.created_at) < NOW() - make_interval(secs => $7))
         ) FOR UPDATE OF w
     ), changed AS (
       UPDATE application_ai_workflows w SET
         status = CASE WHEN $6 = 'reject' THEN 'failed' WHEN $6 = 'cancel' THEN 'cancelled' ELSE 'queued' END,
         current_stage = CASE WHEN $6 = 'reject_and_restart' THEN 0 WHEN $6 = 'cancel' THEN w.current_stage ELSE owned.chosen_stage END,
         cancelled_at = CASE WHEN $6 = 'cancel' THEN NOW() ELSE NULL END,
         last_error = CASE WHEN $6 = 'reject' THEN COALESCE($8::text, 'Changes requested by reviewer') ELSE NULL END,
         next_retry_at = NULL, recovery_count = 0, stage_retry_count = 0, cooldown_retry_count = 0,
         claimed_at = NULL, claim_expires_at = NULL, heartbeat_at = NULL, claimed_by = NULL,
         config_snapshot = (CASE WHEN $6 IN ('rerun','restart','reject_and_restart') THEN
           jsonb_set(COALESCE(w.config_snapshot, '{}'::jsonb), '{resumeReplayThrough}',
             COALESCE(w.config_snapshot->'resumeReplayThrough', '{}'::jsonb) || COALESCE((
               SELECT jsonb_object_agg(sequence_number::text, attempt_number) FROM (
                 SELECT sr.sequence_number, max(sr.attempt_number) AS attempt_number
                 FROM application_ai_stage_runs sr WHERE sr.workflow_id = w.id
                   AND sr.sequence_number > CASE WHEN $6 = 'reject_and_restart' THEN 0 ELSE owned.chosen_stage END
                 GROUP BY sr.sequence_number
               ) prior_attempts
             ), '{}'::jsonb))
           ELSE w.config_snapshot END) || COALESCE($10::jsonb, '{}'::jsonb),
         routing_state_id = CASE WHEN $10::jsonb IS NOT NULL THEN ($10::jsonb->>'routingStateId')::uuid ELSE w.routing_state_id END,
         route_snapshot = COALESCE($10::jsonb->'routeSnapshot', w.route_snapshot),
         lock_version = w.lock_version + 1, updated_at = NOW()
       FROM owned WHERE w.id = owned.id AND owned.chosen_stage BETWEEN 0 AND owned.stage_count
         AND ($6 <> 'rerun' OR (owned.chosen_stage < owned.stage_count AND owned.chosen_stage <= owned.first_missing))
       RETURNING w.id, w.application_id, w.status, w.current_stage, w.last_error
     ), orphaned AS (
       UPDATE application_ai_stage_runs sr SET status = CASE WHEN $6 = 'cancel' THEN 'cancelled' ELSE 'failed' END,
         completed_at = NOW(), error_code = CASE WHEN $6 = 'cancel' THEN 'manual_cancel' ELSE 'manual_recovery' END,
         error_message = CASE WHEN $6 = 'cancel' THEN 'Workflow cancelled' ELSE 'Unfinished stage was replaced by a guarded recovery' END
       FROM changed WHERE sr.workflow_id = changed.id AND sr.status = 'running'
     ), history AS (
       INSERT INTO application_ai_artifacts (workflow_id, automation_id, sequence_number, schema_version, content_hash, data)
       SELECT changed.id, 'human_review', 3, 'HumanReviewV1', md5($9::jsonb::text), $9::jsonb
       FROM changed WHERE $6 IN ('approve','reject','reject_and_restart')
     ), synced AS (
       UPDATE applications app SET resume_generation_status = changed.status, resume_generation_error = changed.last_error
       FROM changed WHERE app.id = changed.application_id AND app.ai_workflow_id = changed.id AND app.applied_at IS NULL
     ) SELECT status, current_stage FROM changed`,
    [...stageArrays, input.id, input.stage, input.action, input.staleHeartbeatSeconds, input.note ?? null,
      JSON.stringify({ action: input.action, note: input.note ?? null, reviewerId: input.reviewerId ?? null }),
      input.routing ? JSON.stringify(input.routing) : null],
  );
}
