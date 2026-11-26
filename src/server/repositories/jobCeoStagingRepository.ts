import { randomUUID } from "crypto";
import { query, queryOne, execute, sql } from "@/server/db/neon";
import type { StagedJob, StagedJobStage } from "@/lib/ai/job-agents/types";

export interface StagedJobRow {
  id: string;
  run_id: string;
  stage: StagedJobStage;
  dedup_signature: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  source_url: string | null;
  external_job_id: string | null;
  snippet: string | null;
  description_text: string | null;
  raw: unknown;
  qa_score: number | null;
  qa_reason: string | null;
  requirements: unknown;
  match_results: unknown;
  logged_job_id: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  last_error: string | null;
  recovery_retry_count: number;
  recovery_last_retried_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The single source of truth for "is this the same job we've already staged",
 * used both by the cross-run gate in job-ceo/ingest/route.ts (which decides
 * whether to insert at all) and by insertStaged below (which stores the same
 * value on the row so it can later be released via removeDedupSignature —
 * see jobCeoService.ts's "no_description" skip and jobCeoRunRepository.ts's
 * deleteRun). Those two call sites MUST agree on every job, or a release
 * call deletes a signature that was never actually inserted, silently
 * blacklisting that job from ever being re-ingested.
 *
 * Prefers a namespaced external_job_id when the source supplies one. A bare
 * title|company signature collapses distinct postings that share both — not
 * hypothetical: Actalent and Broadstaff are single-employer staffing boards
 * (company is always "Actalent" / "Broadstaff"), and real, differently
 * located requisitions with the exact same title are common there (e.g.
 * multiple regional "OSP Field Inspector" reqs, multiple "GIS Analyst"
 * reqs). Namespaced by source so two sources' id spaces can never collide by
 * coincidence. Falls back to title|company when no external_job_id is
 * present, which is every job from every source before this change — so
 * existing sources (OpenJobData, and anything without an id) see byte-
 * identical signatures to before.
 */
export function computeJobDedupSignature(job: {
  title?: unknown;
  company?: unknown;
  external_job_id?: unknown;
  raw?: unknown;
}): string | null {
  const title = String(job.title ?? "").toLowerCase().trim();
  const company = String(job.company ?? "").toLowerCase().trim();
  const externalId = typeof job.external_job_id === "string" ? job.external_job_id.trim() : "";

  if (externalId) {
    let source = "unknown";
    if (job.raw && typeof job.raw === "object") {
      const rawSource = (job.raw as Record<string, unknown>).source;
      if (typeof rawSource === "string" && rawSource.trim()) source = rawSource.trim().toLowerCase();
    }
    return `id:${source}:${externalId.toLowerCase()}`;
  }

  if (!title && !company) return null;
  return `${title}|${company}`;
}

export async function insertStaged(
  runId: string,
  rows: Partial<StagedJob>[]
): Promise<number> {
  if (rows.length === 0) return 0;

  var cols = ["run_id", "stage", "dedup_signature", "title", "company", "location", "source_url", "external_job_id", "snippet", "description_text", "raw"];
  var valuesList: unknown[] = [];
  var placeholdersList: string[] = [];
  var idx = 1;

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var dedupSig = computeJobDedupSignature(r);

    var rowPh: string[] = [];
    rowPh.push("$" + idx); valuesList.push(runId); idx++;
    rowPh.push("$" + idx); valuesList.push(r.stage ?? "ingested"); idx++;
    rowPh.push("$" + idx); valuesList.push(dedupSig); idx++;
    rowPh.push("$" + idx); valuesList.push(r.title ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.company ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.location ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.source_url ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.external_job_id ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.snippet ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.description_text ?? null); idx++;
    rowPh.push("$" + idx); valuesList.push(r.raw != null ? JSON.stringify(r.raw) : null); idx++;
    placeholdersList.push("(" + rowPh.join(", ") + ")");
  }

  const inserted = await query<{ id: string }>(
    "INSERT INTO job_ceo_staging (" + cols.join(", ") + ") VALUES " + placeholdersList.join(", ") +
      " ON CONFLICT DO NOTHING RETURNING id",
    valuesList
  );
  return inserted.length;
}

/**
 * Cross-run deduplication using the permanent job_ceo_seen_signatures table.
 * Returns the set of signatures that are NEW (not previously seen).
 * Also inserts new signatures into the seen-signatures table so future runs skip them.
 */
export async function checkAndRecordDedup(
  runId: string,
  signatures: Array<{ signature: string; title: string; company: string }>
): Promise<Set<string>> {
  if (signatures.length === 0) return new Set();

  // The previous read-then-insert implementation could race: two callers could
  // both decide a signature was new even though only one INSERT won.  Let
  // Postgres arbitrate the conflict and return only the signatures this caller
  // actually reserved.
  const unique = new Map<string, { title: string; company: string }>();
  for (const item of signatures) {
    if (!unique.has(item.signature)) {
      unique.set(item.signature, { title: item.title, company: item.company });
    }
  }

  const entries = Array.from(unique.entries());
  const inserted = await query<{ signature: string }>(
    `WITH input AS (
       SELECT *
       FROM UNNEST($1::text[], $2::text[], $3::text[])
         AS value(signature, title, company)
     )
     INSERT INTO job_ceo_seen_signatures (signature, run_id, title, company)
     SELECT signature, $4::uuid, title, company
     FROM input
     ON CONFLICT (signature) DO NOTHING
     RETURNING signature`,
    [
      entries.map(([signature]) => signature),
      entries.map(([, value]) => value.title),
      entries.map(([, value]) => value.company),
      runId,
    ]
  );

  return new Set(inserted.map((row) => row.signature));
}

/**
 * Atomically verify a deferred run is still staging, reserve new dedup IDs,
 * insert their jobs, and update run counts. The run-row lock serializes this
 * with the dispatcher's status update, so a batch cannot arrive after ingest
 * has started. A failed statement rolls back both the reservation and rows.
 */
export async function stageDeferredJobs(
  runId: string | undefined,
  rows: Partial<StagedJob>[],
  signatures: string[],
  expectedSource?: string
): Promise<{
  runId: string;
  status: string;
  source: string | null;
  accepted: boolean;
  staged: number;
  skipped: number;
} | null> {
  if (rows.length === 0 || signatures.length !== rows.length) {
    throw new Error("deferred staging requires one signature per job row");
  }

  // A batch can contain the same dedup signature more than once. The SQL
  // unique_input CTE keeps its first row, while cardinality($2) still counts
  // every received row so the response accounts for duplicate inputs.
  const entries = rows.map((row, index) => {
    const signature = signatures[index];
    if (!signature) throw new Error("deferred staging received an empty dedup signature");
    return [signature, row] as const;
  });
  const sourceMatch = (rowSource: string | undefined) =>
    !expectedSource || !rowSource || rowSource.trim().toLowerCase() === expectedSource.trim().toLowerCase();

  const validRows = entries.filter(([, row]) => sourceMatch(row.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
    ? String((row.raw as Record<string, unknown>).source ?? "") || undefined
    : undefined));
  if (validRows.length !== entries.length) {
    throw new Error("deferred staging batch contains a source that does not match its run");
  }

  const effectiveRunId = runId ?? randomUUID();
  const stageQuery = `WITH locked_run AS MATERIALIZED (
       SELECT id, status, source
       FROM job_ceo_runs
       WHERE id = $1::uuid
     ),
     input AS MATERIALIZED (
       SELECT signature, title, company, location, source_url, external_job_id,
              snippet, description_text, raw_json::jsonb AS raw, ord
       FROM UNNEST(
         $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
         $7::text[], $8::text[], $9::text[], $10::text[]
       ) WITH ORDINALITY AS value(
         signature, title, company, location, source_url, external_job_id,
         snippet, description_text, raw_json, ord
       )
     ),
     unique_input AS MATERIALIZED (
       SELECT DISTINCT ON (signature) *
       FROM input
       ORDER BY signature, ord
     ),
     already_staged AS MATERIALIZED (
       SELECT DISTINCT item.signature
       FROM unique_input item
       JOIN job_ceo_seen_signatures seen
         ON seen.signature = item.signature AND seen.run_id = $1::uuid
       JOIN job_ceo_staging staged
         ON staged.run_id = seen.run_id AND staged.dedup_signature = item.signature
       CROSS JOIN locked_run run
       WHERE run.status = 'staging'
         AND ($11::text IS NULL OR run.source IS NULL OR lower(run.source) = lower($11::text))
     ),
     reserved AS (
       INSERT INTO job_ceo_seen_signatures (signature, run_id, title, company)
       SELECT item.signature, run.id, item.title, item.company
       FROM unique_input item
       CROSS JOIN locked_run run
       WHERE run.status = 'staging'
         AND ($11::text IS NULL OR run.source IS NULL OR lower(run.source) = lower($11::text))
       ON CONFLICT (signature) DO NOTHING
       RETURNING signature
     ),
     inserted_jobs AS (
       INSERT INTO job_ceo_staging (
         run_id, stage, dedup_signature, title, company, location, source_url,
         external_job_id, snippet, description_text, raw
       )
       SELECT run.id, 'ingested', item.signature, item.title, item.company,
              item.location, item.source_url, item.external_job_id,
              item.snippet, item.description_text, item.raw
       FROM unique_input item
       JOIN reserved ON reserved.signature = item.signature
       CROSS JOIN locked_run run
       RETURNING id
     ),
     updated_run AS (
       UPDATE job_ceo_runs target
       SET ingested_count = COALESCE(target.ingested_count, 0) + (SELECT COUNT(*)::int FROM inserted_jobs),
           skipped_count = COALESCE(target.skipped_count, 0) + cardinality($2::text[])
             - (SELECT COUNT(*)::int FROM inserted_jobs)
             - (SELECT COUNT(*)::int FROM already_staged),
           updated_at = NOW()
       FROM locked_run run
       WHERE target.id = run.id
         AND run.status = 'staging'
         AND ($11::text IS NULL OR run.source IS NULL OR lower(run.source) = lower($11::text))
       RETURNING target.id
     )
     SELECT run.id AS run_id, run.status, run.source,
            EXISTS (SELECT 1 FROM updated_run) AS accepted,
            (SELECT COUNT(*)::int FROM inserted_jobs) + (SELECT COUNT(*)::int FROM already_staged) AS staged,
            cardinality($2::text[]) - (SELECT COUNT(*)::int FROM inserted_jobs)
              - (SELECT COUNT(*)::int FROM already_staged) AS skipped
     FROM locked_run run`;
  const stageParams = [
    effectiveRunId,
    entries.map(([signature]) => signature),
    entries.map(([, row]) => row.title ?? null),
    entries.map(([, row]) => row.company ?? null),
    entries.map(([, row]) => row.location ?? null),
    entries.map(([, row]) => row.source_url ?? null),
    entries.map(([, row]) => row.external_job_id ?? null),
    entries.map(([, row]) => row.snippet ?? null),
    entries.map(([, row]) => row.description_text ?? null),
    entries.map(([, row]) => row.raw != null ? JSON.stringify(row.raw) : null),
    expectedSource ?? null,
  ];

  const transactionResults = runId
    ? await sql().transaction((tx) => [
        tx.query("SELECT id FROM job_ceo_runs WHERE id = $1::uuid FOR UPDATE", [effectiveRunId]),
        tx.query(stageQuery, stageParams),
      ])
    : await sql().transaction((tx) => [
        tx.query(
          `INSERT INTO job_ceo_runs (id, source, trigger_type, status)
           VALUES ($1::uuid, COALESCE(NULLIF($2::text, ''), 'openjobdata'), 'cron', 'staging')`,
          [effectiveRunId, expectedSource ?? null]
        ),
        tx.query("SELECT id FROM job_ceo_runs WHERE id = $1::uuid FOR UPDATE", [effectiveRunId]),
        tx.query(stageQuery, stageParams),
      ]);
  const stageResultIndex = runId ? 1 : 2;
  const results = transactionResults[stageResultIndex] as Array<{
    run_id: string;
    status: string;
    source: string | null;
    accepted: boolean;
    staged: number;
    skipped: number;
  }>;
  const result = results[0];
  return result ? {
    runId: result.run_id,
    status: result.status,
    source: result.source,
    accepted: result.accepted,
    staged: Number(result.staged),
    skipped: Number(result.skipped),
  } : null;
}

export async function removeDedupSignature(signature: string): Promise<void> {
  await execute("DELETE FROM job_ceo_seen_signatures WHERE signature = $1", [signature]);
}

export async function removeDedupSignatures(signatures: string[]): Promise<void> {
  if (signatures.length === 0) return;
  const placeholders = signatures.map((_, i) => `$${i + 1}`).join(", ");
  await execute(`DELETE FROM job_ceo_seen_signatures WHERE signature IN (${placeholders})`, signatures);
}

export async function claimNextStagedBatch(
  runId: string,
  stage: StagedJobStage,
  limit: number
): Promise<StagedJobRow[]> {
  return query<StagedJobRow>(
    `WITH next_batch AS (
      SELECT id FROM job_ceo_staging
      WHERE stage = $2 AND run_id = $1
        AND (claim_expires_at IS NULL OR claim_expires_at < NOW())
      ORDER BY created_at ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    UPDATE job_ceo_staging s
    SET claimed_at = NOW(),
        claim_expires_at = NOW() + INTERVAL '5 minutes',
        updated_at = NOW()
    FROM next_batch n
    WHERE s.id = n.id
    RETURNING s.*`,
    [runId, stage, limit]
  );
}

export async function updateStaged(
  id: string,
  patch: Partial<StagedJobRow>
): Promise<void> {
  var keys = Object.keys(patch).filter(function (k) { return patch[k as keyof StagedJobRow] !== undefined; });
  if (keys.length === 0) return;

  var setParts: string[] = [];
  var values: unknown[] = [];
  var idx = 1;

  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = patch[k as keyof StagedJobRow];
    setParts.push(k + " = $" + idx);
    values.push(v);
    idx++;
  }

  setParts.push("updated_at = NOW()");
  values.push(id);

  await execute(
    "UPDATE job_ceo_staging SET " + setParts.join(", ") + " WHERE id = $" + idx,
    values
  );
}

export async function countByStage(runId: string): Promise<{ stage: string; count: string }[]> {
  return query<{ stage: string; count: string }>(
    "SELECT stage, COUNT(*)::text AS count FROM job_ceo_staging WHERE run_id = $1 GROUP BY stage",
    [runId]
  );
}

export async function listStagedByRun(
  runId: string,
  stage?: string,
  limit = 200,
  offset = 0
): Promise<StagedJobRow[]> {
  if (stage) {
    return query<StagedJobRow>(
      "SELECT * FROM job_ceo_staging WHERE run_id = $1 AND stage = $2 ORDER BY created_at ASC LIMIT $3 OFFSET $4",
      [runId, stage, limit, offset]
    );
  }
  return query<StagedJobRow>(
    "SELECT * FROM job_ceo_staging WHERE run_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3",
    [runId, limit, offset]
  );
}

/**
 * The Adzuna (and, generically, any source's) description-recovery queue:
 * every staging row currently flagged "no_description", across every run —
 * including rows whose original run has since been deleted (deleteRun()
 * detaches them to run_id = NULL rather than destroying them; see
 * jobCeoRunRepository.ts). This is intentionally NOT scoped to a single run,
 * unlike listStagedByRun — staff review this as one standing worklist.
 */
export async function findStagedById(id: string): Promise<StagedJobRow | null> {
  return queryOne<StagedJobRow>("SELECT * FROM job_ceo_staging WHERE id = $1", [id]);
}

export async function listRecoveryQueue(limit = 500, offset = 0): Promise<StagedJobRow[]> {
  return query<StagedJobRow>(
    "SELECT * FROM job_ceo_staging WHERE stage = 'no_description' ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
}

export async function countRecoveryQueue(): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM job_ceo_staging WHERE stage = 'no_description'"
  );
  return parseInt(row?.count ?? "0", 10) || 0;
}

/**
 * Atomically claims up to `limit` recovery-queue rows that are due for an
 * automated retry: they have a link to re-fetch, haven't exceeded
 * maxAttempts, aren't old enough to be almost-certainly-expired, and have
 * waited long enough since their last attempt (backoff: 12h before the 1st
 * retry, 24h before the 2nd — see RECOVERY_RETRY_BACKOFF_HOURS in
 * jobCeoRecoveryRetryService.ts, which this CASE expression must stay in
 * sync with). Reuses claimed_at/claim_expires_at
 * (the same columns the normal stage-claiming queries use) so a scheduled
 * batch and a manual "Retry Now" click can never double-process the same row.
 */
export async function claimRecoveryRetryBatch(
  maxAttempts: number,
  eligibleWindowDays: number,
  limit: number
): Promise<StagedJobRow[]> {
  return query<StagedJobRow>(
    `WITH eligible AS (
      SELECT id FROM job_ceo_staging
      WHERE stage = 'no_description'
        AND source_url IS NOT NULL
        AND recovery_retry_count < $1
        AND created_at > now() - ($2 * interval '1 day')
        AND (claim_expires_at IS NULL OR claim_expires_at < now())
        AND now() - COALESCE(recovery_last_retried_at, created_at) >= (
          CASE recovery_retry_count
            WHEN 0 THEN interval '12 hours'
            ELSE interval '24 hours'
          END
        )
      ORDER BY created_at ASC
      LIMIT $3
      FOR UPDATE SKIP LOCKED
    )
    UPDATE job_ceo_staging s
    SET claimed_at = NOW(),
        claim_expires_at = NOW() + INTERVAL '5 minutes',
        updated_at = NOW()
    FROM eligible e
    WHERE s.id = e.id
    RETURNING s.*`,
    [maxAttempts, eligibleWindowDays, limit]
  );
}

export async function countStagedByRunAndStage(runId: string): Promise<Record<string, number>> {
  const rows = await query<{ stage: string; count: string }>(
    "SELECT stage, COUNT(*)::text AS count FROM job_ceo_staging WHERE run_id = $1 GROUP BY stage",
    [runId]
  );
  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.stage] = parseInt(r.count, 10);
  }
  return result;
}
