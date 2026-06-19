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
  for (const c of candidates ?? []) if ((c as any).created_by) userIds.add((c as any).created_by as string);
  for (const a of applications ?? []) if ((a as any).created_by) userIds.add((a as any).created_by as string);
  for (const i of interviews ?? []) if ((i as any).created_by) userIds.add((i as any).created_by as string);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", [...userIds]);
  const profileMap = new Map(
    profiles?.map((p: { user_id: string; display_name: string | null }) => [p.user_id, p.display_name]) ?? []
  );

  // 5. Compute time-to-fill per recruiter (jobs where they made the first placement)
  const placedApps = (applications ?? []).filter(
    (a: any) => a.status === "placed" && a.job_id
  );
  const jobIds = [...new Set(placedApps.map((a: any) => a.job_id))];
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, created_at")
    .in("id", jobIds);
  const jobCreatedMap = new Map<string, string>(jobs?.map((j: any) => [j.id as string, j.created_at as string]) ?? []);

  const jobFirstPlaced: Record<string, string> = {};
  for (const app of placedApps) {
    const appJobId = (app as any).job_id as string | undefined;
    const appCreatedAt = (app as any).created_at as string;
    if (!appJobId) continue;
    if (
      !jobFirstPlaced[appJobId] ||
      appCreatedAt < jobFirstPlaced[appJobId]
    ) {
      jobFirstPlaced[appJobId] = appCreatedAt;
    }
  }

  const recruiterJobDays: Record<string, number[]> = {};
  for (const app of placedApps) {
    const appJobId = (app as any).job_id as string;
    const appCreatedAt = (app as any).created_at as string;
    const appCreatedBy = (app as any).created_by as string;
    const firstPlaced = jobFirstPlaced[appJobId];
    if (appCreatedAt !== firstPlaced) continue; // only count first placement
    const jobCreated = jobCreatedMap.get(appJobId);
    if (!jobCreated) continue;
    const days = Math.round(
      (new Date(appCreatedAt).getTime() - new Date(jobCreated).getTime()) /
        (1000 * 60 * 60 * 24)
    );
    if (days >= 0) {
      if (!recruiterJobDays[appCreatedBy]) {
        recruiterJobDays[appCreatedBy] = [];
      }
      recruiterJobDays[appCreatedBy].push(days);
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
      const name = profileMap.get(id);
      stats[id] = {
        name: (name ?? undefined) === undefined ? id : (name as string),
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
    const createdBy = (c as any).created_by as string | undefined;
    if (!createdBy) continue;
    ensure(createdBy);
    stats[createdBy].candidatesSourced++;
  }

  for (const a of applications ?? []) {
    const createdBy = (a as any).created_by as string | undefined;
    const status = (a as any).status as string | undefined;
    if (!createdBy) continue;
    ensure(createdBy);
    stats[createdBy].applicationsReviewed++;
    if (status === "offer") stats[createdBy].offersExtended++;
    if (status === "placed") stats[createdBy].hiresMade++;
  }

  for (const i of interviews ?? []) {
    const createdBy = (i as any).created_by as string | undefined;
    if (!createdBy) continue;
    ensure(createdBy);
    stats[createdBy].interviewsScheduled++;
  }

  for (const [userId, days] of Object.entries(recruiterJobDays)) {
    ensure(userId);
    stats[userId].avgTimeToFill = Math.round(
      days.reduce((sum: number, d: number) => sum + d, 0) / days.length
    );
  }

  const recruiters = Object.values(stats).sort(
    (a, b) => b.hiresMade - a.hiresMade
  );

  return NextResponse.json({ recruiters });
}
