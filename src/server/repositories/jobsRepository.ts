// src/server/repositories/jobsRepository.ts
// Data-access abstraction for the jobs table.

import { query, queryOne, execute } from "@/server/db/neon";
import { computeApplyLinkFingerprint } from "@/lib/jobUrlFingerprint";
import { computeContentIdentityKey, computeTitleLocationKey } from "@/lib/jobContentIdentity";
import {
  checkJobDuplicate,
  checkJobDuplicatesBatch,
  recordJobIdentities,
  type JobDuplicateMatch,
} from "@/server/services/jobDuplicateGuard";
import {
  checkContentDuplicate,
  checkContentDuplicatesBatch,
  recordDuplicateForReview,
  type ContentDuplicateCandidate,
  type ContentDuplicateCheckResult,
} from "@/server/services/jobContentDuplicateGuard";

function describeContentDuplicateReason(
  existing: { id: string; source: string | null; created_at: string | null },
  basis: "company+title+location" | "title+location+description"
): string {
  const seen = existing.created_at ? new Date(existing.created_at).toISOString().slice(0, 10) : "an earlier date";
  return `Auto-hidden: matched job ${existing.id}${existing.source ? ` (source: ${existing.source})` : ""} on ${basis}, first captured ${seen}. Review and re-activate if this is actually a distinct opening.`;
}

/**
 * Non-column metadata a capture can supply about how its fields were obtained.
 * None of these are stored on `jobs`; they only inform identity resolution.
 *
 * `signals` and `isRemote` are produced by the browser extension today and were
 * being discarded by the capture route - they are the difference between trusting
 * a company value and correctly rejecting "Indeed.com" as an employer.
 */
export interface JobCaptureMeta {
  /** Extra URLs observed for this one posting, e.g. the employer's ATS apply link. */
  identityUrls?: (string | null | undefined)[];
  /** Provenance of the extracted company ("og:site_name" / "title:last" are untrustworthy). */
  signals?: string[] | null;
  isRemote?: boolean | null;
}

/**
 * Reads every identity-relevant value off a row about to be inserted.
 *
 * Remoteness comes ONLY from the caller's explicit flag (and, inside
 * computeLocationBucket, from the title and location text). It deliberately does
 * NOT read the `work_mode` column, even though migration 088 populates that for
 * every creation path: work_mode is maintained by a database trigger, so writing
 * the identity keys re-fires the trigger, which can change work_mode, which
 * changes the computed key - a feedback loop that leaves stored keys disagreeing
 * with the code that reads them. That disagreement is precisely the failure that
 * silently blinds the whole content guard, so identity is derived only from
 * stable, caller-supplied values.
 */
function identityInputs(row: Record<string, unknown>, meta?: JobCaptureMeta) {
  const str = (v: unknown) => (v as string | null | undefined) ?? null;
  const url = str(row.apply_url) ?? str(row.source_url);
  return {
    title: str(row.title),
    company: str(row.company),
    location: str(row.location),
    url,
    signals: meta?.signals ?? null,
    isRemote: meta?.isRemote ?? null,
    descriptionText: str(row.description_text) ?? str(row.raw_description),
    urls: [str(row.apply_url), str(row.source_url), ...(meta?.identityUrls ?? [])],
  };
}

/** The candidate shape the content guard expects, built from a pending row. */
function contentCandidate(
  row: Record<string, unknown>,
  fingerprint: string | null,
  meta?: JobCaptureMeta
): ContentDuplicateCandidate {
  const i = identityInputs(row, meta);
  return {
    title: i.title,
    company: i.company,
    location: i.location,
    url: i.url,
    signals: i.signals,
    isRemote: i.isRemote,
    descriptionText: i.descriptionText,
    fingerprint,
  };
}

/**
 * Stamps both identity keys onto a row about to be inserted.
 *
 * Always runs, whether or not the row turns out to be a duplicate: these keys are
 * what a LATER capture of the same posting is matched against, so a row that is
 * itself brand new still has to be findable. This is the single place they are
 * computed, so the three creation functions below cannot drift apart on it -
 * which they previously had (createJobFromParsedJD stamped neither key, leaving
 * every pasted-JD job permanently invisible to cross-platform matching).
 */
function stampIdentityKeys(row: Record<string, unknown>, meta?: JobCaptureMeta): void {
  const i = identityInputs(row, meta);
  row.content_identity_key = computeContentIdentityKey({
    title: i.title,
    company: i.company,
    location: i.location,
    url: i.url,
    signals: i.signals,
    isRemote: i.isRemote,
  });
  row.title_location_key = computeTitleLocationKey({
    title: i.title,
    location: i.location,
    isRemote: i.isRemote,
  });
}

function applyContentDuplicateResult(row: Record<string, unknown>, check: ContentDuplicateCheckResult): void {
  if (!check.isContentDuplicate) return;
  row.is_active = false;
  row.content_duplicate_of = check.existing.id;
  row.content_duplicate_reason = describeContentDuplicateReason(
    check.existing,
    check.contentIdentityKey ? "company+title+location" : "title+location+description"
  );
}

/**
 * After-insert bookkeeping, shared by every creation path: persist the row's
 * identities so future captures can match on them, and log any auto-hide into the
 * review queue.
 *
 * Reads content_duplicate_of off the row the DATABASE returned rather than the
 * pre-insert object, so a row is only ever queued if it really was stored hidden.
 */
async function recordPostInsert(
  rows: JobRow[],
  urlsById: Map<string, (string | null | undefined)[]>,
  scoreById: Map<string, number>
): Promise<void> {
  await Promise.all([
    ...rows.map((row) => recordJobIdentities(row.id, urlsById.get(row.id) ?? [row.apply_url, row.source_url])),
    ...rows
      .filter((row) => row?.content_duplicate_of)
      .map((row) => recordDuplicateForReview(row.content_duplicate_of!, row.id, scoreById.get(row.id) ?? 0.95)),
  ]);
}

export interface JobRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  apply_url: string | null;
  apply_link_fingerprint: string | null;
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
  content_identity_key: string | null;
  title_location_key: string | null;
  content_duplicate_of: string | null;
  content_duplicate_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateJobInput {
  title: string | null;
  company?: string | null;
  location?: string | null;
  source?: string;
  source_url?: string | null;
  apply_url?: string | null;
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

// Every job-creation function in this file returns this same shape, so a
// duplicate is a typed, unavoidable-to-ignore outcome (TypeScript forces
// every caller to handle both branches) rather than a value that can be
// silently treated as success. "created" carries the new row; "duplicate"
// carries the existing job it matched by apply-link fingerprint, for the
// caller to build a clear rejection message from (see jobDuplicateNotify.ts).
export type CreateJobOutcome =
  | { status: "created"; job: JobRow }
  | { status: "duplicate"; existing: JobDuplicateMatch; fingerprint: string };

function isUniqueViolation(err: any): boolean {
  return err?.code === "23505";
}

// The Neon driver serializes a bare object param as JSON automatically, but
// a bare ARRAY param as a Postgres array literal ({a,b,c}, not [a,b,c]) -
// fine for a genuine array column (jobs has real ones, e.g. category_tags),
// invalid JSON syntax for a jsonb column (confirmed live elsewhere in this
// codebase as the exact cause of an "invalid input syntax for type json"
// bug). Since both column kinds coexist on `jobs`, which columns need this
// fixed up is read from the schema itself rather than hand-maintained as a
// column-name list here - keeps working if a column is added/renamed/typed
// differently later without this file needing to change.
let jsonbColumnsCache: Promise<Set<string>> | null = null;
async function getJsonbColumns(): Promise<Set<string>> {
  if (!jsonbColumnsCache) {
    jsonbColumnsCache = query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'jobs' AND data_type = 'jsonb'`
    ).then((rows) => new Set(rows.map((r) => r.column_name)));
  }
  return jsonbColumnsCache;
}

async function toSqlRow(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const jsonbCols = await getJsonbColumns();
  const out: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    out[col] = Array.isArray(value) && jsonbCols.has(col) ? JSON.stringify(value) : value;
  }
  return out;
}

/**
 * Create a new job row from parsed JD data (the pasted-JD / Quick
 * Application flow). Checks the apply-link fingerprint first - this is a
 * hard block regardless of the route's own separate fuzzy-match advisory
 * (findPotentialDuplicateJobs), which only ever runs *after* this check
 * passes and remains a soft, overridable warning for near-matches that
 * don't share an apply link.
 */
export async function createJobFromParsedJD(input: CreateJobInput): Promise<CreateJobOutcome> {
  // Delegates to createJob rather than carrying its own INSERT. It previously had
  // one, with an explicit column list that omitted content_identity_key and never
  // called the content check at all - so every pasted-JD job was invisible to
  // cross-platform duplicate matching, both as a candidate and as a match target.
  // Routing through the one shared path makes that class of drift impossible.
  return createJob({
    title: input.title ?? null,
    company: input.company ?? null,
    location: input.location ?? null,
    source: input.source ?? "manual",
    source_url: input.source_url ?? null,
    apply_url: input.apply_url ?? null,
    raw_description: input.raw_description ?? null,
    parsed_description: input.parsed_description ?? null,
    ai_extracted_at: input.ai_extracted_at ?? null,
    ai_confidence_score: input.ai_confidence_score ?? null,
    employment_type: input.employment_type ?? null,
    seniority_level: input.seniority_level ?? null,
    salary_min: input.salary_min ?? null,
    salary_max: input.salary_max ?? null,
    salary_currency: input.salary_currency ?? null,
    salary_period: input.salary_period ?? null,
    salary_range: input.salary_range ?? null,
    notes: input.notes ?? null,
    is_active: input.is_active ?? true,
  });
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

/**
 * Create a single job row. Every caller across the app - the admin "Add
 * Job" form, the browser extension capture, the crawler-bot webhook, Job
 * CEO's matchmaker, and any future one - goes through this function (or
 * createJobs below), which is what makes apply-link duplicate protection
 * apply automatically regardless of which part of the codebase is adding
 * the job: a developer writing a brand-new ingestion path gets it for free
 * just by calling createJob() instead of writing a raw INSERT.
 */
export async function createJob(
  row: Record<string, unknown>,
  meta?: JobCaptureMeta
): Promise<CreateJobOutcome> {
  const applyUrl = row.apply_url as string | null | undefined;
  const sourceUrl = row.source_url as string | null | undefined;
  const identityUrls = meta?.identityUrls ?? [];
  const fingerprint = computeApplyLinkFingerprint({ applyUrl, sourceUrl });

  // TIER 1 + 2 - exact identity. Blocks the insert: an apply-link fingerprint or
  // a shared per-posting/requisition id is authoritative, not a guess.
  const check = await checkJobDuplicate({ applyUrl, sourceUrl, identityUrls });
  if (check.isDuplicate) return { status: "duplicate", existing: check.existing, fingerprint: check.fingerprint };

  const enrichedRow: Record<string, unknown> = { ...row };
  stampIdentityKeys(enrichedRow, meta);

  // TIER 3 - content identity. Never blocks; may mark the row hidden. Skipped
  // entirely when no identity key could be built, since there is nothing to
  // match on and the guard would only re-derive the same null.
  let score = 0.95;
  if (enrichedRow.content_identity_key || enrichedRow.title_location_key) {
    const contentCheck = await checkContentDuplicate(contentCandidate(enrichedRow, fingerprint, meta));
    applyContentDuplicateResult(enrichedRow, contentCheck);
    if (contentCheck.isContentDuplicate) score = contentCheck.score;
  }

  const fullRow = await toSqlRow({ ...enrichedRow, apply_link_fingerprint: fingerprint });
  const cols = Object.keys(fullRow);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = cols.map((c) => fullRow[c]);
  const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;

  try {
    const result = await queryOne<JobRow>(sql, values);
    if (!result) throw new Error("Failed to insert job");
    await recordPostInsert(
      [result],
      new Map([[result.id, [applyUrl, sourceUrl, ...identityUrls]]]),
      new Map([[result.id, score]])
    );
    return { status: "created", job: result };
  } catch (err: any) {
    if (isUniqueViolation(err)) {
      const recheck = await checkJobDuplicate({ applyUrl, sourceUrl, identityUrls });
      if (recheck.isDuplicate) return { status: "duplicate", existing: recheck.existing, fingerprint: recheck.fingerprint };
    }
    throw err;
  }
}

/**
 * Bulk-insert variant for import paths (ATS/career-page/LinkedIn/CSV
 * import, the public partner API). Duplicate rows are excluded from the
 * INSERT entirely rather than attempted-then-caught, since a bulk import
 * commonly contains dozens of already-known postings and per-row exception
 * handling at that volume would be unnecessarily slow.
 */
export async function createJobs(rows: Record<string, any>[]): Promise<{
  inserted: JobRow[];
  duplicates: { input: Record<string, any>; existing: JobDuplicateMatch; fingerprint: string }[];
}> {
  if (rows.length === 0) return { inserted: [], duplicates: [] };

  const checks = await checkJobDuplicatesBatch(
    rows.map((r) => ({ applyUrl: r.apply_url ?? null, sourceUrl: r.source_url ?? null }))
  );

  const duplicates: { input: Record<string, any>; existing: JobDuplicateMatch; fingerprint: string }[] = [];
  const toInsert: Record<string, any>[] = [];
  // Same-batch collisions (two rows in this one import sharing a fingerprint,
  // neither matching anything already in `jobs`) are deliberately not
  // treated as duplicates-to-report here - resolving those is the concern of
  // each source's own in-batch dedup that already runs upstream of this call
  // (e.g. jobAgentService.ts's dedupeInRun, jobAgentImporter.ts's
  // pickDeterministicBatchWinners). This is just a safety net so a multi-row
  // INSERT never attempts two rows with the same fingerprint in one
  // statement (which Postgres would reject outright once the unique index
  // exists) - first occurrence wins, later same-batch rows are silently
  // skipped rather than surfaced as a cross-system duplicate.
  const seenBatchFingerprints = new Set<string>();

  rows.forEach((row, i) => {
    const check = checks[i];
    if (check.isDuplicate) {
      duplicates.push({ input: row, existing: check.existing, fingerprint: check.fingerprint });
      return;
    }
    if (check.fingerprint) {
      if (seenBatchFingerprints.has(check.fingerprint)) return;
      seenBatchFingerprints.add(check.fingerprint);
    }
    toInsert.push({ ...row, apply_link_fingerprint: check.fingerprint });
  });

  if (toInsert.length === 0) return { inserted: [], duplicates };

  // Cross-platform content check, against jobs already committed to the
  // table (see jobContentDuplicateGuard.ts). Deliberately does not also
  // dedupe same-batch content collisions - a single import batch is
  // effectively always single-source (one Apify run, one ATS pull), so the
  // real cross-platform case (LinkedIn captured in one run, Indeed in a
  // later, separate one) is caught by this check regardless; only a
  // hypothetical batch mixing multiple platforms in one call would miss an
  // in-batch pair, mirroring the same accepted non-goal already documented
  // above for same-batch fingerprint collisions.
  toInsert.forEach((row) => stampIdentityKeys(row));
  const contentChecks = await checkContentDuplicatesBatch(
    toInsert.map((r) => contentCandidate(r, (r.apply_link_fingerprint as string | null) ?? null))
  );
  const batchScores: number[] = toInsert.map((row, i) => {
    applyContentDuplicateResult(row, contentChecks[i]);
    const c = contentChecks[i];
    return c.isContentDuplicate ? c.score : 0.95;
  });

  // Bulk-import rows can have heterogeneous column sets (e.g. one row has
  // salary fields, another doesn't) - union every column across the batch
  // so each row's INSERT list lines up positionally, defaulting missing
  // fields to null rather than shifting columns between rows.
  const sqlReadyRows = await Promise.all(toInsert.map((r) => toSqlRow(r)));
  const cols = [...new Set(sqlReadyRows.flatMap((r) => Object.keys(r)))];
  const values: (string | number | boolean | null | Date | object)[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;
  for (const row of sqlReadyRows) {
    const rowPlaceholders: string[] = [];
    for (const col of cols) {
      rowPlaceholders.push(`$${paramIdx++}`);
      values.push((row[col] ?? null) as any);
    }
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
  }
  const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;

  try {
    const inserted = await query<JobRow>(sql, values);
    // Positional pairing is safe: a multi-row INSERT ... RETURNING preserves the
    // order of the VALUES list, so inserted[i] is toInsert[i].
    await recordPostInsert(
      inserted,
      new Map(inserted.map((r, i) => [r.id, [toInsert[i]?.apply_url ?? null, toInsert[i]?.source_url ?? null]])),
      new Map(inserted.map((r, i) => [r.id, batchScores[i] ?? 0.95]))
    );
    return { inserted, duplicates };
  } catch (err: any) {
    // Race backstop: the pre-check above and the unique index (once
    // migration 095 ships) can only ever narrow this window, not close it
    // entirely against a fully concurrent import of the same rows - fall
    // back to per-row insertion so one collision doesn't lose the rest of
    // an otherwise-legitimate batch.
    if (!isUniqueViolation(err)) throw err;
    const inserted: JobRow[] = [];
    for (const row of toInsert) {
      const outcome = await createJob(row);
      if (outcome.status === "created") inserted.push(outcome.job);
      else duplicates.push({ input: row, existing: outcome.existing, fingerprint: outcome.fingerprint });
    }
    return { inserted, duplicates };
  }
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

/**
 * Find only historical jobs whose normalized title/company/location key is
 * present in the incoming candidate set. The Job Agent previously downloaded
 * every historical row and compared each candidate with every row in
 * JavaScript, which made larger LinkedIn datasets exceed the poll request
 * window. This expression mirrors the application normalization exactly.
 */
export async function findJobsByExactMatchKeys(
  matchKeys: string[],
): Promise<{ title: string; company: string | null; location: string | null }[]> {
  const keys = [...new Set(matchKeys.filter((key) => key.trim()))];
  if (keys.length === 0) return [];

  return query<{ title: string; company: string | null; location: string | null }>(
    `SELECT title, company, location
     FROM jobs
     WHERE title IS NOT NULL
       AND (
         btrim(regexp_replace(lower(coalesce(title, '')), '[^a-z0-9]+', ' ', 'g'))
         || '|' ||
         btrim(regexp_replace(lower(coalesce(company, '')), '[^a-z0-9]+', ' ', 'g'))
         || '|' ||
         btrim(regexp_replace(lower(coalesce(location, '')), '[^a-z0-9]+', ' ', 'g'))
       ) = ANY($1::text[])`,
    [keys],
  );
}

// ───────────────────────────────────────────────────────────────
// Description Enricher (job_ceo_enricher) — backfills thin/missing
// description_text on already-logged jobs, from any source. Capped at 3
// attempts so a job whose URL genuinely can't be scraped (dead link, hard
// bot-block) doesn't get retried forever. No row-locking here: query()/
// execute() each run as their own auto-committed statement (see
// finalizationService.ts's explicit sql.transaction() for the one place
// this codebase actually needs cross-statement locking) - fine for a
// small-batch, infrequent cron where the worst case of a double-claim is
// one redundant AI call, not data corruption.
// ───────────────────────────────────────────────────────────────

export interface EnrichmentCandidate {
  id: string;
  title: string | null;
  company: string | null;
  source_url: string | null;
  apply_url: string | null;
  description_text: string | null;
}

export async function findJobsNeedingEnrichment(limit: number): Promise<EnrichmentCandidate[]> {
  return query<EnrichmentCandidate>(
    `SELECT id, title, company, source_url, apply_url, description_text
     FROM jobs
     WHERE is_active = true
       AND description_enrich_attempts < 3
       AND (source_url IS NOT NULL OR apply_url IS NOT NULL)
       AND (description_text IS NULL OR length(description_text) < 500)
     ORDER BY description_enrich_attempts ASC, last_seen_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
}

export async function countJobsNeedingEnrichment(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM jobs
     WHERE is_active = true
       AND description_enrich_attempts < 3
       AND (source_url IS NOT NULL OR apply_url IS NOT NULL)
       AND (description_text IS NULL OR length(description_text) < 500)`
  );
  return row ? parseInt(row.count, 10) : 0;
}

export async function recordEnrichmentAttempt(
  id: string,
  patch: { description_text?: string; requirements?: Record<string, unknown> }
): Promise<void> {
  const fields = ["description_enrich_attempts = description_enrich_attempts + 1", "description_enriched_at = NOW()"];
  const values: unknown[] = [];
  let idx = 1;
  if (patch.description_text !== undefined) {
    fields.push(`description_text = $${idx++}`);
    values.push(patch.description_text);
  }
  values.push(id);
  await execute(
    `UPDATE jobs SET ${fields.join(", ")} WHERE id = $${idx}`,
    values
  );
}
