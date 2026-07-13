// src/server/repositories/jobsRepository.ts
// Data-access abstraction for the jobs table.

import { query, queryOne, execute } from "@/server/db/neon";

export interface JobRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  source: string | null;
  raw_description: string | null;
  parsed_description: Record<string, unknown> | null;
  ai_extracted_at: string | null;
  ai_confidence_score: number | null;
  employment_type: string | null;
  seniority_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_range: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateJobInput {
  title: string | null;
  company?: string | null;
  location?: string | null;
  source?: string;
  source_url?: string | null;
  raw_description?: string | null;
  parsed_description?: Record<string, unknown> | null;
  ai_extracted_at?: string | null;
  ai_confidence_score?: number | null;
  employment_type?: string | null;
  seniority_level?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  salary_range?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface DuplicateCheckInput {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  sourceUrl?: string | null;
}

export interface DuplicateCheckResult {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  matchType: "exact_url" | "exact_match" | "fuzzy";
  matchScore: number;
}

function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchKey(title: string, company?: string | null, location?: string | null): string {
  return `${normalizeForMatch(title)}|${normalizeForMatch(company)}|${normalizeForMatch(location)}`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Find a job by its primary key.
 */
export async function findJobById(id: string): Promise<JobRow | null> {
  const row = await queryOne<JobRow>(
    `SELECT * FROM jobs WHERE id = $1`,
    [id]
  );
  return row ?? null;
}

/**
 * Create a new job row from parsed JD data.
 */
export async function createJobFromParsedJD(input: CreateJobInput): Promise<JobRow> {
  const row = await queryOne<JobRow>(
    `INSERT INTO jobs (
      title, company, location, source, source_url,
      raw_description, parsed_description, ai_extracted_at, ai_confidence_score,
      employment_type, seniority_level, salary_min, salary_max,
      salary_currency, salary_period, salary_range, notes, is_active
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12, $13,
      $14, $15, $16, $17, $18
    ) RETURNING *`,
    [
      input.title ?? null,
      input.company ?? null,
      input.location ?? null,
      input.source ?? "manual",
      input.source_url ?? null,
      input.raw_description ?? null,
      input.parsed_description ?? null,
      input.ai_extracted_at ?? null,
      input.ai_confidence_score ?? null,
      input.employment_type ?? null,
      input.seniority_level ?? null,
      input.salary_min ?? null,
      input.salary_max ?? null,
      input.salary_currency ?? null,
      input.salary_period ?? null,
      input.salary_range ?? null,
      input.notes ?? null,
      input.is_active ?? true,
    ]
  );
  if (!row) throw new Error("Failed to insert job");
  return row;
}

/**
 * Three-pass duplicate detection for jobs.
 * 1. Exact source_url match
 * 2. Exact normalized title+company+location match
 * 3. Fuzzy Levenshtein match (title >= 0.90, company >= 0.86, location >= 0.86)
 */
export async function findPotentialDuplicateJobs(
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult[]> {
  const results: DuplicateCheckResult[] = [];

  // 1. Exact URL match
  if (input.sourceUrl) {
    const urlMatches = await query<Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">>(
      `SELECT id, title, company, location, source_url FROM jobs WHERE source_url = $1`,
      [input.sourceUrl]
    );
    for (const job of urlMatches) {
      results.push({
        id: job.id,
        title: job.title,
        company: job.company ?? null,
        location: job.location ?? null,
        source_url: job.source_url ?? null,
        matchType: "exact_url",
        matchScore: 1.0,
      });
    }
  }

  // 2. Exact normalized title+company+location match
  const nTitle = normalizeForMatch(input.title);
  const nCompany = normalizeForMatch(input.company);
  const nLocation = normalizeForMatch(input.location);

  if (nTitle && nCompany) {
    const exactMatches = await query<Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">>(
      `SELECT id, title, company, location, source_url FROM jobs WHERE title IS NOT NULL`
    );
    for (const job of exactMatches) {
      if (results.some((r) => r.id === job.id)) continue;
      const jobKey = matchKey(job.title ?? "", job.company, job.location);
      const inputKey = matchKey(input.title ?? "", input.company, input.location);
      if (jobKey === inputKey) {
        results.push({
          id: job.id,
          title: job.title,
          company: job.company ?? null,
          location: job.location ?? null,
          source_url: job.source_url ?? null,
          matchType: "exact_match",
          matchScore: 1.0,
        });
      }
    }
  }

  // 3. Fuzzy match against all existing jobs
  if (nTitle && nCompany) {
    const allJobs = await query<Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">>(
      `SELECT id, title, company, location, source_url FROM jobs WHERE title IS NOT NULL`
    );
    for (const job of allJobs) {
      if (results.some((r) => r.id === job.id)) continue;
      const existingTitle = normalizeForMatch(job.title);
      const existingCompany = normalizeForMatch(job.company);
      const existingLocation = normalizeForMatch(job.location);

      const titleSim = existingTitle ? similarity(nTitle, existingTitle) : 0;
      const companySim = nCompany && existingCompany ? similarity(nCompany, existingCompany) : 1;
      const locationSim = nLocation && existingLocation ? similarity(nLocation, existingLocation) : 1;

      const score = (titleSim + companySim + locationSim) / 3;

      if (titleSim >= 0.9 && companySim >= 0.86 && locationSim >= 0.86) {
        results.push({
          id: job.id,
          title: job.title,
          company: job.company ?? null,
          location: job.location ?? null,
          source_url: job.source_url ?? null,
          matchType: "fuzzy",
          matchScore: Math.round(score * 1000) / 1000,
        });
      }
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * List all active jobs for listing/dedup purposes.
 * Minimal fields: id, title, company, location, source_url.
 */
export async function listJobsForDedupe(): Promise<
  Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">[]
> {
  const rows = await query<Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">>(
    `SELECT id, title, company, location, source_url FROM jobs WHERE title IS NOT NULL AND is_active = true`
  );
  return rows ?? [];
}

// ───────────────────────────────────────────────────────────────
// Update / Delete
// ───────────────────────────────────────────────────────────────

export async function updateJob(
  id: string,
  updates: Record<string, unknown>
): Promise<JobRow> {
  const keys = Object.keys(updates).filter((k) => updates[k] !== undefined);
  if (keys.length === 0) throw new Error("No fields to update");
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
  values.push(id);
  const sql = `UPDATE jobs SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`;
  const result = await queryOne<JobRow>(sql, values);
  if (!result) throw new Error("Update failed");
  return result;
}

export async function deleteJob(id: string): Promise<void> {
  await execute("DELETE FROM jobs WHERE id = $1", [id]);
}

// ───────────────────────────────────────────────────────────────
// Listing / counts
// ───────────────────────────────────────────────────────────────

export async function listJobs(
  opts: { source?: string | null; role_tier?: string | null; job_category?: string | null; is_active?: boolean | null; search?: string | null; limit?: number } = {}
): Promise<JobRow[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 50));
  const conditions: string[] = [];
  const values: (string | number | boolean | null)[] = [];
  let idx = 1;
  if (opts.source) {
    conditions.push(`source = $${idx++}`);
    values.push(opts.source);
  }
  if (opts.role_tier) {
    conditions.push(`role_tier = $${idx++}`);
    values.push(opts.role_tier);
  }
  if (opts.job_category) {
    conditions.push(`job_category = $${idx++}`);
    values.push(opts.job_category);
  }
  if (opts.is_active !== undefined && opts.is_active !== null) {
    conditions.push(`is_active = $${idx++}`);
    values.push(opts.is_active);
  }
  if (opts.search) {
    conditions.push(`(title ILIKE $${idx++} OR company ILIKE $${idx++} OR location ILIKE $${idx++})`);
    values.push(`%${opts.search}%`, `%${opts.search}%`, `%${opts.search}%`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sql = `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT $${idx}`;
  values.push(limit);
  return query<JobRow>(sql, values);
}

export async function countJobs(): Promise<number> {
  const row = await queryOne<{ count: number }>("SELECT COUNT(*)::int as count FROM jobs");
  return row?.count ?? 0;
}

export async function countJobsSince(since: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM jobs WHERE created_at >= $1",
    [since]
  );
  return row?.count ?? 0;
}

// ───────────────────────────────────────────────────────────────
// Crawler / dedup helpers
// ───────────────────────────────────────────────────────────────

export async function findJobByExternalIdAndSource(
  externalId: string,
  source: string
): Promise<JobRow | null> {
  return queryOne<JobRow>(
    "SELECT * FROM jobs WHERE external_job_id = $1 AND source = $2",
    [externalId, source]
  );
}

export async function createJob(row: Record<string, unknown>): Promise<JobRow> {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = cols.map((c) => row[c]);
  const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
  const result = await queryOne<JobRow>(sql, values);
  if (!result) throw new Error("Failed to insert job");
  return result;
}

export async function createJobs(rows: Record<string, any>[]): Promise<JobRow[]> {
  if (rows.length === 0) return [];
  const cols = Object.keys(rows[0]);
  const values: (string | number | boolean | null | Date | object)[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;
  for (const row of rows) {
    const rowPlaceholders: string[] = [];
    for (const col of cols) {
      rowPlaceholders.push(`$${paramIdx++}`);
      values.push((row as Record<string, any>)[col] ?? null);
    }
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
  }
  const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;
  return query<JobRow>(sql, values);
}

export async function findJobsBySourceUrls(urls: string[]): Promise<{ source_url: string }[]> {
  if (urls.length === 0) return [];
  return query<{ source_url: string }>(
    "SELECT source_url FROM jobs WHERE source_url = ANY($1)",
    [urls]
  );
}

export async function updateJobsLastSeenAtByUrls(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  await execute(
    "UPDATE jobs SET last_seen_at = $1 WHERE source_url = ANY($2)",
    [new Date().toISOString(), urls]
  );
}

export async function findJobsForSignatureDedupe(): Promise<{ title: string; company: string | null; posted_at: string | null; applicants_count: number | null }[]> {
  return query<{ title: string; company: string | null; posted_at: string | null; applicants_count: number | null }>(
    "SELECT title, company, posted_at, applicants_count FROM jobs WHERE posted_at IS NOT NULL AND applicants_count IS NOT NULL"
  );
}

export async function findJobsBySourceUrlWithId(urls: string[]): Promise<{ id: string; source_url: string }[]> {
  if (urls.length === 0) return [];
  return query<{ id: string; source_url: string }>(
    "SELECT id, source_url FROM jobs WHERE source_url = ANY($1)",
    [urls]
  );
}

export async function updateJobBySourceUrl(sourceUrl: string, updates: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(updates).filter((k) => updates[k] !== undefined);
  if (keys.length === 0) return;
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
  const values = keys.map((k) => updates[k]) as (string | number | boolean | null | Date | object)[];
  values.push(sourceUrl);
  await execute(
    `UPDATE jobs SET ${setClause} WHERE source_url = $${keys.length + 1}`,
    values
  );
}

export async function listAllJobsForFuzzyDedupe(): Promise<{ title: string; company: string | null; location: string | null }[]> {
  return query<{ title: string; company: string | null; location: string | null }>(
    "SELECT title, company, location FROM jobs WHERE title IS NOT NULL"
  );
}
