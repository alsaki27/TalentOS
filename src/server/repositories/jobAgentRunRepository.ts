// src/server/repositories/jobAgentRunRepository.ts
// Data-access abstraction for job_agent_runs and job_agent_staged_jobs.

import { query, queryOne, execute } from "@/server/db/neon";

export interface JobAgentRunRow {
  id: string;
  config_id: string;
  token_id: string | null;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  status: string;
  actor_source: string;       // "indeed" | "google" | "linkedin"
  raw_count: number;
  deduped_count: number;
  imported_count: number;
  skipped_count: number;
  classified_count: number;
  estimated_cost_usd: number;
  error: string | null;
  role_groups_ran: string[] | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface JobAgentRunSummary extends JobAgentRunRow {
  best_count: number;
  medium_count: number;
  worthy_count: number;
  skip_count: number;
  staged_count: number;
}

export interface JobAgentStagedJobRow {
  id: string;
  run_id: string;
  job_title: string;
  company_name: string | null;
  location: string | null;
  salary_range: string | null;
  salary_min: number | null;
  salary_max: number | null;
  date_posted: string | null;
  via_platform: string | null;
  source_url: string | null;
  apply_link: string | null;
  is_remote: boolean | null;
  employment_type: string | null;
  search_query_used: string | null;
  role_group: string | null;
  role_group_label: string | null;
  seniority_guess: string | null;
  tier: string | null;
  tier_reason: string | null;
  ai_keywords: string[] | null;
  relevance_score: number | null;
  is_false_positive: boolean;
  dedup_hash: string | null;
  source_url_hash: string | null;  // URL fingerprint for cross-actor dedup
  is_duplicate: boolean;
  import_status: string;
  imported_job_id: string | null;
  created_at: string;
  // openjobdata-sourced fields — null for Apify-sourced rows.
  description_text: string | null;
  company_website: string | null;
  external_job_id: string | null;
  country: string | null;
  industry: string | null;
}

const RUN_COLUMNS = `
  id, config_id, token_id, apify_run_id, apify_dataset_id, status, actor_source, raw_count,
  deduped_count, imported_count, skipped_count, classified_count,
  estimated_cost_usd, error, role_groups_ran, started_at, completed_at, created_at
`;

/**
 * Create a pending run row.
 */
export async function createRun(
  configId: string,
  roleGroups: string[],
  tokenId: string | null,
  actorSource: string = "indeed"
): Promise<JobAgentRunRow> {
  const row = await queryOne<JobAgentRunRow>(
    `INSERT INTO job_agent_runs (config_id, token_id, status, role_groups_ran, actor_source)
     VALUES ($1, $2, 'pending', $3, $4) RETURNING ${RUN_COLUMNS}`,
    [configId, tokenId, roleGroups, actorSource]
  );
  if (!row) throw new Error("Failed to create job agent run");
  return row;
}

/**
 * Partial update of a run row.
 */
export async function updateRunStatus(
  id: string,
  updates: Partial<Omit<JobAgentRunRow, "id" | "created_at">>
): Promise<JobAgentRunRow> {
  const keys = Object.keys(updates).filter((k) => (updates as any)[k] !== undefined);
  if (keys.length === 0) throw new Error("No fields to update");
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => (updates as any)[k]);
  values.push(id);
  const row = await queryOne<JobAgentRunRow>(
    `UPDATE job_agent_runs SET ${setClause} WHERE id = $${keys.length + 1} RETURNING ${RUN_COLUMNS}`,
    values
  );
  if (!row) throw new Error("Run update failed");
  return row;
}

/**
 * Atomic conditional status transition -- distributed mutex for processing.
 * Only applies when the run is currently in fromStatus.
 * Returns true if this caller won (row was updated), false otherwise.
 */
export async function transitionRunStatus(
  id: string,
  fromStatus: string,
  updates: Partial<Omit<JobAgentRunRow, "id" | "created_at">>
): Promise<boolean> {
  const keys = Object.keys(updates).filter((k) => (updates as any)[k] !== undefined);
  if (keys.length === 0) throw new Error("No fields to update");
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => (updates as any)[k]);
  values.push(id, fromStatus);
  const row = await queryOne<JobAgentRunRow>(
    `UPDATE job_agent_runs SET ${setClause}
     WHERE id = $${keys.length + 1} AND status = $${keys.length + 2}
     RETURNING id`,
    values
  );
  return row !== null && row !== undefined;
}

/**
 * List recent runs, optionally filtered by configId.
 */
export async function listRuns(
  opts: { configId?: string; limit?: number } = {}
): Promise<JobAgentRunSummary[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));

  const rows = await query<JobAgentRunRow>(
    `SELECT ${RUN_COLUMNS} FROM job_agent_runs
     WHERE ($1::uuid IS NULL OR config_id = $1::uuid)
     ORDER BY started_at DESC LIMIT $2`,
    [opts.configId ?? null, limit]
  );
  return Promise.all(rows.map((r) => summarizeRun(r)));
}

/**
 * List all runs currently in an active state (running or pending, waiting for Apify metadata).
 */
export async function listRunningRuns(): Promise<JobAgentRunRow[]> {
  const rows = await query<JobAgentRunRow>(
    `SELECT ${RUN_COLUMNS} FROM job_agent_runs WHERE status IN ('running', 'pending', 'processing')`
  );
  return rows;
}

/**
 * Mark any run stuck in running/pending/processing for more than the given
 * threshold as failed. This prevents the dashboard from showing the live-feed
 * spinner forever when a run dies mid-flight (e.g. Cloudflare timeout).
 * Returns the number of runs cleaned up.
 */
export async function cleanupStuckRuns(thresholdMinutes = 30): Promise<number> {
  const res = await execute(
    `UPDATE job_agent_runs
     SET status = 'failed',
         error = 'Run timed out — automatically marked failed after ${thresholdMinutes} minutes',
         completed_at = NOW()
     WHERE status IN ('running', 'pending', 'processing')
       AND started_at < NOW() - INTERVAL '${thresholdMinutes} minutes'
     RETURNING id`
  );
  return res.rowCount ?? 0;
}

/**
 * Get a single run with tier-count summary.
 */
export async function getRunById(id: string): Promise<JobAgentRunSummary | null> {
  const row = await queryOne<JobAgentRunRow>(
    `SELECT ${RUN_COLUMNS} FROM job_agent_runs WHERE id = $1`,
    [id]
  );
  return row ? summarizeRun(row) : null;
}

async function summarizeRun(run: JobAgentRunRow): Promise<JobAgentRunSummary> {
  const tierCounts = await getTierCounts(run.id);
  const stagedCount = await countStagedJobs(run.id);
  return { ...run, ...tierCounts, staged_count: stagedCount };
}

async function getTierCounts(runId: string): Promise<{
  best_count: number;
  medium_count: number;
  worthy_count: number;
  skip_count: number;
}> {
  const sql = `
    SELECT
      COUNT(*) FILTER (WHERE tier = 'best') AS best_count,
      COUNT(*) FILTER (WHERE tier = 'medium') AS medium_count,
      COUNT(*) FILTER (WHERE tier = 'worthy') AS worthy_count,
      COUNT(*) FILTER (WHERE tier = 'skip') AS skip_count
    FROM job_agent_staged_jobs
    WHERE run_id = $1
  `;

  const row = await queryOne<{ best_count: number; medium_count: number; worthy_count: number; skip_count: number }>(
    sql,
    [runId]
  );
  return {
    best_count: row?.best_count ?? 0,
    medium_count: row?.medium_count ?? 0,
    worthy_count: row?.worthy_count ?? 0,
    skip_count: row?.skip_count ?? 0,
  };
}

async function countStagedJobs(runId: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM job_agent_staged_jobs WHERE run_id = $1`,
    [runId]
  );
  return row?.count ?? 0;
}

/**
 * Bulk insert staged jobs.
 */
export async function insertStagedJobs(
  runId: string,
  jobs: Omit<JobAgentStagedJobRow, "id" | "created_at">[]
): Promise<void> {
  if (jobs.length === 0) return;

  const cols = [
    "run_id", "job_title", "company_name", "location", "salary_range", "salary_min",
    "salary_max", "date_posted", "via_platform", "source_url", "apply_link", "is_remote",
    "employment_type", "search_query_used", "role_group", "role_group_label",
    "seniority_guess", "tier", "tier_reason", "ai_keywords", "relevance_score",
    "is_false_positive", "dedup_hash", "source_url_hash", "is_duplicate", "import_status",
    "imported_job_id", "description_text", "company_website", "external_job_id", "country", "industry",
  ];
  const values: (string | number | boolean | string[] | null)[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;

  for (const job of jobs) {
    const rowPlaceholders: string[] = [];
    for (const col of cols) {
      rowPlaceholders.push(`$${paramIdx++}`);
      values.push((job as any)[col] ?? null);
    }
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
  }

  const sql = `INSERT INTO job_agent_staged_jobs (${cols.join(", ")}) VALUES ${placeholders.join(", ")}`;
  await execute(sql, values);
}

export interface ListStagedJobsFilters {
  tier?: string;
  group?: string;
  importStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

/**
 * List staged jobs for a run, with optional filters and pagination.
 */
export async function listStagedJobs(
  runId: string,
  filters: ListStagedJobsFilters = {}
): Promise<{ items: JobAgentStagedJobRow[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(1, Math.min(filters.pageSize ?? 50, 100));

  const conditions: string[] = ["run_id = $1"];
  const values: (string | number)[] = [runId];
  let idx = 2;

  if (filters.tier) {
    conditions.push(`tier = $${idx++}`);
    values.push(filters.tier);
  }
  if (filters.group) {
    conditions.push(`role_group = $${idx++}`);
    values.push(filters.group);
  }
  if (filters.importStatus) {
    conditions.push(`import_status = $${idx++}`);
    values.push(filters.importStatus);
  }
  if (filters.search) {
    conditions.push(`(job_title ILIKE $${idx} OR company_name ILIKE $${idx} OR location ILIKE $${idx})`);
    values.push(`%${filters.search}%`);
    idx++;
  }

  const where = conditions.join(" AND ");
  const countSql = `SELECT COUNT(*)::int as total FROM job_agent_staged_jobs WHERE ${where}`;
  const dataSql = `SELECT * FROM job_agent_staged_jobs WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  values.push(pageSize, (page - 1) * pageSize);

  const countRow = await queryOne<{ total: number }>(countSql, values.slice(0, -2));
  const items = await query<JobAgentStagedJobRow>(dataSql, values);

  return { items: items ?? [], total: countRow?.total ?? 0 };
}

/**
 * Update the import status of a single staged job.
 */
export async function updateStagedJobStatus(
  id: string,
  status: string,
  importedJobId?: string | null
): Promise<void> {
  const updates: Record<string, unknown> = { import_status: status };
  if (importedJobId !== undefined) updates.imported_job_id = importedJobId ?? null;

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = Object.values(updates);
  values.push(id);
  await execute(
    `UPDATE job_agent_staged_jobs SET ${setClause} WHERE id = $${keys.length + 1}`,
    values
  );
}

/**
 * Bulk update import_status for staged jobs matching a run + optional tier.
 * Returns the number of rows updated.
 */
export async function bulkUpdateStagedJobStatus(
  runId: string,
  status: string,
  opts: { tier?: string; excludeImportStatus?: string; jobIds?: string[] } = {}
): Promise<number> {
  const conditions: string[] = ["run_id = $1"];
  const values: (string | string[])[] = [runId];
  let idx = 2;

  if (opts.tier) {
    conditions.push(`tier = $${idx++}`);
    values.push(opts.tier);
  }
  if (opts.excludeImportStatus) {
    conditions.push(`import_status <> $${idx++}`);
    values.push(opts.excludeImportStatus);
  }
  if (opts.jobIds && opts.jobIds.length > 0) {
    conditions.push(`id = ANY($${idx++})`);
    values.push(opts.jobIds);
  }

  const where = conditions.join(" AND ");
  const res = await execute(
    `UPDATE job_agent_staged_jobs SET import_status = $${idx++} WHERE ${where}`,
    [...values, status]
  );
  return res.rowCount;
}

/**
 * Sum estimated_cost_usd for today's runs for a config.
 */
export async function getTodaySpend(configId: string): Promise<number> {
  const row = await queryOne<{ total: number }>(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
     FROM job_agent_runs
     WHERE config_id = $1 AND started_at >= CURRENT_DATE`,
    [configId]
  );
  return Number(row?.total ?? 0);
}

/**
 * Return a set of dedup hashes that already exist in staged jobs from the past 30 days.
 */
export async function getDedupHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const rows = await query<{ dedup_hash: string }>(
    `SELECT DISTINCT dedup_hash FROM job_agent_staged_jobs
     WHERE dedup_hash = ANY($1) AND created_at >= $2`,
    [hashes, sinceIso]
  );
  return new Set(rows.map((r) => r.dedup_hash));
}

/**
 * Return a set of source_url_hash values that already exist in staged jobs from the past 30 days.
 * Used for cross-actor URL-fingerprint deduplication.
 */
export async function getSourceUrlHashes(hashes: string[]): Promise<Set<string>> {
  if (hashes.length === 0) return new Set();

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceIso = since.toISOString();

  const rows = await query<{ source_url_hash: string }>(
    `SELECT DISTINCT source_url_hash FROM job_agent_staged_jobs
     WHERE source_url_hash = ANY($1) AND source_url_hash IS NOT NULL AND created_at >= $2`,
    [hashes, sinceIso]
  );
  return new Set(rows.map((r) => r.source_url_hash));
}