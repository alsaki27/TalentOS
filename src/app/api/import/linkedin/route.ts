// src/app/api/import/linkedin/route.ts
// POST -> bulk insert jobs from the LinkedIn jobs-scraper dataset (raw JSON array,
// camelCase fields straight from the scraper output, sent here as { rows: [...] }).

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { mapLinkedInJob, LinkedInScrapedJob, JobRow } from "@/lib/linkedinMapper";
import { enrichExistingJobsBySourceUrl, filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";

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

  await enrichExistingJobsBySourceUrl(cleanRows);
  const { newRows, duplicates } = await filterNewJobs(cleanRows);

  if (newRows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: rows.length - cleanRows.length + duplicates });
  }

  let data: any[];

  const cols = Object.keys(newRows[0]);
  const values: any[] = [];
  const placeholders: string[] = [];
  let paramIdx = 1;
  for (const row of newRows) {
    const rowPlaceholders: string[] = [];
    for (const col of cols) {
      rowPlaceholders.push(`$${paramIdx++}`);
      values.push((row as any)[col]);
    }
    placeholders.push(`(${rowPlaceholders.join(", ")})`);
  }
  const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;
  data = await query(sql, values);

  await syncCompanyDirectoryFromJobs(data ?? []);

  return NextResponse.json({
    imported: data.length,
    skipped: rows.length - cleanRows.length + duplicates,
  });
}
