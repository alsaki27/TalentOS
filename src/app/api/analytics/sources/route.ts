// src/app/api/analytics/sources/route.ts
// GET -> application source breakdown with conversion and time-to-hire

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const SOURCE_ORDER = [
  "manual",
  "csv_import",
  "greenhouse",
  "lever",
  "ashby",
  "usajobs",
  "linkedin",
  "career_page",
];

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom") || null;
  const dateTo = url.searchParams.get("dateTo") || null;

  let query = supabase
    .from("applications")
    .select("source, status, created_at, job_id");
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo);
  const { data: apps, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch job creation dates for placed apps to compute time-to-hire
  const placedJobIds = [
    ...new Set(
      (apps ?? [])
        .filter((a) => a.status === "placed" && a.job_id)
        .map((a) => a.job_id)
    ),
  ];
  const jobCreatedMap = new Map<string, string>();
  if (placedJobIds.length > 0) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, created_at")
      .in("id", placedJobIds);
    for (const j of jobs ?? []) {
      jobCreatedMap.set(j.id, j.created_at);
    }
  }

  const stats: Record<
    string,
    { count: number; placed: number; daysToHire: number[] }
  > = {};
  for (const source of SOURCE_ORDER) {
    stats[source] = { count: 0, placed: 0, daysToHire: [] };
  }

  for (const app of apps ?? []) {
    const source = app.source || "manual";
    if (!stats[source]) {
      stats[source] = { count: 0, placed: 0, daysToHire: [] };
    }
    stats[source].count++;
    if (app.status === "placed") {
      stats[source].placed++;
      const jobCreated = jobCreatedMap.get(app.job_id);
      if (jobCreated) {
        const days = Math.round(
          (new Date(app.created_at).getTime() - new Date(jobCreated).getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (days >= 0) stats[source].daysToHire.push(days);
      }
    }
  }

  const sources = SOURCE_ORDER.map((source) => ({
    name: source,
    count: stats[source].count,
    conversionRate:
      stats[source].count > 0
        ? Math.round((stats[source].placed / stats[source].count) * 1000) / 10
        : 0,
    avgTimeToHire:
      stats[source].daysToHire.length > 0
        ? Math.round(
            stats[source].daysToHire.reduce((a, b) => a + b, 0) /
              stats[source].daysToHire.length
          )
        : 0,
  }));

  return NextResponse.json({ sources });
}
