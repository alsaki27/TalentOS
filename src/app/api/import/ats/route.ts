// src/app/api/import/ats/route.ts
// POST -> pull live jobs from a company's public Greenhouse/Lever/Ashby job board, or a
// USAJobs keyword search (no scraping) and bulk insert new ones into the jobs table.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { fetchAtsJobs } from "@/lib/atsFetchers";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { createJobs } from "@/server/repositories/jobsRepository";
import { notifyBatchDuplicateSummary } from "@/lib/jobDuplicateNotify";

const PROVIDERS = ["greenhouse", "lever", "ashby", "usajobs"] as const;

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const provider = body.provider;
  const token = body.token?.trim();

  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "provider must be one of: greenhouse, lever, ashby, usajobs" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: provider === "usajobs" ? "search keyword is required" : "token (company board slug) is required" }, { status: 400 });
  }

  let rows;
  try {
    rows = await fetchAtsJobs(provider, token);
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
      runLabel: `${provider} ATS pull (${token})`,
      runLink: "/jobs",
      totalCandidates: rows.length,
      duplicates: duplicates.map((d) => ({
        attemptedTitle: d.input.title, attemptedCompany: d.input.company ?? null,
        attemptedApplyUrl: d.input.apply_url ?? d.input.source_url ?? null, existing: d.existing,
      })),
    }).catch((err) => console.error("ATS import duplicate summary failed:", err));
  }

  return NextResponse.json({
    imported: inserted.length,
    skipped: duplicates.length,
  });
}
