// src/app/api/analytics/time-to-fill/route.ts
// GET -> average time-to-fill grouped by role, department, or recruiter

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom") || null;
  const dateTo = url.searchParams.get("dateTo") || null;
  const groupBy = url.searchParams.get("groupBy") || "role";

  let jobsQuery = supabase
    .from("jobs")
    .select("id, title, company, created_at");
  if (dateFrom) jobsQuery = jobsQuery.gte("created_at", dateFrom);
  if (dateTo) jobsQuery = jobsQuery.lte("created_at", dateTo);
  const { data: jobs, error: jobsError } = await jobsQuery;

  if (jobsError) {
    return NextResponse.json({ error: jobsError.message }, { status: 500 });
  }

  const jobIds = (jobs ?? []).map((j) => j.id);
  if (jobIds.length === 0) {
    return NextResponse.json({ data: [] });
  }

  let appsQuery = supabase
    .from("applications")
    .select("job_id, created_at, status, created_by")
    .eq("status", "placed")
    .in("job_id", jobIds);
  const { data: placedApps, error: appsError } = await appsQuery;

  if (appsError) {
    return NextResponse.json({ error: appsError.message }, { status: 500 });
  }

  // First placed date per job
  const jobFirstPlaced: Record<string, { date: string; recruiters: string[] }> = {};
  for (const app of placedApps ?? []) {
    if (!app.job_id) continue;
    if (!jobFirstPlaced[app.job_id] || app.created_at < jobFirstPlaced[app.job_id].date) {
      jobFirstPlaced[app.job_id] = { date: app.created_at, recruiters: [app.created_by] };
    } else if (app.created_at === jobFirstPlaced[app.job_id].date) {
      jobFirstPlaced[app.job_id].recruiters.push(app.created_by);
    }
  }

  const jobDays: Array<{ job: any; days: number; recruiters: string[] }> = [];
  for (const job of jobs ?? []) {
    const fp = jobFirstPlaced[job.id];
    if (!fp) continue;
    const days = Math.round(
      (new Date(fp.date).getTime() - new Date(job.created_at).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (days >= 0) {
      jobDays.push({ job, days, recruiters: fp.recruiters });
    }
  }

  // Fetch recruiter names if needed
  let profileMap = new Map<string, string>();
  if (groupBy === "recruiter") {
    const allRecruiterIds = new Set<string>();
    for (const jd of jobDays) {
      for (const rid of jd.recruiters) {
        if (rid) allRecruiterIds.add(rid);
      }
    }
    if (allRecruiterIds.size > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", [...allRecruiterIds]);
      profileMap = new Map(profiles?.map((p) => [p.user_id, p.display_name]) ?? []);
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
