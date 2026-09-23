import { execute, query, queryOne } from "@/server/db/neon";

export type JobAgentBatchStatus =
  | "creating"
  | "launching"
  | "running"
  | "finalizing"
  | "finalization_failed"
  | "succeeded"
  | "partial_success"
  | "failed"
  | "cancelled";

export type JobAgentBatchShardStatus =
  | "pending"
  | "launching"
  | "running"
  | "processing"
  | "retry_wait"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface JobAgentBatchRow {
  id: string;
  batch_key: string;
  business_date: string;
  timezone: string;
  window_start: string;
  window_end: string;
  trigger_type: string;
  auto_import: boolean;
  status: JobAgentBatchStatus;
  actor_sources: string[];
  role_groups: string[];
  result_ceilings: Record<string, number>;
  expected_shards: number;
  terminal_shards: number;
  succeeded_shards: number;
  failed_shards: number;
  raw_count: number;
  accepted_count: number;
  date_excluded_count: number;
  date_exclusion_reasons: Record<string, number>;
  duplicate_count: number;
  final_duplicate_count: number;
  classified_count: number;
  imported_count: number;
  errors: Array<Record<string, unknown>>;
  last_error: string | null;
  job_ceo_run_id: string | null;
  finalization_claim_token: string | null;
  finalization_claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobAgentBatchShardRow {
  id: string;
  batch_id: string;
  shard_key: string;
  logical_order: number;
  actor_source: "indeed" | "google" | "linkedin";
  role_groups: string[];
  search_queries: string[];
  search_query: string | null;
  allocated_result_limit: number;
  status: JobAgentBatchShardStatus;
  attempt_count: number;
  max_attempts: number;
  active_run_id: string | null;
  last_run_id: string | null;
  next_retry_at: string | null;
  launch_claim_token: string | null;
  launch_claimed_at: string | null;
  raw_count: number;
  accepted_count: number;
  date_excluded_count: number;
  date_exclusion_reasons: Record<string, number>;
  duplicate_count: number;
  classified_count: number;
  imported_count: number;
  errors: Array<Record<string, unknown>>;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobAgentBatchInput {
  batchKey: string;
  businessDate: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  actorSources: string[];
  roleGroups: string[];
  resultCeilings: Record<string, number>;
  expectedShards: number;
  triggerType?: string;
  autoImport?: boolean;
}

export interface JobAgentBatchShardInput {
  shardKey: string;
  logicalOrder: number;
  actorSource: "indeed" | "google" | "linkedin";
  roleGroups: string[];
  searchQueries: string[];
  searchQuery?: string | null;
  allocatedResultLimit: number;
  maxAttempts?: number;
}

export interface JobAgentBatchProgress {
  batch: JobAgentBatchRow;
  shards: JobAgentBatchShardRow[];
  allTerminal: boolean;
  hasFailures: boolean;
}

const ACTIVE_BATCH_STATUSES: JobAgentBatchStatus[] = [
  "creating",
  "launching",
  "running",
  "finalizing",
  "finalization_failed",
];

const TERMINAL_SHARD_STATUSES: JobAgentBatchShardStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
];

function sameInstant(left: string, right: string): boolean {
  return new Date(left).getTime() === new Date(right).getTime();
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedRecordEntries(value: Record<string, number>): Array<[string, number]> {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
}

/**
 * Insert the canonical business-date batch, or return the already-created row.
 * A reused key is accepted only when its immutable identity/window matches.
 */
export async function createOrGetBatch(input: CreateJobAgentBatchInput): Promise<JobAgentBatchRow> {
  if (!input.batchKey.trim()) throw new Error("Batch key is required");
  if (input.expectedShards < 1) throw new Error("A nightly batch must contain at least one shard");

  const row = await queryOne<JobAgentBatchRow>(
    `INSERT INTO job_agent_batches (
       batch_key, business_date, timezone, window_start, window_end,
       trigger_type, auto_import, actor_sources, role_groups, result_ceilings,
       expected_shards
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
     ON CONFLICT (batch_key) DO UPDATE
       SET batch_key = EXCLUDED.batch_key
     RETURNING *`,
    [
      input.batchKey,
      input.businessDate,
      input.timezone,
      input.windowStart,
      input.windowEnd,
      input.triggerType ?? "nightly",
      input.autoImport ?? true,
      input.actorSources,
      input.roleGroups,
      JSON.stringify(input.resultCeilings),
      input.expectedShards,
    ]
  );
  if (!row) throw new Error("Failed to create or load Job Agent batch");

  if (
    row.business_date !== input.businessDate ||
    row.timezone !== input.timezone ||
    !sameInstant(row.window_start, input.windowStart) ||
    !sameInstant(row.window_end, input.windowEnd) ||
    row.trigger_type !== (input.triggerType ?? "nightly") ||
    row.auto_import !== (input.autoImport ?? true) ||
    row.expected_shards !== input.expectedShards ||
    !sameStrings(row.actor_sources, input.actorSources) ||
    !sameStrings(row.role_groups, input.roleGroups) ||
    JSON.stringify(sortedRecordEntries(row.result_ceilings)) !==
      JSON.stringify(sortedRecordEntries(input.resultCeilings))
  ) {
    throw new Error(`Batch key ${input.batchKey} already exists with a different immutable definition`);
  }

  return row;
}

export async function getBatchById(id: string): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>("SELECT * FROM job_agent_batches WHERE id = $1", [id]);
}

export async function getBatchByKey(batchKey: string): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>("SELECT * FROM job_agent_batches WHERE batch_key = $1", [batchKey]);
}

export async function getBatchForRun(runId: string): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>(
    `SELECT b.*
     FROM job_agent_runs r
     JOIN job_agent_batches b ON b.id = r.batch_id
     WHERE r.id = $1`,
    [runId]
  );
}

export async function listActiveBatches(limit = 20): Promise<JobAgentBatchRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 100));
  return query<JobAgentBatchRow>(
    `SELECT * FROM job_agent_batches
     WHERE status = ANY($1::text[])
     ORDER BY business_date ASC, created_at ASC
     LIMIT $2`,
    [ACTIVE_BATCH_STATUSES, safeLimit]
  );
}

export async function listRecentBatches(limit = 50): Promise<JobAgentBatchRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  return query<JobAgentBatchRow>(
    `SELECT * FROM job_agent_batches
     ORDER BY business_date DESC, created_at DESC
     LIMIT $1`,
    [safeLimit]
  );
}

/** Materialize every logical shard before any external actor is started. */
export async function materializeBatchShards(
  batchId: string,
  inputs: JobAgentBatchShardInput[]
): Promise<JobAgentBatchShardRow[]> {
  if (inputs.length === 0) throw new Error("At least one shard is required");

  const batch = await getBatchById(batchId);
  if (!batch) throw new Error(`Job Agent batch not found: ${batchId}`);
  if (batch.expected_shards !== inputs.length) {
    throw new Error(`Batch expects ${batch.expected_shards} shards, received ${inputs.length}`);
  }

  const shardKeys = new Set(inputs.map((item) => item.shardKey));
  const orders = new Set(inputs.map((item) => item.logicalOrder));
  if (shardKeys.size !== inputs.length || orders.size !== inputs.length) {
    throw new Error("Shard keys and logical orders must be unique within a batch");
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let param = 1;
  for (const input of inputs) {
    if (input.allocatedResultLimit < 1) throw new Error(`Invalid limit for shard ${input.shardKey}`);
    placeholders.push(
      `($${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++}, $${param++})`
    );
    values.push(
      batchId,
      input.shardKey,
      input.logicalOrder,
      input.actorSource,
      input.roleGroups,
      input.searchQueries,
      input.searchQuery ?? null,
      input.allocatedResultLimit,
      input.maxAttempts ?? 4
    );
  }

  await execute(
    `INSERT INTO job_agent_batch_shards (
       batch_id, shard_key, logical_order, actor_source, role_groups,
       search_queries, search_query, allocated_result_limit, max_attempts
     ) VALUES ${placeholders.join(", ")}
     ON CONFLICT (batch_id, shard_key) DO NOTHING`,
    values
  );

  const rows = await listBatchShards(batchId);
  if (rows.length !== inputs.length) {
    throw new Error(`Batch ${batchId} has ${rows.length} shards; expected ${inputs.length}`);
  }

  const byKey = new Map(rows.map((row) => [row.shard_key, row]));
  for (const input of inputs) {
    const row = byKey.get(input.shardKey);
    if (
      !row ||
      row.logical_order !== input.logicalOrder ||
      row.actor_source !== input.actorSource ||
      row.allocated_result_limit !== input.allocatedResultLimit ||
      row.max_attempts !== (input.maxAttempts ?? 4) ||
      !sameStrings(row.role_groups, input.roleGroups) ||
      !sameStrings(row.search_queries, input.searchQueries) ||
      (row.search_query ?? null) !== (input.searchQuery ?? null)
    ) {
      throw new Error(`Existing shard ${input.shardKey} does not match the requested immutable definition`);
    }
  }

  await execute(
    `UPDATE job_agent_batches
     SET status = CASE WHEN status = 'creating' THEN 'launching' ELSE status END,
         started_at = COALESCE(started_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [batchId]
  );
  return rows;
}

export async function getShardById(id: string): Promise<JobAgentBatchShardRow | null> {
  return queryOne<JobAgentBatchShardRow>("SELECT * FROM job_agent_batch_shards WHERE id = $1", [id]);
}

export async function listBatchShards(batchId: string): Promise<JobAgentBatchShardRow[]> {
  return query<JobAgentBatchShardRow>(
    `SELECT * FROM job_agent_batch_shards
     WHERE batch_id = $1
     ORDER BY logical_order ASC`,
    [batchId]
  );
}

/**
 * Atomically lease launchable shards across concurrent cron/poller callers.
 * pending shards and due retry_wait shards are promoted to launching exactly once.
 */
export async function claimLaunchableShards(
  batchId: string,
  limit: number
): Promise<JobAgentBatchShardRow[]> {
  const safeLimit = Math.max(1, Math.min(limit, 28));
  return query<JobAgentBatchShardRow>(
    `WITH candidates AS (
       SELECT s.id
       FROM job_agent_batch_shards s
       JOIN job_agent_batches b ON b.id = s.batch_id
       WHERE s.batch_id = $1
         AND b.status IN ('creating', 'launching', 'running')
         AND s.attempt_count < s.max_attempts
         AND (
           s.status = 'pending'
           OR (s.status = 'retry_wait' AND COALESCE(s.next_retry_at, NOW()) <= NOW())
         )
       ORDER BY s.logical_order ASC
       LIMIT $2
       FOR UPDATE OF s SKIP LOCKED
     )
     UPDATE job_agent_batch_shards s
     SET status = 'launching',
         attempt_count = s.attempt_count + 1,
         active_run_id = NULL,
         next_retry_at = NULL,
         launch_claim_token = gen_random_uuid(),
         launch_claimed_at = NOW(),
         started_at = COALESCE(s.started_at, NOW()),
         completed_at = NULL,
         updated_at = NOW()
     FROM candidates c
     WHERE s.id = c.id
     RETURNING s.*`,
    [batchId, safeLimit]
  );
}

/**
 * Recover a launcher that died before it could attach a run. Any still-active
 * spend reservation is released in the same statement, and the logical shard
 * becomes immediately retryable (or terminal after its fourth attempt).
 */
export async function recoverStaleShardLaunches(staleMinutes = 10): Promise<number> {
  const minutes = Math.max(5, Math.min(Math.floor(staleMinutes), 60));
  const rows = await query<{ id: string }>(
    `WITH stale AS MATERIALIZED (
       SELECT id
       FROM job_agent_batch_shards
       WHERE status = 'launching'
         AND launch_claimed_at < NOW() - ($1::text || ' minutes')::interval
       FOR UPDATE SKIP LOCKED
     ),
     released AS (
       UPDATE job_agent_apify_token_reservations reservation
       SET status = 'released',
           released_reason = 'stale_launch_claim',
           updated_at = NOW()
       WHERE reservation.batch_shard_id IN (SELECT id FROM stale)
         AND reservation.status = 'active'
       RETURNING reservation.id
     )
     UPDATE job_agent_batch_shards shard
     SET status = CASE WHEN shard.attempt_count < shard.max_attempts THEN 'retry_wait' ELSE 'failed' END,
         active_run_id = NULL,
         next_retry_at = CASE WHEN shard.attempt_count < shard.max_attempts THEN NOW() ELSE NULL END,
         launch_claim_token = NULL,
         launch_claimed_at = NULL,
         last_error = 'Launcher lease expired before actor start completed',
         errors = shard.errors || jsonb_build_array(jsonb_build_object(
           'at', NOW(), 'attempt', shard.attempt_count,
           'message', 'Launcher lease expired before actor start completed'
         )),
         completed_at = CASE WHEN shard.attempt_count >= shard.max_attempts THEN NOW() ELSE NULL END,
         updated_at = NOW()
     FROM stale
     WHERE shard.id = stale.id
     RETURNING shard.id`,
    [minutes],
  );
  return rows.length;
}

/** Link the newly-created run only if this caller still owns the launch lease. */
export async function attachRunToClaimedShard(input: {
  shardId: string;
  claimToken: string;
  runId: string;
  attemptNumber: number;
}): Promise<JobAgentBatchShardRow | null> {
  return queryOne<JobAgentBatchShardRow>(
    `UPDATE job_agent_batch_shards s
     SET status = 'running',
         active_run_id = r.id,
         last_run_id = r.id,
         launch_claim_token = NULL,
         launch_claimed_at = NULL,
         updated_at = NOW()
     FROM job_agent_runs r
     WHERE s.id = $1
       AND s.status = 'launching'
       AND s.launch_claim_token = $2
       AND s.attempt_count = $4
       AND r.id = $3
       AND r.batch_id = s.batch_id
       AND r.batch_shard_id = s.id
       AND r.attempt_number = $4
     RETURNING s.*`,
    [input.shardId, input.claimToken, input.runId, input.attemptNumber]
  );
}

export interface TransitionShardPatch {
  activeRunId?: string | null;
  lastRunId?: string | null;
  rawCount?: number;
  acceptedCount?: number;
  dateExcludedCount?: number;
  dateExclusionReasons?: Record<string, number>;
  duplicateCount?: number;
  classifiedCount?: number;
  importedCount?: number;
  lastError?: string | null;
  completedAt?: string | null;
}

/** Compare-and-set a shard state; null means another caller won. */
export async function transitionShardStatus(
  id: string,
  fromStatuses: JobAgentBatchShardStatus[],
  toStatus: JobAgentBatchShardStatus,
  patch: TransitionShardPatch = {}
): Promise<JobAgentBatchShardRow | null> {
  if (fromStatuses.length === 0) throw new Error("At least one source shard status is required");

  const columns: Array<[keyof TransitionShardPatch, string]> = [
    ["activeRunId", "active_run_id"],
    ["lastRunId", "last_run_id"],
    ["rawCount", "raw_count"],
    ["acceptedCount", "accepted_count"],
    ["dateExcludedCount", "date_excluded_count"],
    ["dateExclusionReasons", "date_exclusion_reasons"],
    ["duplicateCount", "duplicate_count"],
    ["classifiedCount", "classified_count"],
    ["importedCount", "imported_count"],
    ["lastError", "last_error"],
    ["completedAt", "completed_at"],
  ];
  const values: unknown[] = [toStatus];
  const sets = ["status = $1"];
  for (const [key, column] of columns) {
    if (patch[key] !== undefined) {
      values.push(patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  sets.push("updated_at = NOW()");
  values.push(id, fromStatuses);

  return queryOne<JobAgentBatchShardRow>(
    `UPDATE job_agent_batch_shards
     SET ${sets.join(", ")}
     WHERE id = $${values.length - 1}
       AND status = ANY($${values.length}::text[])
     RETURNING *`,
    values
  );
}

/**
 * Record an attempt failure and either schedule 5/15/30 minute retry backoff or
 * terminally fail the shard after its fourth total attempt.
 */
export async function scheduleShardRetry(input: {
  shardId: string;
  runId?: string | null;
  error: string;
  fromStatuses?: JobAgentBatchShardStatus[];
}): Promise<JobAgentBatchShardRow | null> {
  const fromStatuses = input.fromStatuses ?? ["launching", "running", "processing"];
  return queryOne<JobAgentBatchShardRow>(
    `UPDATE job_agent_batch_shards
     SET status = CASE WHEN attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed' END,
         active_run_id = NULL,
         last_run_id = COALESCE($2::uuid, last_run_id),
         next_retry_at = CASE
           WHEN attempt_count >= max_attempts THEN NULL
           WHEN attempt_count = 1 THEN NOW() + INTERVAL '5 minutes'
           WHEN attempt_count = 2 THEN NOW() + INTERVAL '15 minutes'
           ELSE NOW() + INTERVAL '30 minutes'
         END,
         launch_claim_token = NULL,
         launch_claimed_at = NULL,
         last_error = $3,
         errors = errors || jsonb_build_array(jsonb_build_object(
           'at', NOW(), 'attempt', attempt_count, 'runId', $2::uuid, 'message', $3
         )),
         completed_at = CASE WHEN attempt_count >= max_attempts THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1 AND status = ANY($4::text[])
     RETURNING *`,
    [input.shardId, input.runId ?? null, input.error, fromStatuses]
  );
}

/** Recompute batch counters from shard truth rather than applying fragile deltas. */
export async function refreshBatchAggregates(batchId: string): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>(
    `WITH totals AS (
       SELECT
         COUNT(*)::int AS materialized_shards,
         COUNT(*) FILTER (WHERE status = ANY($2::text[]))::int AS terminal_shards,
         COUNT(*) FILTER (WHERE status = 'succeeded')::int AS succeeded_shards,
         COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled'))::int AS failed_shards,
         COALESCE(SUM(raw_count), 0)::int AS raw_count,
         COALESCE(SUM(accepted_count), 0)::int AS accepted_count,
         COALESCE(SUM(date_excluded_count), 0)::int AS date_excluded_count,
         jsonb_build_object(
           'missing_date', COALESCE(SUM(COALESCE((date_exclusion_reasons->>'missing_date')::int, 0)), 0),
           'unparseable_date', COALESCE(SUM(COALESCE((date_exclusion_reasons->>'unparseable_date')::int, 0)), 0),
           'ambiguous_date', COALESCE(SUM(COALESCE((date_exclusion_reasons->>'ambiguous_date')::int, 0)), 0),
           'before_window', COALESCE(SUM(COALESCE((date_exclusion_reasons->>'before_window')::int, 0)), 0),
           'after_window', COALESCE(SUM(COALESCE((date_exclusion_reasons->>'after_window')::int, 0)), 0)
         ) AS date_exclusion_reasons,
         COALESCE(SUM(duplicate_count), 0)::int AS duplicate_count,
         COALESCE(SUM(classified_count), 0)::int AS classified_count,
         COALESCE(SUM(imported_count), 0)::int AS imported_count
       FROM job_agent_batch_shards
       WHERE batch_id = $1
     )
     UPDATE job_agent_batches b
     SET terminal_shards = t.terminal_shards,
         succeeded_shards = t.succeeded_shards,
         failed_shards = t.failed_shards,
         raw_count = t.raw_count,
         accepted_count = t.accepted_count,
         date_excluded_count = t.date_excluded_count,
         date_exclusion_reasons = t.date_exclusion_reasons,
         duplicate_count = t.duplicate_count + b.final_duplicate_count,
         classified_count = t.classified_count,
         imported_count = GREATEST(b.imported_count, t.imported_count),
         status = CASE
           WHEN b.status IN ('creating', 'launching')
             AND t.materialized_shards = b.expected_shards THEN 'running'
           ELSE b.status
         END,
         updated_at = NOW()
     FROM totals t
     WHERE b.id = $1
     RETURNING b.*`,
    [batchId, TERMINAL_SHARD_STATUSES]
  );
}

export async function getBatchProgress(batchId: string): Promise<JobAgentBatchProgress | null> {
  const batch = await refreshBatchAggregates(batchId);
  if (!batch) return null;
  const shards = await listBatchShards(batchId);
  return {
    batch,
    shards,
    allTerminal: batch.expected_shards > 0 && batch.terminal_shards === batch.expected_shards,
    hasFailures: batch.failed_shards > 0,
  };
}

export async function transitionBatchStatus(
  id: string,
  fromStatuses: JobAgentBatchStatus[],
  toStatus: JobAgentBatchStatus
): Promise<JobAgentBatchRow | null> {
  if (fromStatuses.length === 0) throw new Error("At least one source batch status is required");
  return queryOne<JobAgentBatchRow>(
    `UPDATE job_agent_batches
     SET status = $2,
         started_at = CASE WHEN $2 IN ('launching', 'running') THEN COALESCE(started_at, NOW()) ELSE started_at END,
         completed_at = CASE WHEN $2 IN ('succeeded', 'partial_success', 'failed', 'cancelled') THEN NOW() ELSE completed_at END,
         finalization_claim_token = CASE WHEN $2 IN ('succeeded', 'partial_success', 'failed', 'cancelled') THEN NULL ELSE finalization_claim_token END,
         finalization_claimed_at = CASE WHEN $2 IN ('succeeded', 'partial_success', 'failed', 'cancelled') THEN NULL ELSE finalization_claimed_at END,
         updated_at = NOW()
     WHERE id = $1 AND status = ANY($3::text[])
     RETURNING *`,
    [id, toStatus, fromStatuses]
  );
}

export async function recordBatchError(batchId: string, error: string): Promise<void> {
  await execute(
    `UPDATE job_agent_batches
     SET last_error = $2,
         errors = errors || jsonb_build_array(jsonb_build_object('at', NOW(), 'message', $2)),
         updated_at = NOW()
     WHERE id = $1`,
    [batchId, error]
  );
}

/**
 * Claim the once-per-batch handoff only after every logical shard is terminal.
 * A stale finalization lease can be reclaimed, but an attached CEO run remains
 * on the batch so a retry can never create a second run accidentally.
 */
export async function claimBatchFinalization(batchId: string): Promise<JobAgentBatchRow | null> {
  await refreshBatchAggregates(batchId);
  return queryOne<JobAgentBatchRow>(
    `UPDATE job_agent_batches b
     SET status = 'finalizing',
         finalization_claim_token = gen_random_uuid(),
         finalization_claimed_at = NOW(),
         updated_at = NOW()
     WHERE b.id = $1
       AND b.expected_shards > 0
       AND b.terminal_shards = b.expected_shards
       AND (
         b.status IN ('creating', 'launching', 'running', 'finalization_failed')
         OR (b.status = 'finalizing' AND b.finalization_claimed_at < NOW() - INTERVAL '15 minutes')
       )
     RETURNING b.*`,
    [batchId]
  );
}

export async function attachJobCeoRunToBatch(
  batchId: string,
  claimToken: string,
  jobCeoRunId: string
): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>(
    `UPDATE job_agent_batches
     SET job_ceo_run_id = COALESCE(job_ceo_run_id, $3::uuid), updated_at = NOW()
     WHERE id = $1
       AND status = 'finalizing'
       AND finalization_claim_token = $2::uuid
       AND (job_ceo_run_id IS NULL OR job_ceo_run_id = $3::uuid)
     RETURNING *`,
    [batchId, claimToken, jobCeoRunId]
  );
}

export async function completeBatchFinalization(input: {
  batchId: string;
  claimToken: string;
  status: "succeeded" | "partial_success";
  importedCount: number;
  jobCeoRunId?: string | null;
}): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>(
    `UPDATE job_agent_batches
     SET status = $3,
         imported_count = $4,
         job_ceo_run_id = COALESCE(job_ceo_run_id, $5::uuid),
         finalization_claim_token = NULL,
         finalization_claimed_at = NULL,
         completed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1
       AND status = 'finalizing'
       AND finalization_claim_token = $2::uuid
       AND (job_ceo_run_id IS NULL OR $5::uuid IS NULL OR job_ceo_run_id = $5::uuid)
     RETURNING *`,
    [input.batchId, input.claimToken, input.status, Math.max(0, input.importedCount), input.jobCeoRunId ?? null]
  );
}

export async function failBatchFinalization(
  batchId: string,
  claimToken: string,
  error: string
): Promise<JobAgentBatchRow | null> {
  return queryOne<JobAgentBatchRow>(
    `UPDATE job_agent_batches
     SET status = 'finalization_failed',
         last_error = $3,
         errors = errors || jsonb_build_array(jsonb_build_object('at', NOW(), 'stage', 'finalization', 'message', $3)),
         finalization_claim_token = NULL,
         finalization_claimed_at = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'finalizing'
       AND finalization_claim_token = $2::uuid
     RETURNING *`,
    [batchId, claimToken, error]
  );
}
