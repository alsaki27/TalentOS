// src/app/api/portal/me/dashboard/route.ts
// Authenticated replacement for the two legacy anonymous-token routes
// (/api/portal/[token]/route.ts and /api/portal/[token]/dashboard/route.ts, which
// stay in place unchanged for now). Same read-only, candidate-safe field shape as
// those — no internal notes, no assignment metadata, no other candidates' data —
// just scoped to the logged-in candidate's session instead of a URL token.

import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { query } from "@/server/db/neon";

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

export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const applications = await query<any>(
    `SELECT a.id, a.status, a.applied_at,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location) as job
     FROM applications a
     LEFT JOIN jobs j ON a.job_id = j.id
     WHERE a.candidate_id = $1
     ORDER BY a.applied_at DESC NULLS LAST`,
    [context.candidateId]
  );

  const submitted = (applications ?? []).filter((a) => !PIPELINE_STATUSES.has(a.status));
  const appIds = submitted.map((a) => a.id as string);

  const comments = appIds.length
    ? await query<any>(
        `SELECT id, application_id, body, created_at FROM application_comments
         WHERE application_id::text = ANY($1) AND visible_to_candidate = true
         ORDER BY created_at DESC`,
        [appIds]
      )
    : [];

  const commentsByApp = new Map<string, any[]>();
  for (const c of comments ?? []) {
    const list = commentsByApp.get(c.application_id) ?? [];
    list.push(c);
    commentsByApp.set(c.application_id, list);
  }

  const respondedCount = submitted.filter((a) => a.status !== "applied").length;
  const interviewCount = submitted.filter((a) => a.status === "interview" || a.status === "offer").length;
  const offerCount = submitted.filter((a) => a.status === "offer").length;

  return NextResponse.json({
    name: context.candidate.name,
    stats: {
      totalApplications: submitted.length,
      interviews: interviewCount,
      offers: offerCount,
      responseRate: rate(respondedCount, submitted.length),
    },
    applications: submitted.map((a) => ({
      id: a.id,
      status: a.status,
      public_status: publicStatus(a.status),
      applied_at: a.applied_at,
      job: a.job,
      updates: commentsByApp.get(a.id) ?? [],
    })),
  });
}
