// src/app/api/import/career-page/route.ts
// POST -> pull job postings from a company career page's embedded schema.org
// JobPosting structured data (no scraping of visual HTML, no auth).

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { fetchCareerPageJobs } from "@/lib/jobPostingExtractor";
import { filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";

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

  const { newRows, duplicates } = await filterNewJobs(rows);

  if (newRows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: duplicates });
  }

  const { data, error } = await supabase.from("jobs").insert(newRows).select("*");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncCompanyDirectoryFromJobs(data ?? []);

  return NextResponse.json({
    imported: data.length,
    skipped: duplicates,
  });
}
