// src/lib/jobAgentImporter.ts
// Handles the "approve → import into main jobs table" flow.
// Uses createJobs() and filterNewJobs() from the existing codebase, then triggers
// company directory sync and AI categorization so imported jobs get the same
// treatment as any other import source.

import { filterNewJobs } from "@/lib/jobDedup";
import {
  listStagedJobs,
  bulkUpdateStagedJobStatus,
  getRunById,
  type JobAgentStagedJobRow,
} from "@/server/repositories/jobAgentRunRepository";
import {
  createApprovedBridgeRun,
  listBatchBridgeCandidates,
  type ApprovedBridgeCandidate,
  type ApprovedBridgeRejection,
  type BatchBridgeCandidateRow,
} from "@/server/repositories/jobAgentBridgeRepository";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { logActivity } from "@/lib/activity";

export interface ImportApprovedJobsOptions {
  tier?: "best" | "medium" | "worthy";
  tiers?: string[];
  jobIds?: string[];
  approveAll?: boolean;
}

function parsePostedAt(datePosted: string | null): string | null {
  if (!datePosted) return null;
  const parsed = new Date(datePosted);
  if (!isNaN(parsed.getTime())) return parsed.toISOString();
  return null;
}

function stagedJobToJobRow(staged: JobAgentStagedJobRow): Record<string, unknown> {
  const notes = [
    `Role group: ${staged.role_group ?? "?"} (${staged.role_group_label ?? ""})`,
    `Tier: ${staged.tier ?? "?"}`,
    `Search query: ${staged.search_query_used ?? "?"}`,
    `Relevance: ${staged.relevance_score ?? "?"}`,
    staged.tier_reason ? `Reason: ${staged.tier_reason}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // via_platform tags which pipeline produced this row ('openjobdata' or an Apify
  // platform string) — source should reflect the real origin, not be hardcoded to
  // the historical Apify-only value.
  const source = staged.via_platform === "openjobdata" ? "openjobdata" : "apify_job_agent";

  // country/industry have no dedicated jobs columns — preserved here rather than
  // dropped, matching every other field openjobdata provides.
  const extras: Record<string, unknown> = {};
  if (staged.country) extras.country = staged.country;
  if (staged.industry) extras.industry = staged.industry;
  const rawSourcePayload = Object.keys(extras).length > 0 ? extras : null;

  return {
    title: staged.job_title,
    company: staged.company_name ?? null,
    location: staged.location ?? null,
    source,
    source_url: staged.source_url ?? null,
    apply_url: staged.apply_link ?? null,
    employment_type: staged.employment_type ?? null,
    seniority_level: staged.seniority_guess ?? null,
    salary_min: staged.salary_min ?? null,
    salary_max: staged.salary_max ?? null,
    salary_range: staged.salary_range ?? null,
    posted_at: parsePostedAt(staged.date_posted),
    is_active: true,
    notes,
    description_text: staged.description_text ?? null,
    company_website: staged.company_website ?? null,
    external_job_id: staged.external_job_id ?? null,
    raw_source_payload: rawSourcePayload ? JSON.stringify(rawSourcePayload) : null,
  };
}

function canonicalBridgeSignature(staged: JobAgentStagedJobRow): string {
  const title = staged.job_title.trim().toLowerCase().replace(/\s+/g, " ");
  const company = (staged.company_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const location = (staged.location ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (title && company) return `${title}|${company}|${location || "unknown-location"}`;

  const sourceUrl = (staged.source_url ?? staged.apply_link ?? "").trim().toLowerCase();
  if (sourceUrl) return `url|${sourceUrl}`;
  return `staged|${staged.id}`;
}

function toApprovedBridgeCandidate(staged: JobAgentStagedJobRow): ApprovedBridgeCandidate {
  return {
    sourceStagedId: staged.id,
    signature: canonicalBridgeSignature(staged),
    title: staged.job_title,
    company: staged.company_name,
    location: staged.location,
    sourceUrl: staged.source_url,
    externalJobId: staged.external_job_id,
    descriptionText: staged.description_text,
    raw: stagedJobToJobRow(staged),
  };
}

function batchCandidateScore(staged: BatchBridgeCandidateRow): number {
  let score = 0;
  if (staged.apply_link) score += 8;
  if (staged.source_url) score += 5;
  if ((staged.description_text ?? "").trim().length >= 100) score += 4;
  if (staged.parsed_posted_at || staged.date_posted) score += 3;
  if (staged.salary_min != null || staged.salary_max != null || staged.salary_range) score += 2;
  if (staged.company_website) score += 1;
  return score;
}

const ACTOR_TIE_BREAK: Record<BatchBridgeCandidateRow["actor_source"], number> = {
  indeed: 0,
  linkedin: 1,
  google: 2,
};

export function pickDeterministicBatchWinners(rows: BatchBridgeCandidateRow[]): {
  winners: BatchBridgeCandidateRow[];
  duplicateIds: string[];
} {
  const bySignature = new Map<string, BatchBridgeCandidateRow[]>();
  for (const row of rows) {
    const signature = canonicalBridgeSignature(row);
    const group = bySignature.get(signature) ?? [];
    group.push(row);
    bySignature.set(signature, group);
  }

  const winners: BatchBridgeCandidateRow[] = [];
  const duplicateIds: string[] = [];
  for (const group of bySignature.values()) {
    group.sort((left, right) => {
      const scoreDelta = batchCandidateScore(right) - batchCandidateScore(left);
      if (scoreDelta !== 0) return scoreDelta;
      const sourceDelta = ACTOR_TIE_BREAK[left.actor_source] - ACTOR_TIE_BREAK[right.actor_source];
      if (sourceDelta !== 0) return sourceDelta;
      return left.id.localeCompare(right.id);
    });
    winners.push(group[0]);
    duplicateIds.push(...group.slice(1).map((row) => row.id));
  }
  return { winners, duplicateIds };
}

async function dispatchBridgeRun(runId: string, triggerType: string): Promise<void> {
  await logActivity({
    type: "job_ceo_run_started",
    description: `Job CEO run started (${triggerType})`,
    entityType: "job_ceo_run",
    entityId: runId,
  });

  const baseUrl =
    process.env.TALENTOS_BASE_URL ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://talent.skarion.com");
  const cronSecret = process.env.CRON_SECRET;
  await backgroundDispatch(
    fetch(`${baseUrl}/api/job-ceo/dispatch`, {
      method: "POST",
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined,
    }).catch((err) => {
      console.error("[jobAgentImporter] Bridge dispatch self-fetch failed:", (err as Error).message);
    })
  );
}

export interface ImportApprovedBatchResult {
  jobCeoRunId: string | null;
  imported: number;
  duplicates: number;
  batchClaimAccepted: boolean;
}

/** Import every eligible nightly row into one idempotent Job CEO bridge run. */
export async function importApprovedBatch(
  batchId: string,
  finalizationClaimToken: string
): Promise<ImportApprovedBatchResult> {
  const candidates = await listBatchBridgeCandidates(batchId);
  const { winners, duplicateIds } = pickDeterministicBatchWinners(candidates);

  const dedupCandidates = winners.map((staged) => ({
    source_url: staged.source_url,
    title: staged.job_title,
    company: staged.company_name,
    posted_at: parsePostedAt(staged.date_posted),
    applicants_count: null as number | null,
    _staged_id: staged.id,
  }));
  const { newRows } = await filterNewJobs(dedupCandidates);
  const newIds = new Set(newRows.map((row) => row._staged_id));
  const historicalDuplicateIds = winners.filter((row) => !newIds.has(row.id)).map((row) => row.id);
  const rejections: ApprovedBridgeRejection[] = [
    ...duplicateIds.map((sourceStagedId) => ({
      sourceStagedId,
      reason: "same_batch_duplicate",
      markDuplicate: true,
    })),
    ...historicalDuplicateIds.map((sourceStagedId) => ({
      sourceStagedId,
      reason: "existing_job_duplicate",
      markDuplicate: true,
    })),
  ];

  const winnerById = new Map(winners.map((row) => [row.id, row]));
  const bridgeCandidates = newRows
    .map((row) => winnerById.get(row._staged_id))
    .filter((row): row is BatchBridgeCandidateRow => Boolean(row))
    .map(toApprovedBridgeCandidate);

  const bridge = await createApprovedBridgeRun(bridgeCandidates, "job_agent_nightly", {
    batchId,
    claimToken: finalizationClaimToken,
  }, rejections);
  if (bridge.runId) await dispatchBridgeRun(bridge.runId, "job_agent_nightly");

  return {
    jobCeoRunId: bridge.runId,
    imported: bridge.insertedSourceIds.length,
    duplicates: bridge.duplicateCount,
    batchClaimAccepted: bridge.batchClaimAccepted,
  };
}

/**
 * Import approved staged jobs into the main jobs table.
 *
 * Behavior:
 * - approveAll: import every non-skip, non-duplicate, non-imported staged job.
 * - tier: mark every staged job in that tier as approved, then import it.
 * - jobIds: mark the specified staged jobs as approved, then import them.
 */
export async function importApprovedJobs(
  runId: string,
  options: ImportApprovedJobsOptions = {}
): Promise<{ imported: number; skipped: number }> {
  if (options.approveAll) {
    // approveAll means import every non-skip, non-duplicate, non-imported staged job
    // regardless of current status. Pull them directly.
    const all = await listStagedJobs(runId, { pageSize: 10000 });
    const importable = all.items.filter(
      (j) => j.tier !== "skip" && !j.is_false_positive && !j.is_duplicate && j.import_status !== "imported"
    );
    return importRows(runId, importable);
  }

  // For tier/jobIds approvals, first mark the target jobs as approved, then import.
  // This fixes the bug where the UI "Approve All Best" found zero rows because they
  // were still in import_status = 'staged'.
  if (options.tier) {
    await bulkUpdateStagedJobStatus(runId, "approved", {
      tier: options.tier,
      excludeImportStatus: "imported",
    });
  }
  if (options.tiers && options.tiers.length > 0) {
    await bulkUpdateStagedJobStatus(runId, "approved", {
      tiers: options.tiers,
      excludeImportStatus: "imported",
    });
  }
  if (options.jobIds && options.jobIds.length > 0) {
    await bulkUpdateStagedJobStatus(runId, "approved", {
      jobIds: options.jobIds,
      excludeImportStatus: "imported",
    });
  }

  const filters: { importStatus: string; tier?: string; tiers?: string[]; jobIds?: string[] } = {
    importStatus: "approved",
  };
  if (options.tier) filters.tier = options.tier;
  if (options.tiers && options.tiers.length > 0) filters.tiers = options.tiers;
  if (options.jobIds && options.jobIds.length > 0) filters.jobIds = options.jobIds;

  const approved = await listStagedJobs(runId, { ...filters, pageSize: 10000 });
  return importRows(runId, approved.items);
}

async function importRows(
  runId: string,
  stagedJobs: JobAgentStagedJobRow[]
): Promise<{ imported: number; skipped: number }> {
  if (stagedJobs.length === 0) return { imported: 0, skipped: 0 };

  const dateExcludedIds = stagedJobs
    .filter((job) => job.date_window_status === "excluded")
    .map((job) => job.id);
  stagedJobs = stagedJobs.filter((job) => job.date_window_status !== "excluded");

  // Build candidate rows matching the existing dedup interface.
  const candidates = stagedJobs.map((staged) => ({
    source_url: staged.source_url,
    title: staged.job_title,
    company: staged.company_name,
    posted_at: parsePostedAt(staged.date_posted),
    applicants_count: null as number | null,
    _staged_id: staged.id,
    _job_row: stagedJobToJobRow(staged),
  }));

  const { newRows } = await filterNewJobs(candidates);
  const acceptedIds = new Set(newRows.map((row) => row._staged_id));
  const existingJobDuplicateIds = stagedJobs
    .filter((staged) => !acceptedIds.has(staged.id))
    .map((staged) => staged.id);
  const rejections: ApprovedBridgeRejection[] = [
    ...dateExcludedIds.map((sourceStagedId) => ({
      sourceStagedId,
      reason: "date_window_excluded",
      markDuplicate: false,
    })),
    ...existingJobDuplicateIds.map((sourceStagedId) => ({
      sourceStagedId,
      reason: "existing_job_duplicate",
      markDuplicate: true,
    })),
  ];

  const stagedById = new Map(stagedJobs.map((staged) => [staged.id, staged]));
  const bridgeCandidates = newRows
    .map((row) => stagedById.get(row._staged_id))
    .filter((row): row is JobAgentStagedJobRow => Boolean(row))
    .map(toApprovedBridgeCandidate);
  const bridge = await createApprovedBridgeRun(
    bridgeCandidates,
    "job_agent_import",
    undefined,
    rejections,
  );

  if (bridge.runId) {
    await logActivity({
      type: "job_ceo_run_started",
      description: "Job CEO run started (job_agent_import)",
      entityType: "job_ceo_run",
      entityId: bridge.runId,
    });
    // Kick off the Job CEO dispatch chain for the bridged jobs.
    // waitUntil from @vercel/functions is a no-op on Cloudflare Workers, so we instead
    // fire a self-fetch to /api/job-ceo/dispatch — the same pattern used by ingest/route.ts.
    // backgroundDispatch registers the fetch with ctx.waitUntil() so it survives past the
    // HTTP response on Cloudflare and doesn't get garbage-collected early.
    const baseUrl =
      process.env.TALENTOS_BASE_URL ||
      (process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : "https://talent.skarion.com");
    const cronSecret = process.env.CRON_SECRET;
    await backgroundDispatch(
      fetch(`${baseUrl}/api/job-ceo/dispatch`, {
        method: "POST",
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined,
      }).catch((err) => {
        console.error("[jobAgentImporter] Bridge dispatch self-fetch failed:", (err as Error).message);
      })
    );
  }

  const run = await getRunById(runId);
  return {
    imported: run?.imported_count ?? bridge.insertedSourceIds.length,
    skipped: run?.skipped_count ?? bridge.duplicateCount,
  };
}

export { canonicalBridgeSignature, stagedJobToJobRow, toApprovedBridgeCandidate };
