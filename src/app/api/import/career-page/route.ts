// src/app/api/import/career-page/route.ts
// POST -> pull job postings from a company career page's embedded schema.org
// JobPosting structured data (no scraping of visual HTML, no auth).

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { fetchCareerPageJobs } from "@/lib/jobPostingExtractor";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { createJobs } from "@/server/repositories/jobsRepository";
import { notifyBatchDuplicateSummary } from "@/lib/jobDuplicateNotify";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const url = body.url?.trim();

  if (!url) {
    return NextResponse.json({ error: "url (career page link) is required" }, { status: 400 });
  }

  let rows;
  try {
    rows = await fetchCareerPageJobs(url);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "failed to fetch jobs" }, { status: 502 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  const { inserted, duplicates } = await createJobs(rows as any);
  await syncCompanyDirectoryFromJobs(inserted);

  if (duplicates.length > 0) {
    await notifyBatchDuplicateSummary({
      runLabel: `career-page scrape (${url})`,
      runLink: "/jobs",
      totalCandidates: rows.length,
      duplicates: duplicates.map((d) => ({
        attemptedTitle: d.input.title, attemptedCompany: d.input.company ?? null,
        attemptedApplyUrl: d.input.apply_url ?? d.input.source_url ?? null, existing: d.existing,
      })),
    }).catch((err) => console.error("Career-page import duplicate summary failed:", err));
  }

  return NextResponse.json({
    imported: inserted.length,
    skipped: duplicates.length,
  });
}
