// src/app/api/jobs/facets/route.ts
// GET -> distinct source/employment-type/category values across all jobs, for filter
// dropdowns. Selects only small columns so this stays cheap even at thousands of rows
// (the main /api/jobs list is paginated and can't derive these from a single page).

import { NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  let data: any;
  let error: any;

  if (isNeon()) {
    try {
      data = await query(`SELECT source, employment_type, job_category, category_tags FROM jobs`);
      error = null;
    } catch (err: any) {
      error = { message: err.message };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("jobs")
      .select("source, employment_type, job_category, category_tags");
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sources = new Set<string>();
  const employmentTypes = new Set<string>();
  const categories = new Set<string>();
  for (const job of data ?? []) {
    if (job.source) sources.add(job.source);
    if (job.employment_type) employmentTypes.add(job.employment_type);
    if (job.job_category) categories.add(job.job_category);
    for (const tag of job.category_tags ?? []) categories.add(tag);
  }

  return NextResponse.json({
    sources: Array.from(sources).sort(),
    employmentTypes: Array.from(employmentTypes).sort(),
    categories: Array.from(categories).sort(),
  }, {
    headers: { "Cache-Control": "private, max-age=300" },
  });
}
