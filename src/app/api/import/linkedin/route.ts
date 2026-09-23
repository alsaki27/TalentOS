// src/app/api/import/linkedin/route.ts
// POST -> bulk insert jobs from the LinkedIn jobs-scraper dataset (raw JSON array,
// camelCase fields straight from the scraper output, sent here as { rows: [...] }).

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { mapLinkedInJob, LinkedInScrapedJob, JobRow } from "@/lib/linkedinMapper";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { createJobs } from "@/server/repositories/jobsRepository";
import { notifyBatchDuplicateSummary } from "@/lib/jobDuplicateNotify";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const rows: LinkedInScrapedJob[] = body.rows ?? [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "no rows provided" }, { status: 400 });
  }

  const cleanRows = rows
    .map(mapLinkedInJob)
    .filter((r): r is JobRow => r !== null);

  if (cleanRows.length === 0) {
    return NextResponse.json({ error: "no valid rows (missing title)" }, { status: 400 });
  }

  const { inserted, duplicates } = await createJobs(cleanRows as any);
  await syncCompanyDirectoryFromJobs(inserted);

  if (duplicates.length > 0) {
    await notifyBatchDuplicateSummary({
      runLabel: "LinkedIn scraper import",
      runLink: "/jobs",
      totalCandidates: rows.length,
      duplicates: duplicates.map((d) => ({
        attemptedTitle: d.input.title, attemptedCompany: d.input.company ?? null,
        attemptedApplyUrl: d.input.apply_url ?? d.input.source_url ?? null, existing: d.existing,
      })),
    }).catch((err) => console.error("LinkedIn import duplicate summary failed:", err));
  }

  return NextResponse.json({
    imported: inserted.length,
    skipped: rows.length - cleanRows.length + duplicates.length,
  });
}
