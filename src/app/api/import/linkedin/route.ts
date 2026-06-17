// src/app/api/import/linkedin/route.ts
// POST -> bulk insert jobs from the LinkedIn jobs-scraper dataset (raw JSON array,
// camelCase fields straight from the scraper output, sent here as { rows: [...] }).

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { mapLinkedInJob, LinkedInScrapedJob, JobRow } from "@/lib/linkedinMapper";
import { enrichExistingJobsBySourceUrl, filterNewJobs } from "@/lib/jobDedup";

export async function POST(req: NextRequest) {
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

  await enrichExistingJobsBySourceUrl(cleanRows);
  const { newRows, duplicates } = await filterNewJobs(cleanRows);

  if (newRows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: rows.length - cleanRows.length + duplicates });
  }

  const { data, error } = await supabase.from("jobs").insert(newRows).select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    imported: data.length,
    skipped: rows.length - cleanRows.length + duplicates,
  });
}
