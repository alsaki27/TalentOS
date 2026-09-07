// src/lib/importSourceRunner.ts
// Shared run logic for one saved import source — used by both the scheduled cron
// route and the manual "Run now" trigger, so they can't drift apart.

import { query, execute } from "@/server/db/neon";
import { createJobs } from "@/server/repositories/jobsRepository";
import { fetchAtsJobs } from "@/lib/atsFetchers";
import { fetchCareerPageJobs } from "@/lib/jobPostingExtractor";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { notifyBatchDuplicateSummary } from "@/lib/jobDuplicateNotify";

export interface ImportSource {
  id: string;
  label: string;
  provider: string;
  token_or_url: string;
}

export type ImportRunResult = { imported: number; skipped: number } | { error: string };

export async function runImportSource(source: ImportSource): Promise<ImportRunResult> {
  try {
    const rows = source.provider === "career_page"
      ? await fetchCareerPageJobs(source.token_or_url)
      : await fetchAtsJobs(source.provider as "greenhouse" | "lever" | "ashby" | "usajobs", source.token_or_url);

    const { inserted, duplicates } = await createJobs(rows);
    if (inserted.length) await syncCompanyDirectoryFromJobs(inserted);

    if (duplicates.length > 0) {
      await notifyBatchDuplicateSummary({
        runLabel: `import source "${source.label}"`,
        runLink: "/jobs",
        totalCandidates: rows.length,
        duplicates: duplicates.map((d) => ({
          attemptedTitle: d.input.title, attemptedCompany: d.input.company ?? null,
          attemptedApplyUrl: d.input.apply_url ?? d.input.source_url ?? null, existing: d.existing,
        })),
      }).catch((err) => console.error(`Import source "${source.label}" duplicate summary failed:`, err));
    }

    return { imported: inserted.length, skipped: duplicates.length };
  } catch (err: any) {
    return { error: err.message ?? "import failed" };
  }
}

export async function runAndRecord(source: ImportSource): Promise<ImportRunResult> {
  const result = await runImportSource(source);
  const ranAt = new Date().toISOString();

  await Promise.all([
    execute(
      "UPDATE import_sources SET last_run_at = $1, last_result = $2 WHERE id = $3",
      [ranAt, JSON.stringify(result), source.id]
    ),
    execute(
      "INSERT INTO import_runs (import_source_id, ran_at, imported, skipped, error) VALUES ($1, $2, $3, $4, $5)",
      [source.id, ranAt, "imported" in result ? result.imported : 0, "imported" in result ? result.skipped : 0, "error" in result ? result.error : null]
    ),
  ]);

  return result;
}
