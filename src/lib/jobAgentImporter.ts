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
  type JobAgentStagedJobRow,
} from "@/server/repositories/jobAgentRunRepository";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

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

  return {
    title: staged.job_title,
    company: staged.company_name ?? null,
    location: staged.location ?? null,
    source: "apify_job_agent",
    source_url: staged.source_url ?? null,
    employment_type: staged.employment_type ?? null,
    seniority_level: staged.seniority_guess ?? null,
    salary_min: staged.salary_min ?? null,
    salary_max: staged.salary_max ?? null,
    salary_range: staged.salary_range ?? null,
    posted_at: parsePostedAt(staged.date_posted),
    is_active: true,
    notes,
  };
}

/**
 * Import approved staged jobs into the main jobs table.
 */
export async function importApprovedJobs(
  runId: string,
  options: ImportApprovedJobsOptions = {}
): Promise<{ imported: number; skipped: number }> {
  // Determine which staged jobs to import.
  const filters: { importStatus: string; tier?: string; jobIds?: string[] } = {
    importStatus: "approved",
  };

  if (options.approveAll) {
    // approveAll means import every non-skip, non-duplicate staged job for this run
    // regardless of current status. Pull them directly.
    const all = await listStagedJobs(runId, { pageSize: 10000 });
    const importable = all.items.filter(
      (j) => j.tier !== "skip" && !j.is_false_positive && !j.is_duplicate
    );
    const result = await importRows(runId, importable);
    return result;
  }

  if (options.tier) {
    filters.tier = options.tier;
  }
  if (options.jobIds && options.jobIds.length > 0) {
    filters.jobIds = options.jobIds;
  }

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
  if (newRows.length > 0) {
    const rowsToInsert = newRows.map((c: any) => c._job_row as Record<string, unknown>);
    inserted = await createJobs(rowsToInsert);
    await syncCompanyDirectoryFromJobs(inserted);
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

  // Update run counts.
  const run = await updateRunStatus(runId, {
    imported_count: importedStagedIds.length,
    skipped_count: duplicates,
  });

  // Trigger AI categorization in the background for newly imported jobs.
  if (importedStagedIds.length > 0) {
    processPendingCategorization({ limit: 200, triggeredBy: "job_agent_import" }).catch((err) => {
      console.error("[jobAgentImporter] categorization kickoff failed:", (err as Error).message);
    });
  }

  return { imported: run.imported_count, skipped: run.skipped_count };
}