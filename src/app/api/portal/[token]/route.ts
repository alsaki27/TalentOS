// src/app/api/portal/[token]/route.ts
// GET -> read-only candidate portal data, looked up by magic-link token (no login).

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { requireCandidateByToken } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);

function publicStatus(status: string) {
  if (status === "interview") return { stage: "interview", label: "Interview stage" };
  if (status === "offer") return { stage: "offer", label: "Offer received" };
  if (status === "rejected" || status === "withdrawn") return { stage: "closed", label: "Closed" };
  if (status === "replied") return { stage: "waiting", label: "Employer responded" };
  return { stage: "submitted", label: "Submitted" };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const { candidate, response } = await requireCandidateByToken(params.token);
  if (response) return response;

  const applications = await query(
    `SELECT a.id, a.status, a.applied_at, jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location) as jobs FROM applications a LEFT JOIN jobs j ON a.job_id = j.id WHERE a.candidate_id = $1 ORDER BY a.applied_at DESC`,
    [candidate.id]
  );

  const submitted = (applications ?? []).filter((a: any) => !PIPELINE_STATUSES.has(a.status as string));
  const appIds = submitted.map((a: any) => a.id as string);

  let comments: any[] = [];
  let events: any[] = [];
  let interviews: any[] = [];
  let resumeVersions: any[] = [];
  let appsPerDay: { d: string; count: number }[] = [];

  if (appIds.length > 0) {
    comments = await query(
      `SELECT id, application_id, body, parent_comment_id, created_at FROM application_comments WHERE application_id::text = ANY($1) AND visible_to_candidate = true ORDER BY created_at DESC`,
      [appIds]
    );

    events = await query(
      `SELECT application_id, from_status, to_status, note, created_at FROM application_events WHERE application_id::text = ANY($1) ORDER BY created_at ASC`,
      [appIds]
    );

    interviews = await query(
      `SELECT id, application_id, round_number, round_name, scheduled_at, status, location, meeting_link FROM interview_schedules WHERE application_id::text = ANY($1) AND scheduled_at >= now() - interval '30 days' ORDER BY scheduled_at ASC`,
      [appIds]
    );

    resumeVersions = await query(
      `SELECT p.application_id, rv.id AS resume_version_id
       FROM application_packets p
       JOIN application_resume_versions rv ON p.final_resume_version_id = rv.id
       WHERE p.application_id::text = ANY($1)`,
      [appIds]
    );
  }

  appsPerDay = await query<{ d: string; count: number }>(
    `SELECT date(applied_at)::text AS d, count(*)::int AS count FROM applications WHERE candidate_id = $1 AND date(applied_at) >= now() - interval '90 days' GROUP BY date(applied_at) ORDER BY d`,
    [candidate.id]
  );

  const commentsByApp = new Map<string, { id: string; body: string; created_at: string }[]>();
  for (const c of comments ?? []) {
    const list = commentsByApp.get(c.application_id) ?? [];
    list.push(c);
    commentsByApp.set(c.application_id, list);
  }

  const eventsByApp = new Map<string, any[]>();
  for (const e of events ?? []) {
    const list = eventsByApp.get(e.application_id) ?? [];
    list.push(e);
    eventsByApp.set(e.application_id, list);
  }

  const interviewsByApp = new Map<string, any[]>();
  for (const i of interviews ?? []) {
    const list = interviewsByApp.get(i.application_id) ?? [];
    list.push(i);
    interviewsByApp.set(i.application_id, list);
  }

  const resumeByApp = new Map<string, string>();
  for (const rv of resumeVersions ?? []) {
    if (!resumeByApp.has(rv.application_id)) {
      resumeByApp.set(rv.application_id, rv.resume_version_id);
    }
  }

  const respondedCount = submitted.filter((a: any) => a.status !== "applied").length;
  const interviewCount = submitted.filter((a: any) => a.status === "interview" || a.status === "offer").length;
  const offerCount = submitted.filter((a: any) => a.status === "offer").length;

  return NextResponse.json({
    name: candidate.name,
    stats: {
      totalApplications: submitted.length,
      interviews: interviewCount,
      offers: offerCount,
      responseRate: rate(respondedCount, submitted.length),
    },
    appsPerDay,
    applications: submitted.map((a: any) => ({
      id: a.id,
      status: a.status,
      public_status: publicStatus(a.status),
      applied_at: a.applied_at,
      job: a.jobs,
      updates: commentsByApp.get(a.id) ?? [],
      timeline: (eventsByApp.get(a.id) ?? []).map((e: any) => ({
        fromStatus: e.from_status,
        toStatus: e.to_status,
        note: e.note,
        createdAt: e.created_at,
      })),
      interviews: interviewsByApp.get(a.id) ?? [],
      resumeVersionId: resumeByApp.get(a.id) ?? null,
    })),
  });
}
