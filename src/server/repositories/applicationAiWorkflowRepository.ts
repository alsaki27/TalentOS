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
  next_retry_at: string | null;
  lock_version: number;
  recovery_count: number;
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
}): Promise<WorkflowRow> {
  const rows = await query<WorkflowRow>(
    `INSERT INTO application_ai_workflows
      (application_id, base_resume_id, status, current_stage, idempotency_key, config_snapshot, started_by, match_score, match_reason, started_at)
     VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6, $7, NOW())
     RETURNING *`,
    [
      input.applicationId,
      input.baseResumeId ?? null,
      input.idempotencyKey ?? null,
      input.configSnapshot ?? null,
      input.startedBy ?? null,
      input.matchScore ?? null,
      input.matchReason ?? null,
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

export async function updateWorkflowStatus(
  id: string,
  status: WorkflowStatus,
  extra?: Record<string, unknown>,
  expectedLockVersion?: number,
): Promise<boolean> {
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
  if (status === "queued") {
    // A deliberate retry is a new recovery window. Without resetting this
    // counter, a workflow that previously exhausted stale-claim recovery is
    // requeued and immediately terminal-fails on its next claim, even when
    // the underlying provider/orchestration issue has been fixed.
    fields.push("recovery_count = 0");
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
  if (status !== "running") {
    fields.push("claimed_at = NULL", "claim_expires_at = NULL", "claimed_by = NULL", "heartbeat_at = NULL");
  }

  values.push(id);
  let where = `WHERE id = $${idx}`;
  if (expectedLockVersion !== undefined) {
    values.push(expectedLockVersion);
    where += ` AND lock_version = $${idx + 1}`;
  }
  const result = await execute(
    `UPDATE application_ai_workflows SET ${fields.join(", ")} ${where}`,
    values
  );
  return (result.rowCount ?? 0) > 0;
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
// RECOVERY: also reclaims running workflows whose claim lease has expired or
// whose heartbeat has been stale for five minutes. These are workflows
// abandoned by a crashed or dead dispatcher. After 3 recoveries the workflow
// is moved to 'failed' to prevent infinite retry loops on persistently broken stages.
// A live stage refreshes its heartbeat every 20 seconds, while configured
// provider timeouts are 120-180 seconds. Five minutes therefore leaves room
// for a slow provider call while recovering a genuinely dead Worker quickly.
export async function claimNextPendingWorkflow(): Promise<WorkflowRow | null> {
  const rows = await query<WorkflowRow>(
    `WITH config AS MATERIALIZED (
      -- Serialize concurrent dispatchers on the singleton config row. A
      -- plain active_count snapshot lets parallel runners all pass the cap.
      SELECT workflow_max_concurrency, workflow_claim_ttl_seconds
      FROM ai_runtime_config WHERE singleton = true FOR UPDATE
    ), active_count AS (
      SELECT COUNT(*)::int AS n FROM application_ai_workflows
      WHERE status = 'running'
        AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()
    ),
    next_workflow AS (
      SELECT id FROM application_ai_workflows
      WHERE (status = 'running' AND (
               claim_expires_at IS NULL OR claim_expires_at < NOW()
               OR heartbeat_at IS NULL OR heartbeat_at < NOW() - INTERVAL '5 minutes'
             ))
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
        claimed_at = NOW(),
        claim_expires_at = NOW() + make_interval(secs => (SELECT workflow_claim_ttl_seconds FROM config)),
        claimed_by = 'dispatcher',
        heartbeat_at = NOW(),
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

export async function assertWorkflowClaim(workflowId: string, lockVersion: number): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM application_ai_workflows
     WHERE id = $1 AND status = 'running' AND lock_version = $2
       AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()`,
    [workflowId, lockVersion]
  );
  return Boolean(row);
}

export async function updateWorkflowHeartbeat(workflowId: string, lockVersion?: number): Promise<boolean> {
  const params: (string | number)[] = [workflowId];
  let ownership = "";
  if (lockVersion !== undefined) {
    params.push(lockVersion);
    ownership = " AND w.lock_version = $2";
  }
  const result = await execute(
    `UPDATE application_ai_workflows w
     SET heartbeat_at = NOW(),
         claim_expires_at = NOW() + make_interval(secs => c.workflow_claim_ttl_seconds),
         updated_at = NOW()
     FROM ai_runtime_config c
     WHERE w.id = $1 AND c.singleton = true AND w.status = 'running'${ownership}`,
    params
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Stage runs ──

export async function createStageRun(input: {
  workflowId: string;
  automationId: string;
  sequenceNumber: number;
  attemptNumber?: number;
}): Promise<StageRunRow> {
  const rows = await query<StageRunRow>(
    `INSERT INTO application_ai_stage_runs
      (workflow_id, automation_id, sequence_number, attempt_number, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING *`,
    [input.workflowId, input.automationId, input.sequenceNumber, input.attemptNumber ?? 1]
  );
  return rows[0];
}

export async function updateStageRun(
  id: string,
  updates: Partial<StageRunRow>,
  ownership?: { workflowId: string; lockVersion: number },
): Promise<boolean> {
  const keys = Object.keys(updates).filter((k) => updates[k as keyof StageRunRow] !== undefined);
  if (keys.length === 0) return false;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k as keyof StageRunRow]);
  values.push(id);
  let where = `WHERE id = $${keys.length + 1}`;
  if (ownership) {
    values.push(ownership.workflowId, ownership.lockVersion);
    where += ` AND EXISTS (
      SELECT 1 FROM application_ai_workflows w
      WHERE w.id = $${keys.length + 2}
        AND w.id = application_ai_stage_runs.workflow_id
        AND w.status = 'running'
        AND w.lock_version = $${keys.length + 3}
        AND w.claim_expires_at IS NOT NULL AND w.claim_expires_at >= NOW()
    )`;
  }
  const result = await execute(
    `UPDATE application_ai_stage_runs SET ${setClause} ${where}`,
    values
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listStageRuns(workflowId: string): Promise<StageRunRow[]> {
  return query<StageRunRow>(
    "SELECT * FROM application_ai_stage_runs WHERE workflow_id = $1 ORDER BY sequence_number, attempt_number",
    [workflowId]
  );
}

/**
 * Close stage rows left behind by a dead Worker invocation. These rows are
 * retained as audit history; they must not remain "running" after their
 * workflow was retried or their claim/heartbeat became stale.
 */
export async function closeOrphanedStageRuns(workflowId?: string): Promise<number> {
  const result = await execute(
    `UPDATE application_ai_stage_runs sr
     SET status = 'failed',
         error_code = 'orphaned_run',
         error_message = 'Stage invocation superseded after its workflow claim became stale',
         completed_at = COALESCE(completed_at, NOW())
     FROM application_ai_workflows w
     WHERE sr.workflow_id = w.id
       AND sr.status = 'running'
       AND sr.started_at < NOW() - INTERVAL '5 minutes'
       AND ($1::uuid IS NULL OR sr.workflow_id = $1::uuid)
       AND (
         w.status <> 'running'
         OR w.heartbeat_at IS NULL
       OR w.heartbeat_at < NOW() - INTERVAL '5 minutes'
         OR (w.claimed_at IS NOT NULL AND sr.started_at < w.claimed_at)
       )`,
    [workflowId ?? null]
  );
  return result.rowCount ?? 0;
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
