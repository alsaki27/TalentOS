// src/lib/jobAgentImporter.ts
// Handles the "approve → import into main jobs table" flow.
// Uses createJobs() and filterNewJobs() from the existing codebase, then triggers
// company directory sync and AI categorization so imported jobs get the same
// treatment as any other import source.

import { filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { createJobs } from "@/server/repositories/jobsRepository";
import {
  listStagedJobs,
  bulkUpdateStagedJobStatus,
  updateRunStatus,
  getRunById,
  type JobAgentStagedJobRow,
} from "@/server/repositories/jobAgentRunRepository";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";
import { startRun, dispatchAndChain } from "@/server/services/jobCeoService";
import { insertStaged } from "@/server/repositories/jobCeoStagingRepository";

export interface ImportApprovedJobsOptions {
  tier?: "best" | "medium" | "worthy";
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
  if (options.jobIds && options.jobIds.length > 0) {
    await bulkUpdateStagedJobStatus(runId, "approved", {
      jobIds: options.jobIds,
      excludeImportStatus: "imported",
    });
  }

  const filters: { importStatus: string; tier?: string; jobIds?: string[] } = {
    importStatus: "approved",
  };
  if (options.tier) filters.tier = options.tier;
  if (options.jobIds && options.jobIds.length > 0) filters.jobIds = options.jobIds;

  const approved = await listStagedJobs(runId, { ...filters, pageSize: 10000 });
  return importRows(runId, approved.items);
}

async function importRows(
  runId: string,
  stagedJobs: JobAgentStagedJobRow[]
): Promise<{ imported: number; skipped: number }> {
  if (stagedJobs.length === 0) return { imported: 0, skipped: 0 };

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

  const { newRows, duplicates } = await filterNewJobs(candidates);

  let inserted: any[] = [];
  let runRecord: any = null;
  if (newRows.length > 0) {
    // Apify -> Job CEO Bridge
    runRecord = await startRun({
      source: "apify_bridge",
      triggerType: "job_agent_import"
    });

    const stagedInserts = newRows.map((c: any) => {
      const row = c._job_row as Record<string, unknown>;
      return {
        run_id: runRecord.id,
        stage: "qa_passed" as any, // Skip QA, you already approved it
        title: row.title as string,
        company: row.company as string,
        location: row.location as string,
        source_url: row.source_url as string,
        external_job_id: row.external_job_id as string,
        description_text: row.description_text as string,
        raw: row, // Pass all the Apify fields (salary, etc.) so Matchmaker saves them
      };
    });

    await insertStaged(runRecord.id, stagedInserts);
    inserted = stagedInserts; // For the insertedByUrl map below
  }

  // Map inserted jobs back to staged job IDs and mark them imported.
  const insertedByUrl = new Map<string, string>(
    inserted
      .map((job: any) => [job.source_url as string, job.id as string] as [string, string])
      .filter(([url]) => url)
  );

  const importedStagedIds: string[] = [];
  for (const staged of stagedJobs) {
    const jobId = staged.source_url ? insertedByUrl.get(staged.source_url) : undefined;
    if (jobId) {
      importedStagedIds.push(staged.id);
    }
  }

  if (importedStagedIds.length > 0) {
    await bulkUpdateStagedJobStatus(runId, "imported", { jobIds: importedStagedIds });
  }

  // Update run counts incrementally so multiple partial imports (e.g. Best, then Medium)
  // do not overwrite each other.
  const currentRun = await getRunById(runId);
  const run = await updateRunStatus(runId, {
    imported_count: (currentRun?.imported_count ?? 0) + importedStagedIds.length,
    skipped_count: (currentRun?.skipped_count ?? 0) + duplicates,
  });

  // Trigger AI categorization in the background for newly imported jobs.
  // Not needed here anymore since they aren't in the jobs table yet. The Matchmaker
  // or a background cron will handle it when they finally arrive in the jobs table.

  if (runRecord) {
    // Start the Deep Fetch -> Matchmaker chain immediately for the bridged jobs
    dispatchAndChain().catch((err) => {
      console.error("[jobAgentImporter] Bridge dispatch chain failed:", (err as Error).message);
    });
  }

  return { imported: run.imported_count, skipped: run.skipped_count };
}