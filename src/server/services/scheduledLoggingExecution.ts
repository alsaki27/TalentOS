import { randomUUID } from "crypto";
import { queryOne, sql } from "@/server/db/neon";

// Execution state lives in the existing run snapshot. No schema migration,
// extra queue, or changes to candidate/job/application tables are required.
export const CHUNK_BUDGET_MS = 40_000;
export const RUN_LEASE_SECONDS = 180;
export const MAX_RECOVERIES = 3;
export interface ExecutionState {
  version: 1;
  phase: "queued" | "working" | "waiting" | "finished";
  heartbeatAt: string;
  leaseToken: string | null;
  leaseUntil: string | null;
  nextAttemptAt?: string | null;
  currentEventId: string | null;
  eventIds: string[];
  startedEventIds: string[];
  completedEventIds: string[];
  recoveries: number;
}
export interface LoggingRun {
  id: string;
  status: "running" | "completed" | "partial" | "failed";
  config_snapshot: Record<string, any> & { execution: ExecutionState };
  jobs_seen: number;
  candidate_pairs_scored: number;
  applications_created: number;
  skipped_count: number;
  failed_count: number;
  ai_calls: number;
  input_tokens: number;
  output_tokens: number;
}

// All start/claim/recovery transactions lock the singleton config row. The
// second statement gets a fresh READ COMMITTED snapshot AFTER that lock is
// acquired, so simultaneous UI, GitHub and Cron calls cannot start two runs.
const LOCK = "SELECT id FROM scheduled_candidate_logging_config WHERE id = true FOR UPDATE";
const LIVE_LEASE = `r.status = 'running'
  AND r.config_snapshot->'execution'->>'leaseToken' = $2
  AND (r.config_snapshot->'execution'->>'leaseUntil')::timestamptz > NOW()`;

export class ScheduledLoggingLeaseLost extends Error {
  constructor() { super("Scheduled logging chunk lease expired or was replaced; stopping this executor."); }
}

export async function requestLoggingRun(input: {
  runKey: string; triggerType: string; actorUserId?: string | null; snapshot: Record<string, unknown>; jobsPerRun: number;
}): Promise<LoggingRun> {
  const db = sql();
  const execution: ExecutionState = {
    version: 1, phase: "queued", heartbeatAt: new Date().toISOString(), leaseToken: null, leaseUntil: null,
    currentEventId: null, eventIds: [], startedEventIds: [], completedEventIds: [], recoveries: 0,
  };
  const result = await db.transaction([
    db.query(LOCK),
    db.query(`INSERT INTO scheduled_candidate_logging_runs (run_key, trigger_type, config_snapshot, started_by_user_id)
      SELECT $1, $2, $3::jsonb || jsonb_build_object('execution', $4::jsonb || jsonb_build_object('eventIds', COALESCE((
        SELECT jsonb_agg(e.id) FROM (
          SELECT id FROM scheduled_job_ingestion_events
           WHERE processing_status IN ('pending','failed')
              OR (processing_status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes')
           ORDER BY attempts ASC, ingested_at ASC, id LIMIT $5
        ) e
      ), '[]'::jsonb))), $6
      WHERE NOT EXISTS (SELECT 1 FROM scheduled_candidate_logging_runs WHERE status = 'running')
      ON CONFLICT (run_key) DO NOTHING`,
    [input.runKey, input.triggerType, JSON.stringify(input.snapshot), JSON.stringify(execution), input.jobsPerRun, input.actorUserId ?? null]),
    // A pre-chunk deployment may already own today's unique daily key. Resume
    // only a legacy run explicitly diagnosed by our watchdog, and carry its
    // counters and original limits forward instead of creating a second batch.
    db.query(`UPDATE scheduled_candidate_logging_runs r SET status='running',finished_at=NULL,
      error_message='Resuming an interrupted legacy batch within its remaining saved limits.',
      config_snapshot=($2::jsonb || r.config_snapshot) || jsonb_build_object(
        'settings',($2::jsonb->'settings') || jsonb_build_object(
          'match_threshold',COALESCE((r.config_snapshot->>'threshold')::int,($2::jsonb->'settings'->>'match_threshold')::int),
          'ai_match_threshold',COALESCE((r.config_snapshot->>'aiTierCrossCheckFloor')::int,($2::jsonb->'settings'->>'ai_match_threshold')::int),
          'ai_calls_per_run',COALESCE((r.config_snapshot->>'aiCallsPerRun')::int,($2::jsonb->'settings'->>'ai_calls_per_run')::int),
          'max_applications_per_run',COALESCE((r.config_snapshot->>'maxQueuedPerRun')::int,($2::jsonb->'settings'->>'max_applications_per_run')::int),
          'job_freshness_days',COALESCE((r.config_snapshot->>'jobFreshnessDays')::int,($2::jsonb->'settings'->>'job_freshness_days')::int),
          'assigned_by_user_id',COALESCE(r.config_snapshot->>'assignedByUserId',$2::jsonb->'settings'->>'assigned_by_user_id'),
          'application_owner_user_id',COALESCE(r.config_snapshot->>'applicationOwnerUserId',$2::jsonb->'settings'->>'application_owner_user_id')),
        'execution',$3::jsonb || jsonb_build_object('recoveries',1,'legacyResumedAt',NOW(),'eventIds',COALESCE((
          SELECT jsonb_agg(e.id) FROM (SELECT id FROM scheduled_job_ingestion_events
            WHERE processing_status IN ('pending','failed')
               OR (processing_status='processing' AND updated_at<NOW()-INTERVAL '30 minutes')
            ORDER BY attempts ASC,ingested_at ASC,id
            LIMIT GREATEST(0,COALESCE((r.config_snapshot->>'jobsPerRun')::int,$4)-r.jobs_seen)
          ) e), '[]'::jsonb)))
      WHERE r.run_key=$1 AND r.status='failed' AND NOT(r.config_snapshot ? 'execution')
        AND r.error_message LIKE 'Legacy batch stopped without finalizing.%'
        AND r.jobs_seen<COALESCE((r.config_snapshot->>'jobsPerRun')::int,$4)
        AND r.ai_calls<COALESCE((r.config_snapshot->>'aiCallsPerRun')::int,($2::jsonb->'settings'->>'ai_calls_per_run')::int)
        AND r.applications_created<COALESCE((r.config_snapshot->>'maxQueuedPerRun')::int,($2::jsonb->'settings'->>'max_applications_per_run')::int)
        AND NOT EXISTS(SELECT 1 FROM scheduled_candidate_logging_runs WHERE status='running')`,
    [input.runKey,JSON.stringify(input.snapshot),JSON.stringify(execution),input.jobsPerRun]),
    db.query(`SELECT * FROM scheduled_candidate_logging_runs WHERE run_key = $1 OR status = 'running'
      ORDER BY (run_key = $1) DESC, (status = 'running') DESC, started_at ASC LIMIT 1`, [input.runKey]),
  ]);
  const run = (result[3] as LoggingRun[])[0];
  if (!run) throw new Error("Could not enqueue scheduled logging batch.");
  return run;
}

export async function claimLoggingRun(claim = true): Promise<LoggingRun | null> {
  const db = sql();
  const token = randomUUID();
  const result = await db.transaction([
    db.query(LOCK),
    // Match the run -> event lock order used by result writers. Otherwise a
    // transaction crossing the lease expiry boundary could deadlock recovery.
    db.query(`SELECT id FROM scheduled_candidate_logging_runs
      WHERE status = 'running' AND config_snapshot->'execution'->>'phase' = 'working'
        AND (config_snapshot->'execution'->>'leaseUntil')::timestamptz <= NOW()
      ORDER BY id FOR UPDATE`),
    // Release only the event recorded by an expired executor. A stale worker
    // cannot reclaim it: all subsequent writes also require its lease token.
    db.query(`UPDATE scheduled_job_ingestion_events e SET processing_status = 'pending', updated_at = NOW(),
      last_error = 'Interrupted scheduled logging chunk; safely returned to the queue.'
      FROM scheduled_candidate_logging_runs r
      WHERE r.status = 'running' AND r.config_snapshot->'execution'->>'phase' = 'working'
        AND (r.config_snapshot->'execution'->>'leaseUntil')::timestamptz <= NOW()
        AND e.id::text = r.config_snapshot->'execution'->>'currentEventId' AND e.processing_status = 'processing'`),
    db.query(`UPDATE scheduled_candidate_logging_runs r SET
      status = CASE WHEN COALESCE((config_snapshot->'execution'->>'recoveries')::int, 0) >= $1 THEN 'failed' ELSE 'running' END,
      finished_at = CASE WHEN COALESCE((config_snapshot->'execution'->>'recoveries')::int, 0) >= $1 THEN NOW() ELSE NULL END,
      error_message = 'An interrupted chunk was recovered. Completed decisions and review items were retained.',
      config_snapshot = jsonb_set(config_snapshot, '{execution}', config_snapshot->'execution' ||
        jsonb_build_object('phase','queued','leaseToken',NULL,'leaseUntil',NULL,'currentEventId',NULL,
          'heartbeatAt',NOW(), 'recoveries',COALESCE((config_snapshot->'execution'->>'recoveries')::int,0)+1))
      WHERE status = 'running' AND config_snapshot->'execution'->>'phase' = 'working'
        AND (config_snapshot->'execution'->>'leaseUntil')::timestamptz <= NOW()`, [MAX_RECOVERIES]),
    // Old deployments had no lease/heartbeat. Use persisted activity, not
    // just the start time, before marking such a genuinely orphaned run failed.
    db.query(`UPDATE scheduled_candidate_logging_runs r SET status = 'failed', finished_at = NOW(),
      error_message = 'Legacy batch stopped without finalizing. Saved reviews were retained; unfinished jobs remain recoverable.'
      WHERE r.status = 'running' AND NOT (r.config_snapshot ? 'execution')
        AND GREATEST(r.started_at,
          COALESCE((SELECT MAX(created_at) FROM scheduled_candidate_logging_ai_events WHERE run_id = r.id),r.started_at),
          COALESCE((SELECT MAX(updated_at) FROM scheduled_candidate_logging_decisions WHERE run_id = r.id),r.started_at))
          < NOW() - INTERVAL '5 minutes'`),
    db.query(`UPDATE scheduled_job_ingestion_events e SET processing_status='pending',updated_at=NOW(),
      last_error='Unowned legacy claim recovered after its processing lease expired.'
      WHERE e.processing_status='processing' AND e.updated_at<NOW()-INTERVAL '30 minutes'
        AND NOT EXISTS(SELECT 1 FROM scheduled_candidate_logging_runs r
          WHERE r.status='running' AND (
            (NOT(r.config_snapshot ? 'execution') AND GREATEST(r.started_at,
              COALESCE((SELECT MAX(created_at) FROM scheduled_candidate_logging_ai_events WHERE run_id=r.id),r.started_at),
              COALESCE((SELECT MAX(updated_at) FROM scheduled_candidate_logging_decisions WHERE run_id=r.id),r.started_at)) >= NOW()-INTERVAL '5 minutes')
            OR (r.config_snapshot->'execution'->>'currentEventId'=e.id::text
              AND (r.config_snapshot->'execution'->>'leaseUntil')::timestamptz>NOW())))`),
    db.query(`UPDATE scheduled_candidate_logging_runs r SET
      applications_created = GREATEST(applications_created,(SELECT COUNT(*) FROM candidate_job_review_queue q
        JOIN scheduled_candidate_logging_decisions d ON d.id=q.source_decision_id WHERE d.run_id=r.id)),
      skipped_count = GREATEST(skipped_count,(SELECT COUNT(*) FROM scheduled_candidate_logging_decisions
        WHERE run_id=r.id AND status NOT IN ('pending','pending_review','ai_failed'))),
      failed_count = GREATEST(failed_count,(SELECT COUNT(*) FROM scheduled_candidate_logging_ai_events WHERE run_id=r.id AND status='failed')),
      input_tokens = GREATEST(input_tokens,COALESCE((SELECT SUM(input_tokens) FROM scheduled_candidate_logging_ai_events WHERE run_id=r.id),0)),
      output_tokens = GREATEST(output_tokens,COALESCE((SELECT SUM(output_tokens) FROM scheduled_candidate_logging_ai_events WHERE run_id=r.id),0)),
      config_snapshot = jsonb_set(config_snapshot, '{execution}',
      config_snapshot->'execution' || jsonb_build_object('phase','working','leaseToken',$1::text,
        'leaseUntil',NOW() + make_interval(secs => $2),'heartbeatAt',NOW()))
      WHERE r.id = (SELECT id FROM scheduled_candidate_logging_runs
        WHERE $3::boolean AND status = 'running' AND config_snapshot ? 'execution'
          AND config_snapshot->'execution'->>'phase' IN ('queued','waiting')
          AND COALESCE((config_snapshot->'execution'->>'nextAttemptAt')::timestamptz, NOW()) <= NOW()
        ORDER BY started_at ASC LIMIT 1)
      RETURNING *`, [token, RUN_LEASE_SECONDS, claim]),
  ]);
  return (result[6] as LoggingRun[])[0] ?? null;
}

/** Fence a short transaction before any decision, review, or event writes. */
export async function leasedWrites(run: LoggingRun, statements: { text: string; values: unknown[] }[]) {
  const db = sql();
  const token = run.config_snapshot.execution.leaseToken;
  const results = await db.transaction([
    db.query(`SELECT r.id FROM scheduled_candidate_logging_runs r WHERE r.id = $1 AND ${LIVE_LEASE} FOR UPDATE`, [run.id, token]),
    ...statements.map(statement => db.query(statement.text, statement.values)),
  ]);
  // Statements themselves must be gated by the lease predicate; checking a
  // previous SELECT in JS would leave a race at the expiry boundary.
  if (!(results[0] as unknown[]).length) throw new ScheduledLoggingLeaseLost();
  return results.slice(1);
}

export function leasePredicate(run: LoggingRun, offset: number): { text: string; values: unknown[] } {
  return {
    text: `EXISTS (SELECT 1 FROM scheduled_candidate_logging_runs r WHERE r.id = $${offset} AND r.status = 'running'
      AND r.config_snapshot->'execution'->>'leaseToken' = $${offset + 1}
      AND (r.config_snapshot->'execution'->>'leaseUntil')::timestamptz > NOW())`,
    values: [run.id, run.config_snapshot.execution.leaseToken],
  };
}

export async function checkpointLoggingRun(run: LoggingRun, state: ExecutionState, status: LoggingRun["status"] = "running", error: string | null = null) {
  const row = await queryOne<{ id: string }>(`UPDATE scheduled_candidate_logging_runs r SET
      jobs_seen=$3, candidate_pairs_scored=$4, applications_created=$5, skipped_count=$6, failed_count=$7,
      ai_calls=$8, input_tokens=$9, output_tokens=$10,
      config_snapshot=jsonb_set(config_snapshot,'{execution}',$11::jsonb),status=$12,error_message=$13,
      finished_at=CASE WHEN $12::text = 'running' THEN NULL ELSE NOW() END
    WHERE r.id=$1 AND ${LIVE_LEASE} RETURNING id`,
  [run.id, run.config_snapshot.execution.leaseToken, run.jobs_seen, run.candidate_pairs_scored,
    run.applications_created, run.skipped_count, run.failed_count, run.ai_calls, run.input_tokens, run.output_tokens,
    JSON.stringify({ ...state, heartbeatAt: new Date().toISOString() }), status, error]);
  if (!row) throw new ScheduledLoggingLeaseLost();
  run.config_snapshot.execution = state;
  run.status = status;
}
