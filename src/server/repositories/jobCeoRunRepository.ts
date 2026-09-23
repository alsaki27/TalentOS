import { query, queryOne, execute } from "@/server/db/neon";
import type { JobCeoRunStatus } from "@/lib/ai/job-agents/types";

export interface JobCeoRunRow {
  id: string;
  status: JobCeoRunStatus;
  source: string | null;
  trigger_type: string | null;
  ingested_count: number;
  kept_count: number;
  researched_count: number;
  matched_count: number;
  logged_count: number;
  skipped_count: number;
  scout_terms: unknown;
  plan_notes: string | null;
  last_error: string | null;
  started_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobCeoRunStats {
  totalRuns: number;
  activeRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalLogged: number;
}

export async function createRun(input: {
  source?: string;
  triggerType?: string;
  startedBy?: string;
  scoutTerms?: unknown;
}): Promise<JobCeoRunRow> {
  var rows = await query<JobCeoRunRow>(
    `INSERT INTO job_ceo_runs (source, trigger_type, started_by, scout_terms)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.source ?? "openjobdata", input.triggerType ?? "manual", input.startedBy ?? null, input.scoutTerms ? JSON.stringify(input.scoutTerms) : null]
  );
  return rows[0];
}

export async function findRunById(id: string): Promise<JobCeoRunRow | null> {
  return queryOne<JobCeoRunRow>("SELECT * FROM job_ceo_runs WHERE id = $1", [id]);
}

export async function updateRunStatus(
  id: string,
  status: JobCeoRunStatus,
  patch?: { last_error?: string; plan_notes?: string; scout_terms?: unknown }
): Promise<void> {
  var fields = ["status = $1", "updated_at = NOW()"];
  var values: unknown[] = [status];
  var idx = 2;

  if (patch?.last_error !== undefined) {
    fields.push("last_error = $" + idx);
    values.push(patch.last_error);
    idx++;
  }
  if (patch?.plan_notes !== undefined) {
    fields.push("plan_notes = $" + idx);
    values.push(patch.plan_notes);
    idx++;
  }
  if (patch?.scout_terms !== undefined) {
    fields.push("scout_terms = $" + idx);
    values.push(patch.scout_terms ? JSON.stringify(patch.scout_terms) : null);
    idx++;
  }

  values.push(id);
  await execute(
    "UPDATE job_ceo_runs SET " + fields.join(", ") + " WHERE id = $" + idx,
    values
  );
}

export async function bumpRunCounts(
  id: string,
  deltas: { ingested_count?: number; kept_count?: number; researched_count?: number; matched_count?: number; logged_count?: number; skipped_count?: number }
): Promise<void> {
  var sets: string[] = [];
  var values: unknown[] = [];
  var idx = 1;

  var fields = ["ingested_count", "kept_count", "researched_count", "matched_count", "logged_count", "skipped_count"] as const;
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var d = deltas[f] as number | undefined;
    if (d !== undefined && d !== 0) {
      sets.push(f + " = " + f + " + $" + idx);
      values.push(d);
      idx++;
    }
  }

  if (sets.length === 0) return;

  sets.push("updated_at = NOW()");
  values.push(id);
  await execute(
    "UPDATE job_ceo_runs SET " + sets.join(", ") + " WHERE id = $" + idx,
    values
  );
}

export async function findEarliestActiveRun(): Promise<JobCeoRunRow | null> {
  return queryOne<JobCeoRunRow>(
    `SELECT r.*
     FROM job_ceo_runs r
     WHERE r.status IN ('ingesting','qa','deep_fetch','matchmaking')
     ORDER BY
       CASE
         -- Prefer runs that have work for their current stage and whose rows
         -- are available now. This prevents an older empty/stalled run from
         -- starving a newer run that can make progress.
         WHEN r.status = 'ingesting' AND EXISTS (
           SELECT 1 FROM job_ceo_staging s
           WHERE s.run_id = r.id
             AND s.stage = 'ingested'
             AND (s.claim_expires_at IS NULL OR s.claim_expires_at < NOW())
         ) THEN 0
         WHEN r.status = 'qa' AND EXISTS (
           SELECT 1 FROM job_ceo_staging s
           WHERE s.run_id = r.id
             AND s.stage = 'researched'
             AND (s.claim_expires_at IS NULL OR s.claim_expires_at < NOW())
         ) THEN 0
         WHEN r.status = 'deep_fetch' AND EXISTS (
           SELECT 1 FROM job_ceo_staging s
           WHERE s.run_id = r.id
             AND s.stage = 'qa_passed'
             AND (s.claim_expires_at IS NULL OR s.claim_expires_at < NOW())
         ) THEN 0
         -- Matchmaking is the final run-level phase and has no input stage.
         WHEN r.status = 'matchmaking' THEN 0
         ELSE 1
       END ASC,
       -- Round-robin active work by last progress instead of creation time.
       -- A large run therefore cannot monopolize every dispatch invocation.
       r.updated_at ASC,
       r.created_at ASC
     LIMIT 1`
  );
}

export async function listRuns(limit: number): Promise<JobCeoRunRow[]> {
  return query<JobCeoRunRow>(
    "SELECT * FROM job_ceo_runs ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
}

export async function getRunStats(): Promise<JobCeoRunStats> {
  const row = await queryOne<{
    total_runs: number | string;
    active_runs: number | string;
    completed_runs: number | string;
    failed_runs: number | string;
    total_logged: number | string;
  }>(
    `SELECT
       COUNT(*)::int AS total_runs,
       COUNT(*) FILTER (WHERE status IN ('ingesting','qa','deep_fetch','matchmaking'))::int AS active_runs,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_runs,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_runs,
       COALESCE(SUM(logged_count), 0)::int AS total_logged
     FROM job_ceo_runs`
  );

  return {
    totalRuns: Number(row?.total_runs ?? 0),
    activeRuns: Number(row?.active_runs ?? 0),
    completedRuns: Number(row?.completed_runs ?? 0),
    failedRuns: Number(row?.failed_runs ?? 0),
    totalLogged: Number(row?.total_logged ?? 0),
  };
}

export async function deleteRun(id: string): Promise<void> {
  // 1. Collect all logged job IDs and dedup signatures BEFORE we delete staging rows
  const loggedJobIds = await query<{ logged_job_id: string }>(
    "SELECT logged_job_id FROM job_ceo_staging WHERE run_id = $1 AND logged_job_id IS NOT NULL",
    [id]
  );
  const dedupSigs = await query<{ dedup_signature: string }>(
    "SELECT dedup_signature FROM job_ceo_staging WHERE run_id = $1 AND dedup_signature IS NOT NULL",
    [id]
  );

  // 2. Delete logged jobs from the jobs table so next run treats them as fresh
  if (loggedJobIds.length > 0) {
    const ids = loggedJobIds.map((r) => r.logged_job_id);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
    await execute(`DELETE FROM jobs WHERE id IN (${placeholders})`, ids);
  }

  // 3. Remove dedup signatures so next run doesn't skip these jobs
  if (dedupSigs.length > 0) {
    const sigs = dedupSigs.map((r) => r.dedup_signature);
    const placeholders = sigs.map((_, i) => `$${i + 1}`).join(", ");
    await execute(`DELETE FROM job_ceo_seen_signatures WHERE signature IN (${placeholders})`, sigs);
  }

  // 4. Delete all staging rows for this run
  await execute("DELETE FROM job_ceo_staging WHERE run_id = $1", [id]);

  // 5. Delete the run itself
  await execute("DELETE FROM job_ceo_runs WHERE id = $1", [id]);
}
