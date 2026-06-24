// src/app/api/analytics/route.ts
// GET -> non-AI conversion/source/resume metrics, computed in JS over a few
// select() calls (dataset is small enough that a Postgres RPC isn't warranted).

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function GET() {
  let candidatesCount: number;
  let jobs: any[];
  let allTickets: any[];
  let resumes: any[];

  if (isNeon()) {
    const candidatesRes = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM candidates',
      []
    );
    candidatesCount = parseInt(candidatesRes?.count ?? '0', 10);
    jobs = await query('SELECT id, source, last_seen_at FROM jobs', []);
    allTickets = await query('SELECT id, status, job_id, resume_id FROM applications', []);
    resumes = await query('SELECT id, label FROM resumes', []);
  } else {
    const [candidatesRes, jobsRes, applicationsRes, resumesRes] = await Promise.all([
      supabase.from("candidates").select("id", { count: "exact", head: true }),
      supabase.from("jobs").select("id, source, last_seen_at"),
      supabase.from("applications").select("id, status, job_id, resume_id"),
      supabase.from("resumes").select("id, label"),
    ]);

    if (jobsRes.error) return NextResponse.json({ error: jobsRes.error.message }, { status: 500 });
    if (applicationsRes.error) return NextResponse.json({ error: applicationsRes.error.message }, { status: 500 });
    if (resumesRes.error) return NextResponse.json({ error: resumesRes.error.message }, { status: 500 });

    candidatesCount = candidatesRes.count ?? 0;
    jobs = jobsRes.data ?? [];
    allTickets = applicationsRes.data ?? [];
    resumes = resumesRes.data ?? [];
  }

  // Pipeline tickets are work assigned to an application engineer that hasn't been
  // submitted yet — they aren't real applications and must not skew conversion rates.
  const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);
  const applications = allTickets.filter((a: any) => !PIPELINE_STATUSES.has(a.status as string));
  const pipelineCount = allTickets.length - applications.length;

  const totalApplications = applications.length;
  const respondedCount = applications.filter((a: any) => a.status !== "applied").length;
  const interviewCount = applications.filter((a: any) => a.status === "interview" || a.status === "offer").length;
  const offerCount = applications.filter((a: any) => a.status === "offer").length;

  const statusBreakdown: Record<string, number> = {};
  for (const a of allTickets) {
    statusBreakdown[(a as any).status as string] = (statusBreakdown[(a as any).status as string] ?? 0) + 1;
  }

  const jobById = new Map(jobs.map((j: any) => [j.id as string, j]));
  const bySource: Record<string, { jobs: number; applications: number; interviews: number; offers: number; lastSeenAt: string | null }> = {};
  for (const j of jobs) {
    const job = j as any;
    const key = job.source ?? "unknown";
    bySource[key] ??= { jobs: 0, applications: 0, interviews: 0, offers: 0, lastSeenAt: null };
    bySource[key].jobs += 1;
    if (!bySource[key].lastSeenAt || (job.last_seen_at && job.last_seen_at > bySource[key].lastSeenAt!)) {
      bySource[key].lastSeenAt = job.last_seen_at;
    }
  }
  for (const a of applications) {
    const app = a as any;
    const job = jobById.get(app.job_id as string) as any;
    const key = job?.source ?? "unknown";
    bySource[key] ??= { jobs: 0, applications: 0, interviews: 0, offers: 0, lastSeenAt: null };
    bySource[key].applications += 1;
    if (app.status === "interview" || app.status === "offer") bySource[key].interviews += 1;
    if (app.status === "offer") bySource[key].offers += 1;
  }

  const resumeLabelById = new Map(resumes.map((r: any) => [r.id as string, r.label as string]));
  const byResume: Record<string, { label: string; used: number; interviews: number }> = {};
  for (const a of applications) {
    const app = a as any;
    if (!app.resume_id) continue;
    byResume[app.resume_id as string] ??= { label: (resumeLabelById.get(app.resume_id as string) as string | undefined) ?? "(deleted variant)", used: 0, interviews: 0 };
    byResume[app.resume_id as string].used += 1;
    if (app.status === "interview" || app.status === "offer") byResume[app.resume_id as string].interviews += 1;
  }

  return NextResponse.json({
    totals: {
      candidates: candidatesCount,
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
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
