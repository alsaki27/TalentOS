// src/app/api/analytics/recruiters/route.ts
// GET -> recruiter performance leaderboard

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

  // 1. Candidates sourced
  let candQuery = supabase.from("candidates").select("created_by");
  if (dateFrom) candQuery = candQuery.gte("created_at", dateFrom);
  if (dateTo) candQuery = candQuery.lte("created_at", dateTo);
  const { data: candidates } = await candQuery;

  // 2. Applications processed
  let appQuery = supabase
    .from("applications")
    .select("created_by, status, job_id, created_at");
  if (dateFrom) appQuery = appQuery.gte("created_at", dateFrom);
  if (dateTo) appQuery = appQuery.lte("created_at", dateTo);
  const { data: applications } = await appQuery;

  // 3. Interviews scheduled
  let intQuery = supabase.from("interview_schedules").select("created_by");
  if (dateFrom) intQuery = intQuery.gte("created_at", dateFrom);
  if (dateTo) intQuery = intQuery.lte("created_at", dateTo);
  const { data: interviews } = await intQuery;

  // 4. Resolve names
  const userIds = new Set<string>();
  for (const c of candidates ?? []) if (c.created_by) userIds.add(c.created_by);
  for (const a of applications ?? []) if (a.created_by) userIds.add(a.created_by);
  for (const i of interviews ?? []) if (i.created_by) userIds.add(i.created_by);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", [...userIds]);
  const profileMap = new Map(
    profiles?.map((p) => [p.user_id, p.display_name]) ?? []
  );

  // 5. Compute time-to-fill per recruiter (jobs where they made the first placement)
  const placedApps = (applications ?? []).filter(
    (a) => a.status === "placed" && a.job_id
  );
  const jobIds = [...new Set(placedApps.map((a) => a.job_id))];
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, created_at")
    .in("id", jobIds);
  const jobCreatedMap = new Map(jobs?.map((j) => [j.id, j.created_at]) ?? []);

  const jobFirstPlaced: Record<string, string> = {};
  for (const app of placedApps) {
    if (!app.job_id) continue;
    if (
      !jobFirstPlaced[app.job_id] ||
      app.created_at < jobFirstPlaced[app.job_id]
    ) {
      jobFirstPlaced[app.job_id] = app.created_at;
    }
  }

  const recruiterJobDays: Record<string, number[]> = {};
  for (const app of placedApps) {
    const firstPlaced = jobFirstPlaced[app.job_id];
    if (app.created_at !== firstPlaced) continue; // only count first placement
    const jobCreated = jobCreatedMap.get(app.job_id);
    if (!jobCreated) continue;
    const days = Math.round(
      (new Date(app.created_at).getTime() - new Date(jobCreated).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (days >= 0) {
      if (!recruiterJobDays[app.created_by]) {
        recruiterJobDays[app.created_by] = [];
      }
      recruiterJobDays[app.created_by].push(days);
    }
  }

  // 6. Aggregate stats
  const stats: Record<
    string,
    {
      name: string;
      candidatesSourced: number;
      applicationsReviewed: number;
      interviewsScheduled: number;
      offersExtended: number;
      hiresMade: number;
      avgTimeToFill: number;
    }
  > = {};

  const ensure = (id: string) => {
    if (!stats[id]) {
      stats[id] = {
        name: profileMap.get(id) || id,
        candidatesSourced: 0,
        applicationsReviewed: 0,
        interviewsScheduled: 0,
        offersExtended: 0,
        hiresMade: 0,
        avgTimeToFill: 0,
      };
    }
  };

  for (const c of candidates ?? []) {
    if (!c.created_by) continue;
    ensure(c.created_by);
    stats[c.created_by].candidatesSourced++;
  }

  for (const a of applications ?? []) {
    if (!a.created_by) continue;
    ensure(a.created_by);
    stats[a.created_by].applicationsReviewed++;
    if (a.status === "offer") stats[a.created_by].offersExtended++;
    if (a.status === "placed") stats[a.created_by].hiresMade++;
  }

  for (const i of interviews ?? []) {
    if (!i.created_by) continue;
    ensure(i.created_by);
    stats[i.created_by].interviewsScheduled++;
  }

  for (const [userId, days] of Object.entries(recruiterJobDays)) {
    ensure(userId);
    stats[userId].avgTimeToFill = Math.round(
      days.reduce((a, b) => a + b, 0) / days.length
    );
  }

  const recruiters = Object.values(stats).sort(
    (a, b) => b.hiresMade - a.hiresMade
  );

  return NextResponse.json({ recruiters });
}
