// src/lib/portalDashboard.ts
// Shared candidate-portal dashboard query, used by both the legacy anonymous
// token route (/api/portal/[token]) and the authenticated one
// (/api/portal/me/dashboard) — same read-only, candidate-safe shape either way,
// just factored out so the logic isn't duplicated (and double-bundled) across
// both routes.

import { query } from "@/server/db/neon";

const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);

export function publicStatus(status: string) {
  if (status === "interview") return { stage: "interview", label: "Interview stage" };
  if (status === "offer") return { stage: "offer", label: "Offer received" };
  if (status === "rejected" || status === "withdrawn") return { stage: "closed", label: "Closed" };
  if (status === "replied") return { stage: "waiting", label: "Employer responded" };
  return { stage: "submitted", label: "Submitted" };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function buildCandidatePortalDashboard(candidateId: string, candidateName: string) {
  const applications = await query<any>(
    `SELECT a.id, a.status, a.applied_at,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location) as job
     FROM applications a
     LEFT JOIN jobs j ON a.job_id = j.id
     WHERE a.candidate_id = $1
     ORDER BY a.applied_at DESC NULLS LAST`,
    [candidateId]
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

  return {
    name: candidateName,
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
  };
}
