// src/lib/portalDashboard.ts
// Shared candidate-portal dashboard query, used by both the legacy anonymous
// token route (/api/portal/[token]) and the authenticated one
// (/api/portal/me/dashboard) — same read-only, candidate-safe shape either way,
// just factored out so the logic isn't duplicated (and double-bundled) across
// both routes.

import { query } from "@/server/db/neon";

const PIPELINE_STATUSES = new Set(["assigned", "stacked", "in_progress"]);

// Mirrors STATUS_LABELS in src/components/candidates/shared/StatusBadge.tsx
// exactly — the canonical internal label set — so a candidate never sees
// different wording for the same underlying status than staff do. Keep
// these two in sync if either changes. (assigned/stacked/in_progress never
// reach here — see PIPELINE_STATUSES below, filtered out before a candidate
// applies at all, since those are internal pre-submission work states.)
export function publicStatus(status: string) {
  if (status === "interview") return { stage: "interview", label: "Interview" };
  if (status === "offer") return { stage: "offer", label: "Offer" };
  if (status === "rejected" || status === "withdrawn") return { stage: "closed", label: "Rejected" };
  if (status === "replied") return { stage: "waiting", label: "Screening" };
  return { stage: "submitted", label: "Applied" };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function buildCandidatePortalDashboard(candidateId: string, candidateName: string) {
  const applications = await query<any>(
    `SELECT a.id, a.status, a.applied_at,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location,
          'source_url', COALESCE(j.apply_url, j.source_url)) as job,
        CASE WHEN a.source_type = 'custom_interview' THEN array_remove(ARRAY[
          CASE WHEN NULLIF(BTRIM(j.location), '') IS NULL THEN 'Location' END,
          CASE WHEN a.applied_at IS NULL THEN 'Applied date' END,
          CASE WHEN a.resume_id IS NULL AND NULLIF(a.resume_url, '') IS NULL THEN 'Resume' END,
          CASE WHEN NULLIF(COALESCE(j.apply_url, j.source_url), '') IS NULL THEN 'Job link' END
        ]::text[], NULL) ELSE '{}'::text[] END AS missing_info,
        CASE WHEN a.source_type = 'custom_interview' THEN (a.resume_id IS NOT NULL OR NULLIF(a.resume_url, '') IS NOT NULL) ELSE NULL END AS application_resume_provided
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
      missing_info: Array.isArray(a.missing_info) ? a.missing_info : [],
      application_resume_provided: a.application_resume_provided,
      updates: commentsByApp.get(a.id) ?? [],
    })),
  };
}
