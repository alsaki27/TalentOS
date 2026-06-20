// src/lib/importSourceRunner.ts
// Shared run logic for one saved import source — used by both the scheduled cron
// route and the manual "Run now" trigger, so they can't drift apart.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, execute } from "@/server/db/neon";
import { createJobs } from "@/server/repositories/jobsRepository";
import { fetchAtsJobs } from "@/lib/atsFetchers";
import { fetchCareerPageJobs } from "@/lib/jobPostingExtractor";
import { filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";

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

    const { newRows, duplicates } = await filterNewJobs(rows);
    const inserted = newRows.length > 0 ? await createJobs(newRows) : [];

    if (inserted?.length) await syncCompanyDirectoryFromJobs(inserted as any);

    return { imported: inserted?.length ?? 0, skipped: duplicates };
  } catch (err: any) {
    return { error: err.message ?? "import failed" };
  }
}

export async function runAndRecord(source: ImportSource): Promise<ImportRunResult> {
  const result = await runImportSource(source);
  const ranAt = new Date().toISOString();

  await Promise.all([
    isNeon()
      ? execute(
          "UPDATE import_sources SET last_run_at = $1, last_result = $2 WHERE id = $3",
          [ranAt, JSON.stringify(result), source.id]
        )
      : supabase.from("import_sources").update({ last_run_at: ranAt, last_result: result }).eq("id", source.id),
    isNeon()
      ? execute(
          "INSERT INTO import_runs (import_source_id, ran_at, imported, skipped, error) VALUES ($1, $2, $3, $4, $5)",
          [source.id, ranAt, "imported" in result ? result.imported : 0, "imported" in result ? result.skipped : 0, "error" in result ? result.error : null]
        )
      : supabase.from("import_runs").insert({ import_source_id: source.id, ran_at: ranAt, ...result }),
  ]);

  return result;
}
