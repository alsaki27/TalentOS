// src/app/api/import/jobs/route.ts
// POST -> bulk insert jobs from CSV (parsed client-side with papaparse,
// raw rows sent here as JSON). Expects columns: title, company, location,
// role_tier, salary_range, source_url, notes (all optional except title).

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { filterNewJobs } from "@/lib/jobDedup";

interface CsvRow {
  title?: string;
  company?: string;
  location?: string;
  role_tier?: string;
  salary_range?: string;
  source_url?: string;
  notes?: string;
  posted_at?: string;
  applicants_count?: string | number;
}

function toInt(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const rows: CsvRow[] = body.rows ?? [];

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "no rows provided" }, { status: 400 });
  }

  // Filter out rows with no title — those are junk/blank lines.
  const cleanRows = rows
    .filter((r) => r.title && r.title.trim().length > 0)
    .map((r) => ({
      title: r.title!.trim(),
      company: r.company?.trim() || null,
      location: r.location?.trim() || null,
      source: "csv_import",
      role_tier: r.role_tier?.trim() || null,
      salary_range: r.salary_range?.trim() || null,
      source_url: r.source_url?.trim() || null,
      notes: r.notes?.trim() || null,
      posted_at: r.posted_at?.trim() || null,
      applicants_count: toInt(r.applicants_count),
    }));

  if (cleanRows.length === 0) {
    return NextResponse.json({ error: "no valid rows (missing title)" }, { status: 400 });
  }

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
