// src/app/api/analytics/route.ts
// GET -> non-AI conversion/source/resume metrics, computed in JS over a few
// select() calls (dataset is small enough that a Postgres RPC isn't warranted).

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function GET() {
  const [candidatesRes, jobsRes, applicationsRes, resumesRes] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }),
    supabase.from("jobs").select("id, source, last_seen_at"),
    supabase.from("applications").select("id, status, job_id, resume_id"),
    supabase.from("resumes").select("id, label"),
  ]);

  if (jobsRes.error) return NextResponse.json({ error: jobsRes.error.message }, { status: 500 });
  if (applicationsRes.error) return NextResponse.json({ error: applicationsRes.error.message }, { status: 500 });
  if (resumesRes.error) return NextResponse.json({ error: resumesRes.error.message }, { status: 500 });

  const jobs = jobsRes.data ?? [];
  const allTickets = applicationsRes.data ?? [];
  const resumes = resumesRes.data ?? [];

  // Pipeline tickets are work assigned to an application engineer that hasn't been
  // submitted yet — they aren't real applications and must not skew conversion rates.
  const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);
  const applications = allTickets.filter((a) => !PIPELINE_STATUSES.has(a.status));
  const pipelineCount = allTickets.length - applications.length;

  const totalApplications = applications.length;
  const respondedCount = applications.filter((a) => a.status !== "applied").length;
  const interviewCount = applications.filter((a) => a.status === "interview" || a.status === "offer").length;
  const offerCount = applications.filter((a) => a.status === "offer").length;

  const statusBreakdown: Record<string, number> = {};
  for (const a of allTickets) {
    statusBreakdown[a.status] = (statusBreakdown[a.status] ?? 0) + 1;
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const bySource: Record<string, { jobs: number; applications: number; interviews: number; offers: number; lastSeenAt: string | null }> = {};
  for (const j of jobs) {
    const key = j.source ?? "unknown";
    bySource[key] ??= { jobs: 0, applications: 0, interviews: 0, offers: 0, lastSeenAt: null };
    bySource[key].jobs += 1;
    if (!bySource[key].lastSeenAt || (j.last_seen_at && j.last_seen_at > bySource[key].lastSeenAt!)) {
      bySource[key].lastSeenAt = j.last_seen_at;
    }
  }
  for (const a of applications) {
    const job = jobById.get(a.job_id);
    const key = job?.source ?? "unknown";
    bySource[key] ??= { jobs: 0, applications: 0, interviews: 0, offers: 0, lastSeenAt: null };
    bySource[key].applications += 1;
    if (a.status === "interview" || a.status === "offer") bySource[key].interviews += 1;
    if (a.status === "offer") bySource[key].offers += 1;
  }

  const resumeLabelById = new Map(resumes.map((r) => [r.id, r.label]));
  const byResume: Record<string, { label: string; used: number; interviews: number }> = {};
  for (const a of applications) {
    if (!a.resume_id) continue;
    byResume[a.resume_id] ??= { label: resumeLabelById.get(a.resume_id) ?? "(deleted variant)", used: 0, interviews: 0 };
    byResume[a.resume_id].used += 1;
    if (a.status === "interview" || a.status === "offer") byResume[a.resume_id].interviews += 1;
  }

  return NextResponse.json({
    totals: {
      candidates: candidatesRes.count ?? 0,
      jobs: jobs.length,
      applications: totalApplications,
      pipelineTickets: pipelineCount,
    },
    statusBreakdown,
    rates: {
      responseRate: rate(respondedCount, totalApplications),
      interviewRate: rate(interviewCount, totalApplications),
      offerRate: rate(offerCount, totalApplications),
    },
    bySource: Object.entries(bySource).map(([source, stats]) => ({
      source,
      ...stats,
      interviewRate: rate(stats.interviews, stats.applications),
      offerRate: rate(stats.offers, stats.applications),
    })),
    byResume: Object.entries(byResume).map(([resumeId, stats]) => ({
      resumeId,
      ...stats,
      interviewRate: rate(stats.interviews, stats.used),
    })),
  });
}
