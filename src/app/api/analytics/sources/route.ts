// src/app/api/analytics/sources/route.ts
// GET -> application source breakdown with conversion and time-to-hire

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

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

  let apps: any[] = [];
  const whereClauses: string[] = [];
  const params: (string | null)[] = [];
  if (dateFrom) { whereClauses.push(`applied_at >= $${params.length + 1}`); params.push(dateFrom); }
  if (dateTo) { whereClauses.push(`applied_at <= $${params.length + 1}`); params.push(dateTo); }
  const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
  apps = await query<any>(`SELECT source, status, applied_at, job_id FROM applications ${where}`, params);

  // Fetch job creation dates for placed apps to compute time-to-hire
  const placedJobIds = [
    ...new Set(
      apps
        .filter((a: any) => a.status === "placed" && a.job_id)
        .map((a: any) => a.job_id as string)
    ),
  ];
  const jobCreatedMap = new Map<string, string>();
  if (placedJobIds.length > 0) {
    let jobs: any[] = [];
      jobs = await query<any>(`SELECT id, created_at FROM jobs WHERE id::text = ANY($1)`, [placedJobIds]);
    for (const j of jobs) {
      const job = j as any;
      jobCreatedMap.set(job.id as string, job.created_at as string);
    }
  }

  const stats: Record<
    string,
    { count: number; placed: number; daysToHire: number[] }
  > = {};
  for (const source of SOURCE_ORDER) {
    stats[source] = { count: 0, placed: 0, daysToHire: [] };
  }

  for (const app of apps) {
    const a = app as any;
    const source = (a.source as string | undefined) || "manual";
    if (!stats[source]) {
      stats[source] = { count: 0, placed: 0, daysToHire: [] };
    }
    stats[source].count++;
    if (a.status === "placed") {
      stats[source].placed++;
      const jobCreated = jobCreatedMap.get(a.job_id as string);
      if (jobCreated) {
        const days = Math.round(
          (new Date(a.created_at as string).getTime() - new Date(jobCreated).getTime()) /
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
            stats[source].daysToHire.reduce((sum: number, d: number) => sum + d, 0) /
              stats[source].daysToHire.length
          )
        : 0,
  }));

  return NextResponse.json({ sources });
}
