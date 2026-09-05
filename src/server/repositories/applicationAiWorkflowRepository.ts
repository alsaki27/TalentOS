// Data-access abstraction for application_ai_workflows.

import { query, queryOne, execute } from "@/server/db/neon";
import type { WorkflowStatus, StageRunStatus, ApplicationAgentId, ProviderSnapshot } from "@/lib/ai/application-agents/types";

export interface WorkflowRow {
  id: string;
  application_id: string;
  base_resume_id: string | null;
  status: WorkflowStatus;
  current_stage: number;
  idempotency_key: string | null;
  config_snapshot: unknown;
  started_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  last_error: string | null;
  created_at: string;
  claimed_at: string | null;
  claim_expires_at: string | null;
  claimed_by: string | null;
  heartbeat_at: string | null;
  lock_version: number;
  recovery_count: number;
  next_retry_at: string | null;
  stage_retry_count: number;
  routing_state_id: string | null;
  route_snapshot: unknown;
}

export interface StageRunRow {
  id: string;
  workflow_id: string;
  automation_id: string;
  sequence_number: number;
  attempt_number: number;
  status: StageRunStatus;
  provider: string | null;
  model: string | null;
  ai_key_id: string | null;
  prompt_version: string | null;
  input_artifact_id: string | null;
  output_artifact_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface ArtifactRow {
  id: string;
  workflow_id: string;
  automation_id: string;
  sequence_number: number;
  schema_version: string;
  content_hash: string;
  data: unknown;
  created_at: string;
}

// ── Create workflow ──

export async function createWorkflow(input: {
  applicationId: string;
  baseResumeId?: string;
  idempotencyKey?: string;
  configSnapshot?: unknown;
  startedBy?: string;
  matchScore?: number;
  matchReason?: string;
  routingStateId?: string | null;
  routeSnapshot?: unknown;
}): Promise<WorkflowRow> {
  const rows = await query<WorkflowRow>(
    `INSERT INTO application_ai_workflows
      (application_id, base_resume_id, status, current_stage, idempotency_key, config_snapshot, started_by, match_score, match_reason, routing_state_id, route_snapshot, next_retry_at, stage_retry_count, started_at)
     VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6, $7, $8, $9, NULL, 0, NOW())
     RETURNING *`,
    [
      input.applicationId,
      input.baseResumeId ?? null,
      input.idempotencyKey ?? null,
      input.configSnapshot ?? null,
      input.startedBy ?? null,
      input.matchScore ?? null,
      input.matchReason ?? null,
      input.routingStateId ?? null,
      input.routeSnapshot ?? null,
    ]
  );
  return rows[0];
}

// ── Find by ID ──

export async function findWorkflowById(id: string): Promise<WorkflowRow | null> {
  return queryOne<WorkflowRow>(
    "SELECT * FROM application_ai_workflows WHERE id = $1",
    [id]
  );
}

// ── Find by application ID (latest active) ──

export async function findActiveWorkflowByApplicationId(applicationId: string): Promise<WorkflowRow | null> {
  return queryOne<WorkflowRow>(
    `SELECT * FROM application_ai_workflows
     WHERE application_id = $1 AND status IN ('queued','running','waiting')
     ORDER BY created_at DESC LIMIT 1`,
    [applicationId]
  );
}

// ── Update status ──

export async function updateWorkflowStatus(id: string, status: WorkflowStatus, extra?: Record<string, unknown>): Promise<boolean> {
  const fields: string[] = ["status = $1", "updated_at = NOW()"];
  const values: (string | number | boolean | null | Date)[] = [status];
  let idx = 2;

  if (status === "running") {
    fields.push(`started_at = $${idx++}`);
    values.push(new Date().toISOString());
  }
  if (status === "completed") {
    fields.push(`completed_at = $${idx++}`);
    values.push(new Date().toISOString());
  }
  if (status === "cancelled") {
    fields.push(`cancelled_at = $${idx++}`);
    values.push(new Date().toISOString());
  }
  if (extra?.current_stage !== undefined) {
    fields.push(`current_stage = $${idx++}`);
    values.push(extra.current_stage as number);
  }
  if (extra?.last_error !== undefined) {
    fields.push(`last_error = $${idx++}`);
    values.push(extra.last_error as string);
  }
  if (extra?.next_retry_at !== undefined) {
    fields.push(`next_retry_at = $${idx++}`);
    values.push(extra.next_retry_at as string | null);
  }
  if (extra?.stage_retry_count !== undefined) {
    fields.push(`stage_retry_count = $${idx++}`);
    values.push(extra.stage_retry_count as number);
  }
  if (status !== "running") {
    fields.push("claimed_at = NULL", "claim_expires_at = NULL", "claimed_by = NULL", "heartbeat_at = NULL");
  }

  values.push(id);
  const expectedLockVersion = typeof extra?.expected_lock_version === "number"
    ? extra.expected_lock_version
    : null;
  const expectedClaimedBy = typeof extra?.expected_claimed_by === "string"
    ? extra.expected_claimed_by
    : null;
  let where = `WHERE id = $${idx}`;
  if (expectedLockVersion !== null) {
    values.push(expectedLockVersion);
    where += ` AND lock_version = $${++idx}`;
  }
  if (expectedClaimedBy !== null) {
    values.push(expectedClaimedBy);
    where += ` AND claimed_by = $${++idx}`;
  }
  const result = await execute(
    `UPDATE application_ai_workflows SET ${fields.join(", ")} ${where}`,
    values
  );
  if ((expectedLockVersion !== null || expectedClaimedBy !== null) && result.rowCount !== 1) {
    throw new Error(`Workflow claim lost while updating ${id}`);
  }
  return result.rowCount === 1;
}

// Caps how many workflows can be genuinely in-flight (actively claimed,
// non-expired) at once. Bulk-creating hundreds of application tickets each
// auto-triggers its own workflow; without this, every one of them would try
// to claim+dispatch simultaneously and fire its own AI provider call at the
// same instant. With the cap, only MAX_CONCURRENT_AI_WORKFLOWS run at a
// time - the rest sit 'queued' and get pulled in as capacity frees up
// (checked here and in dispatchWorkflowById's claim), i.e. processed in
// buckets rather than all at once. Reclaiming an expired/stale 'running'
// workflow is exempt - that's recovering dead work, not adding new load.

// ── Claim pending workflow (for async dispatcher) ──
// Uses FOR UPDATE SKIP LOCKED for atomic claim across concurrent dispatchers.
// RECOVERY: also reclaims running workflows whose claim lease has expired
// (claim_expires_at IS NULL or claim_expires_at < NOW()). These are workflows
// abandoned by a crashed or dead dispatcher. After 3 recoveries the workflow
// is moved to 'failed' to prevent infinite retry loops on persistently broken stages.
// A claim may be recovered only after its lease and heartbeat are stale. This
// prevents a slow but live provider call from being reclaimed merely because
// the lease clock was not refreshed during a transient runtime pause.
export async function claimNextPendingWorkflow(): Promise<WorkflowRow | null> {
  const rows = await query<WorkflowRow>(
    `WITH config AS (
      SELECT workflow_max_concurrency, workflow_claim_ttl_seconds
      FROM ai_runtime_config WHERE singleton = true
    ), active_count AS (
      SELECT COUNT(*)::int AS n FROM application_ai_workflows
      WHERE status = 'running' AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()
    ),
    next_workflow AS (
      SELECT id FROM application_ai_workflows
       WHERE (status = 'running'
              AND (claim_expires_at IS NULL OR claim_expires_at < NOW())
              AND (heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '300 seconds'))
          OR (status = 'queued'
              AND (next_retry_at IS NULL OR next_retry_at <= NOW())
              AND (SELECT n FROM active_count) < (SELECT workflow_max_concurrency FROM config))
      ORDER BY
        CASE WHEN status = 'queued' THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE application_ai_workflows w
    SET status = CASE WHEN w.recovery_count >= 3 AND w.status = 'running'
                      THEN 'failed'
                      ELSE 'running'
                 END,
        -- An exhausted recovery is terminal. Do not leave a fresh lease on
        -- the failed row, otherwise the control center reports a phantom
        -- active claim and the next dispatcher cannot distinguish it from
        -- work that is still in flight.
        claimed_at = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN NULL ELSE NOW() END,
        claim_expires_at = CASE WHEN w.recovery_count >= 3 AND w.status = 'running'
                                THEN NULL
                                ELSE NOW() + make_interval(secs => (SELECT workflow_claim_ttl_seconds FROM config))
                           END,
        claimed_by = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN NULL ELSE 'dispatcher' END,
        heartbeat_at = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN NULL ELSE NOW() END,
        updated_at = NOW(),
        lock_version = lock_version + 1,
        recovery_count = CASE WHEN w.status = 'running'
                              THEN recovery_count + 1
                              ELSE recovery_count
                         END
    FROM next_workflow n
    WHERE w.id = n.id
    RETURNING w.*`,
    []
  );
  return rows[0] ?? null;
}

/** Claim a specific queued workflow through the same path as the scheduler. */
export async function claimWorkflowById(workflowId: string): Promise<WorkflowRow | null> {
  const rows = await query<WorkflowRow>(
    `WITH config AS (
       SELECT workflow_max_concurrency, workflow_claim_ttl_seconds
       FROM ai_runtime_config WHERE singleton = true
     ), active_count AS (
       SELECT COUNT(*)::int AS n FROM application_ai_workflows
       WHERE status = 'running' AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()
     )
     UPDATE application_ai_workflows w
     SET status = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN 'failed' ELSE 'running' END,
         claimed_at = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN NULL ELSE NOW() END,
         claim_expires_at = CASE WHEN w.recovery_count >= 3 AND w.status = 'running'
                                 THEN NULL
                                 ELSE NOW() + make_interval(secs => (SELECT workflow_claim_ttl_seconds FROM config)) END,
         claimed_by = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN NULL ELSE 'dispatcher' END,
         heartbeat_at = CASE WHEN w.recovery_count >= 3 AND w.status = 'running' THEN NULL ELSE NOW() END,
         updated_at = NOW(),
         lock_version = lock_version + 1,
         recovery_count = CASE WHEN w.status = 'running' THEN recovery_count + 1 ELSE recovery_count END
     WHERE w.id = $1
       AND ((w.status = 'queued'
             AND (w.next_retry_at IS NULL OR w.next_retry_at <= NOW())
             AND (SELECT n FROM active_count) < (SELECT workflow_max_concurrency FROM config))
         OR (w.status = 'running'
             AND (w.claim_expires_at IS NULL OR w.claim_expires_at < NOW())
             AND (w.heartbeat_at IS NULL OR w.heartbeat_at < NOW() - INTERVAL '300 seconds')))
     RETURNING w.*`,
    [workflowId],
  );
  return rows[0] ?? null;
}

export async function updateWorkflowHeartbeat(workflowId: string, expectedLockVersion?: number): Promise<boolean> {
  const values: (string | number)[] = [workflowId];
  let ownership = "";
  if (typeof expectedLockVersion === "number") {
    values.push(expectedLockVersion);
    ownership = " AND w.lock_version = $2";
  }
  const result = await execute(
    `UPDATE application_ai_workflows w
     SET heartbeat_at = NOW(),
         claim_expires_at = NOW() + make_interval(secs => c.workflow_claim_ttl_seconds),
         updated_at = NOW()
     FROM ai_runtime_config c
     WHERE w.id = $1 AND c.singleton = true AND w.status = 'running'
       AND w.claimed_by = 'dispatcher'${ownership}`,
    values,
  );
  return result.rowCount === 1;
}

// ── Stage runs ──

export async function createStageRun(input: {
  workflowId: string;
  automationId: string;
  sequenceNumber: number;
  attemptNumber?: number;
  expectedLockVersion?: number;
}): Promise<StageRunRow> {
  const params = [input.workflowId, input.automationId, input.sequenceNumber, input.attemptNumber ?? 1];
  const claimClause = typeof input.expectedLockVersion === "number"
    ? " AND w.lock_version = $5 AND w.claimed_by = 'dispatcher'"
    : "";
  if (typeof input.expectedLockVersion === "number") params.push(input.expectedLockVersion);
  const rows = await query<StageRunRow>(
    `INSERT INTO application_ai_stage_runs
      (workflow_id, automation_id, sequence_number, attempt_number, status)
     SELECT $1, $2, $3, $4, 'pending'
     FROM application_ai_workflows w
     WHERE w.id = $1 AND w.status = 'running'${claimClause}
     RETURNING *`,
    params,
  );
  if (!rows[0]) throw new Error(`Workflow claim lost before creating stage run for ${input.workflowId}`);
  return rows[0];
}

export async function updateStageRun(id: string, updates: Partial<StageRunRow>): Promise<void> {
  const keys = Object.keys(updates).filter((k) => updates[k as keyof StageRunRow] !== undefined);
  if (keys.length === 0) return;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k as keyof StageRunRow]);
  values.push(id);
  await execute(
    `UPDATE application_ai_stage_runs SET ${setClause} WHERE id = $${keys.length + 1}`,
    values
  );
}

/** Update a stage only while the same dispatcher claim still owns its workflow. */
export async function updateStageRunForClaim(
  id: string,
  workflowId: string,
  expectedLockVersion: number,
  updates: Partial<StageRunRow>,
): Promise<boolean> {
  const keys = Object.keys(updates).filter((k) => updates[k as keyof StageRunRow] !== undefined);
  if (keys.length === 0) return true;
  const setClause = keys.map((k, i) => `sr.${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k as keyof StageRunRow]);
  values.push(id, workflowId, expectedLockVersion);
  const result = await execute(
    `UPDATE application_ai_stage_runs sr
     SET ${setClause}
     FROM application_ai_workflows w
     WHERE sr.id = $${keys.length + 1}
       AND sr.workflow_id = $${keys.length + 2}
       AND w.id = sr.workflow_id
       AND w.status = 'running'
       AND w.claimed_by = 'dispatcher'
       AND w.lock_version = $${keys.length + 3}`,
    values,
  );
  if (result.rowCount !== 1) throw new Error(`Workflow claim lost while updating stage run ${id}`);
  return true;
}

/**
 * Close stage rows left behind when a worker loses its workflow claim.  The
 * workflow recovery path can safely retry the current stage, but leaving the
 * old row as `running` makes the control center report phantom in-flight work
 * and obscures which attempt actually produced the next result.
 */
export async function markOrphanedStageRuns(workflowId: string, reason?: string): Promise<void> {
  await execute(
    `UPDATE application_ai_stage_runs
     SET status = 'failed',
         error_code = COALESCE(error_code, 'workflow_claim_expired'),
         error_message = COALESCE(NULLIF(error_message, ''), $2),
         completed_at = COALESCE(completed_at, NOW())
     WHERE workflow_id = $1 AND status = 'running'`,
    [
      workflowId,
      reason ?? 'Stage attempt was orphaned after the workflow claim expired; a new attempt may be created.',
    ],
  );
}

export async function listStageRuns(workflowId: string): Promise<StageRunRow[]> {
  return query<StageRunRow>(
    "SELECT * FROM application_ai_stage_runs WHERE workflow_id = $1 ORDER BY sequence_number, attempt_number",
    [workflowId]
  );
}

// ── Artifacts ──

export async function createArtifact(input: {
  workflowId: string;
  automationId: string;
  sequenceNumber: number;
  schemaVersion: string;
  contentHash: string;
  data: unknown;
}): Promise<ArtifactRow> {
  const rows = await query<ArtifactRow>(
    `INSERT INTO application_ai_artifacts
      (workflow_id, automation_id, sequence_number, schema_version, content_hash, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [input.workflowId, input.automationId, input.sequenceNumber, input.schemaVersion, input.contentHash, JSON.stringify(input.data)]
  );
  return rows[0];
}

export async function listArtifacts(workflowId: string): Promise<ArtifactRow[]> {
  return query<ArtifactRow>(
    "SELECT * FROM application_ai_artifacts WHERE workflow_id = $1 ORDER BY sequence_number",
    [workflowId]
  );
}
