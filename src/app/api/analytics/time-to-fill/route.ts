// src/app/api/analytics/time-to-fill/route.ts
// GET -> average time-to-fill grouped by role, department, or recruiter

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom") || null;
  const dateTo = url.searchParams.get("dateTo") || null;
  const groupBy = url.searchParams.get("groupBy") || "role";

  let jobs: any[] = [];
  if (isNeon()) {
    const whereClauses: string[] = [];
    const params: (string | null)[] = [];
    if (dateFrom) { whereClauses.push(`created_at >= $${params.length + 1}`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`created_at <= $${params.length + 1}`); params.push(dateTo); }
    const where = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";
    jobs = await query<any>(`SELECT id, title, company, created_at FROM jobs ${where}`, params);
  } else {
    const { supabase } = await import("@/lib/supabase");
    let jobsQuery = supabase
      .from("jobs")
      .select("id, title, company, created_at");
    if (dateFrom) jobsQuery = jobsQuery.gte("created_at", dateFrom);
    if (dateTo) jobsQuery = jobsQuery.lte("created_at", dateTo);
    const { data, error: jobsError } = await jobsQuery;

    if (jobsError) {
      return NextResponse.json({ error: jobsError.message }, { status: 500 });
    }
    jobs = data ?? [];
  }

  const jobIds = jobs.map((j: any) => j.id as string);
  if (jobIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  let placedApps: any[] = [];
  if (isNeon()) {
    placedApps = await query<any>(`SELECT job_id, applied_at, status, created_by FROM applications WHERE status = 'placed' AND job_id::text = ANY($1)`, [jobIds]);
  } else {
    const { supabase } = await import("@/lib/supabase");
    let appsQuery = supabase
      .from("applications")
      .select("job_id, created_at, status, created_by")
      .eq("status", "placed")
      .in("job_id", jobIds);
    const { data, error: appsError } = await appsQuery;

    if (appsError) {
      return NextResponse.json({ error: appsError.message }, { status: 500 });
    }
    placedApps = data ?? [];
  }

  // First placed date per job
  const jobFirstPlaced: Record<string, { date: string; recruiters: string[] }> = {};
  for (const app of placedApps) {
    const appJobId = app.job_id as string | undefined;
    const appCreatedAt = app.created_at as string;
    const appCreatedBy = app.created_by as string;
    if (!appJobId) continue;
    if (!jobFirstPlaced[appJobId] || appCreatedAt < jobFirstPlaced[appJobId].date) {
      jobFirstPlaced[appJobId] = { date: appCreatedAt, recruiters: [appCreatedBy] };
    } else if (appCreatedAt === jobFirstPlaced[appJobId].date) {
      jobFirstPlaced[appJobId].recruiters.push(appCreatedBy);
    }
  }

  const jobDays: Array<{ job: any; days: number; recruiters: string[] }> = [];
  for (const job of jobs) {
    const jobId = job.id as string;
    const jobCreatedAt = job.created_at as string;
    const fp = jobFirstPlaced[jobId];
    if (!fp) continue;
    const days = Math.round(
      (new Date(fp.date).getTime() - new Date(jobCreatedAt).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (days >= 0) {
      jobDays.push({ job, days, recruiters: fp.recruiters });
    }
  }

  // Fetch recruiter names if needed
  let profileMap = new Map<string, string | null>();
  if (groupBy === "recruiter") {
    const allRecruiterIds = new Set<string>();
    for (const jd of jobDays) {
      for (const rid of jd.recruiters) {
        if (rid) allRecruiterIds.add(rid);
      }
    }
    if (allRecruiterIds.size > 0) {
      let profiles: any[] = [];
      if (isNeon()) {
        profiles = await query<any>(`SELECT user_id, display_name FROM profiles WHERE user_id::text = ANY($1)`, [Array.from(allRecruiterIds)]);
      } else {
        const { supabase } = await import("@/lib/supabase");
        const { data } = await supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", [...allRecruiterIds]);
        profiles = data ?? [];
      }
      profileMap = new Map(profiles?.map((p: { user_id: string; display_name: string | null }) => [p.user_id, p.display_name]) ?? []);
    }
  }

  const groupMap = new Map<string, { days: number[]; count: number }>();
  for (const { job, days, recruiters } of jobDays) {
    let keys: string[];
    if (groupBy === "department") {
      keys = [job.company || "Unknown"];
    } else if (groupBy === "recruiter") {
      keys = [...new Set(recruiters.filter(Boolean))];
    } else {
      keys = [job.title || "Unknown"];
    }

    for (const key of keys) {
      if (!groupMap.has(key)) {
        groupMap.set(key, { days: [], count: 0 });
      }
      const g = groupMap.get(key)!;
      g.days.push(days);
      g.count++;
    }
  }

  const data = Array.from(groupMap.entries()).map(([label, stats]) => ({
    label: groupBy === "recruiter" ? (profileMap.get(label) || label) : label,
    avgDays: Math.round(stats.days.reduce((a, b) => a + b, 0) / stats.days.length),
    minDays: Math.min(...stats.days),
    maxDays: Math.max(...stats.days),
    count: stats.count,
  }));

  // Sort by avgDays descending for readability
  data.sort((a, b) => b.avgDays - a.avgDays);

  return NextResponse.json({ data });
}
