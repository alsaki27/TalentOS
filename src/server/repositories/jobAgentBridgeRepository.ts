import { query } from "@/server/db/neon";
import type { JobAgentStagedJobRow } from "@/server/repositories/jobAgentRunRepository";

export interface BatchBridgeCandidateRow extends JobAgentStagedJobRow {
  actor_source: "indeed" | "google" | "linkedin";
}

export interface ApprovedBridgeCandidate {
  sourceStagedId: string;
  signature: string;
  title: string;
  company: string | null;
  location: string | null;
  sourceUrl: string | null;
  externalJobId: string | null;
  descriptionText: string | null;
  raw: Record<string, unknown>;
}

export interface ApprovedBridgeRejection {
  sourceStagedId: string;
  reason: string;
  markDuplicate: boolean;
}

export interface ApprovedBridgeResult {
  runId: string | null;
  insertedSourceIds: string[];
  duplicateCount: number;
  batchClaimAccepted: boolean;
}

export interface BatchBridgeStats {
  imported: number;
  rejected: number;
}

export async function getBatchBridgeStats(batchId: string): Promise<BatchBridgeStats> {
  const rows = await query<{ imported: number | string; rejected: number | string }>(
    `SELECT
       COUNT(*) FILTER (WHERE staged.import_status = 'imported')::int AS imported,
       COUNT(*) FILTER (WHERE staged.import_status = 'rejected')::int AS rejected
     FROM job_agent_staged_jobs staged
     JOIN job_agent_runs run ON run.id = staged.run_id
     WHERE run.batch_id = $1`,
    [batchId]
  );
  return {
    imported: Number(rows[0]?.imported ?? 0),
    rejected: Number(rows[0]?.rejected ?? 0),
  };
}

export interface BatchFinalizationClaim {
  batchId: string;
  claimToken: string;
}

/**
 * Return every automatically importable row from successful attempts in a
 * nightly batch. Same-batch duplicates are intentionally still present here;
 * the importer selects a deterministic winner before reserving CEO signatures.
 */
export async function listBatchBridgeCandidates(batchId: string): Promise<BatchBridgeCandidateRow[]> {
  return query<BatchBridgeCandidateRow>(
    `SELECT staged.*, run.actor_source
     FROM job_agent_staged_jobs staged
     JOIN job_agent_runs run ON run.id = staged.run_id
     JOIN job_agent_batch_shards shard ON shard.id = run.batch_shard_id
     WHERE shard.batch_id = $1
       AND run.status = 'succeeded'
       AND staged.tier IN ('best', 'medium', 'worthy')
       AND staged.is_false_positive = false
       AND staged.is_duplicate = false
       AND staged.import_status <> 'imported'
       AND staged.date_window_status = 'in_window'
     ORDER BY staged.created_at ASC, staged.id ASC`,
    [batchId]
  );
}

/**
 * Atomically reserve permanent Job CEO signatures, create at most one bridge
 * run, insert its qa_passed rows, and update only the source rows that actually
 * won every conflict. A zero-winner handoff creates no Job CEO run.
 */
export async function createApprovedBridgeRun(
  candidates: ApprovedBridgeCandidate[],
  triggerType: "job_agent_import" | "job_agent_nightly",
  batchClaim?: BatchFinalizationClaim,
  rejections: ApprovedBridgeRejection[] = [],
): Promise<ApprovedBridgeResult> {
  if (candidates.length === 0 && rejections.length === 0 && !batchClaim) {
    return { runId: null, insertedSourceIds: [], duplicateCount: 0, batchClaimAccepted: true };
  }

  const payload = candidates.map((candidate) => ({
    source_staged_id: candidate.sourceStagedId,
    signature: candidate.signature,
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    source_url: candidate.sourceUrl,
    external_job_id: candidate.externalJobId,
    description_text: candidate.descriptionText,
    raw: candidate.raw,
  }));
  const rejectionPayload = rejections.map((rejection) => ({
    source_staged_id: rejection.sourceStagedId,
    reason: rejection.reason,
    mark_duplicate: rejection.markDuplicate,
  }));

  const rows = await query<{
    run_id: string | null;
    inserted_source_ids: string[] | null;
    duplicate_count: number | string;
    batch_claim_accepted: boolean;
  }>(
    `WITH input AS (
       SELECT *
       FROM jsonb_to_recordset($1::jsonb) AS value(
         source_staged_id uuid,
         signature text,
         title text,
         company text,
         location text,
         source_url text,
         external_job_id text,
         description_text text,
         raw jsonb
       )
     ),
     rejected_input AS (
       SELECT *
       FROM jsonb_to_recordset($5::jsonb) AS value(
         source_staged_id uuid,
         reason text,
         mark_duplicate boolean
       )
     ),
     batch_claim AS (
       SELECT id
       FROM job_agent_batches
       WHERE id = $3::uuid
         AND status = 'finalizing'
         AND finalization_claim_token = $4::uuid
       FOR UPDATE
     ),
     proposed_run AS MATERIALIZED (
       SELECT gen_random_uuid() AS id
       WHERE EXISTS (SELECT 1 FROM input)
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM batch_claim))
     ),
     reserved AS (
       INSERT INTO job_ceo_seen_signatures (signature, run_id, title, company)
       SELECT input.signature, proposed_run.id, input.title, input.company
       FROM input
       CROSS JOIN proposed_run
       WHERE signature IS NOT NULL
       ON CONFLICT (signature) DO NOTHING
       RETURNING signature
     ),
     new_run AS (
       INSERT INTO job_ceo_runs (
         id, source, trigger_type, ingested_count, kept_count,
         researched_count, skipped_count
       )
       SELECT proposed_run.id, 'apify_bridge', $2::text,
              (SELECT COUNT(*) FROM input),
              (SELECT COUNT(*) FROM reserved),
              (SELECT COUNT(*) FROM reserved),
              (SELECT COUNT(*) FROM input) - (SELECT COUNT(*) FROM reserved)
       FROM proposed_run
       WHERE EXISTS (SELECT 1 FROM reserved)
       RETURNING id
     ),
     staged AS (
       INSERT INTO job_ceo_staging (
         run_id, stage, dedup_signature, title, company, location, source_url,
         external_job_id, description_text, raw, source_job_agent_staged_id
       )
       SELECT new_run.id, 'qa_passed', input.signature, input.title, input.company,
              input.location, input.source_url, input.external_job_id,
              input.description_text, input.raw, input.source_staged_id
       FROM input
       JOIN reserved ON reserved.signature = input.signature
       CROSS JOIN new_run
       ON CONFLICT DO NOTHING
       RETURNING run_id, source_job_agent_staged_id
     ),
     marked_imported AS (
       UPDATE job_agent_staged_jobs source
       SET import_status = 'imported'
       WHERE source.id IN (SELECT source_job_agent_staged_id FROM staged)
       RETURNING source.id, source.run_id
     ),
     marked_candidate_duplicates AS (
       UPDATE job_agent_staged_jobs source
       SET is_duplicate = true,
           import_status = CASE WHEN source.import_status = 'imported' THEN source.import_status ELSE 'rejected' END,
           import_exclusion_reason = COALESCE(source.import_exclusion_reason, 'job_ceo_signature_duplicate')
       WHERE source.id IN (SELECT source_staged_id FROM input)
         AND source.id NOT IN (SELECT source_job_agent_staged_id FROM staged)
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM batch_claim))
       RETURNING source.id, source.run_id
     ),
     marked_rejections AS (
       UPDATE job_agent_staged_jobs source
       SET is_duplicate = CASE WHEN rejected_input.mark_duplicate THEN true ELSE source.is_duplicate END,
           import_status = CASE WHEN source.import_status = 'imported' THEN source.import_status ELSE 'rejected' END,
           import_exclusion_reason = COALESCE(source.import_exclusion_reason, rejected_input.reason)
       FROM rejected_input
       WHERE source.id = rejected_input.source_staged_id
         AND source.import_status <> 'imported'
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM batch_claim))
       RETURNING source.id, source.run_id
     ),
     event_deltas AS (
       SELECT run_id,
              SUM(imported)::int AS imported,
              SUM(duplicate)::int AS duplicate
       FROM (
         SELECT run_id, 1 AS imported, 0 AS duplicate FROM marked_imported
         UNION ALL
         SELECT run_id, 0 AS imported, 1 AS duplicate FROM marked_candidate_duplicates
         UNION ALL
         SELECT run_id, 0 AS imported, 1 AS duplicate FROM marked_rejections
       ) values_by_run
       GROUP BY run_id
     ),
     run_deltas AS (
       SELECT run.id AS run_id,
              COALESCE(event_deltas.imported, 0)::int AS imported,
              COALESCE(event_deltas.duplicate, 0)::int AS duplicate
       FROM job_agent_runs run
       LEFT JOIN event_deltas ON event_deltas.run_id = run.id
       WHERE (
         $3::uuid IS NULL AND event_deltas.run_id IS NOT NULL
       ) OR (
         $3::uuid IS NOT NULL
         AND run.batch_id = $3::uuid
         AND run.status = 'succeeded'
         AND EXISTS (SELECT 1 FROM batch_claim)
       )
     ),
     updated_source_runs AS (
       UPDATE job_agent_runs run
       SET imported_count = run.imported_count + run_deltas.imported,
           skipped_count = run.skipped_count + run_deltas.duplicate,
           auto_import_status = CASE WHEN $3::uuid IS NOT NULL THEN 'succeeded' ELSE run.auto_import_status END,
           auto_import_error = CASE WHEN $3::uuid IS NOT NULL THEN NULL ELSE run.auto_import_error END,
           auto_import_completed_at = CASE WHEN $3::uuid IS NOT NULL THEN NOW() ELSE run.auto_import_completed_at END
       FROM run_deltas
       WHERE run.id = run_deltas.run_id
       RETURNING run.id
     ),
     batch_link AS (
       UPDATE job_agent_batches batch
       SET job_ceo_run_id = COALESCE(batch.job_ceo_run_id, (SELECT id FROM new_run)),
           final_duplicate_count = GREATEST(
             batch.final_duplicate_count,
             (SELECT COUNT(*) FROM marked_candidate_duplicates) +
             (SELECT COUNT(*) FROM marked_rejections)
           ),
           updated_at = NOW()
       WHERE batch.id = $3::uuid
         AND batch.status = 'finalizing'
         AND batch.finalization_claim_token = $4::uuid
         AND (
           batch.job_ceo_run_id IS NULL
           OR (SELECT id FROM new_run) IS NULL
           OR batch.job_ceo_run_id = (SELECT id FROM new_run)
         )
       RETURNING batch.id
     )
     SELECT (SELECT id FROM new_run) AS run_id,
            COALESCE((SELECT ARRAY_AGG(source_job_agent_staged_id::text) FROM staged), ARRAY[]::text[]) AS inserted_source_ids,
            (
              (SELECT COUNT(*) FROM marked_candidate_duplicates) +
              (SELECT COUNT(*) FROM marked_rejections)
            )::int AS duplicate_count,
            ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM batch_claim)) AS batch_claim_accepted,
            (SELECT COUNT(*) FROM updated_source_runs) AS updated_source_run_count,
            (SELECT COUNT(*) FROM batch_link) AS linked_batch_count`,
    [
      JSON.stringify(payload),
      triggerType,
      batchClaim?.batchId ?? null,
      batchClaim?.claimToken ?? null,
      JSON.stringify(rejectionPayload),
    ]
  );

  const row = rows[0];
  if (!row) {
    return {
      runId: null,
      insertedSourceIds: [],
      duplicateCount: candidates.length,
      batchClaimAccepted: !batchClaim,
    };
  }

  return {
    runId: row.run_id,
    insertedSourceIds: row.inserted_source_ids ?? [],
    duplicateCount: Number(row.duplicate_count ?? 0),
    batchClaimAccepted: row.batch_claim_accepted,
  };
}
