import { query, queryOne, execute } from "@/server/db/neon";
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
  created_at: string;
  updated_at: string;
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
    var title = r.title ?? null;
    var company = r.company ?? null;
    var dedupSig = title && company ? title.toLowerCase() + "|" + company.toLowerCase() : null;

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
