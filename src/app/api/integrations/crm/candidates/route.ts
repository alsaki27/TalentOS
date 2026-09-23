import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import {
  CRM_RECRUITER_APPLICATION_STAGES,
  CRM_RECRUITER_APPLICATION_RECENCY_DAYS,
  CRM_RECRUITER_BLOCKING_STAGES,
  CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE,
  CRM_RECRUITER_CANDIDATE_STATUS,
  CRM_RECRUITER_LEGACY_STATUSES,
} from "@/lib/crmCandidateEligibility";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function authorized(req: NextRequest) {
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!secret) return false;
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-crm-integration-secret")?.trim();
  return Boolean(presented && presented === secret);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized CRM integration request." }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "100", 10) || 100));
  // This feed is intentionally limited to active candidate accounts. The
  // application-stage qualification below is separate from this candidate
  // lifecycle status and must not be widened by a caller-provided status.
  const status = CRM_RECRUITER_CANDIDATE_STATUS;
  const pipelineStage = CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE;
  const offset = (page - 1) * pageSize;
  const canonicalStages = CRM_RECRUITER_APPLICATION_STAGES.map((stage) => `'${stage}'`).join(", ");
  const legacyStatuses = CRM_RECRUITER_LEGACY_STATUSES
    .map((stage) => `'${stage}'`)
    .join(", ");
  const blockingStages = CRM_RECRUITER_BLOCKING_STAGES
    .map((stage) => `'${stage}'`)
    .join(", ");
  const canonicalStage = "lower(NULLIF(trim(a.application_stage), ''))";
  const legacyStatus = "lower(NULLIF(trim(a.status), ''))";
  const eligibleApplication = `(
    ${canonicalStage} IN (${canonicalStages})
    OR (
      (${canonicalStage} IS NULL OR ${canonicalStage} NOT IN (${blockingStages}))
      AND ${legacyStatus} IN (${legacyStatuses})
    )
  )`;
  // Some migrated application rows recorded the submission timestamp in
  // ae_applied_at while applied_at remained null. Keep the recency rule the
  // same, but use the complete application timestamp contract.
  const applicationLoggedAt = "COALESCE(a.applied_at, a.ae_applied_at, a.created_at)";
  const recentApplication = `${applicationLoggedAt} >= NOW() - INTERVAL '${CRM_RECRUITER_APPLICATION_RECENCY_DAYS} days'`;

  const totalRow = await queryOne<{ total: number }>(
    `SELECT COUNT(DISTINCT c.id)::int AS total
     FROM candidates c
     WHERE lower(COALESCE(c.status, '')) = $1
       AND lower(COALESCE(c.pipeline_stage, '')) = $2
       AND EXISTS (
         SELECT 1
         FROM applications a
         WHERE a.candidate_id = c.id
           AND ${eligibleApplication}
           AND ${recentApplication}
       )`,
    [status, pipelineStage]
  );
  const data = await query(
    `SELECT
       c.id,
       c.candidate_number,
       c.name,
       c.email,
       c.phone,
       c.linkedin_url,
       c.status,
       c.pipeline_stage,
       c.target_roles,
       c.target_industries,
       c.preferred_locations,
       c.location_preference,
       c.work_mode_preference,
       c.available_start_date,
       COALESCE(
         jsonb_agg(
           jsonb_build_object(
             'id', a.id,
             'job_id', a.job_id,
             'job_title', COALESCE(NULLIF(j.title, ''), NULLIF(a.adhoc_job_data->>'title', '')),
             'job_company', COALESCE(NULLIF(j.company, ''), NULLIF(a.adhoc_job_data->>'company', '')),
             'job_location', COALESCE(NULLIF(j.location, ''), NULLIF(a.adhoc_job_data->>'location', '')),
             'job_posted_at', j.posted_at,
             'application_status', CASE
               WHEN ${canonicalStage} IN (${canonicalStages}) THEN ${canonicalStage}
               WHEN ${legacyStatus} = 'replied' THEN 'screening'
               ELSE ${legacyStatus}
             END,
             'raw_status', a.status,
             'application_stage', a.application_stage,
             'applied_at', a.applied_at,
             'ae_applied_at', a.ae_applied_at,
             'application_created_at', a.created_at
             , 'tailored_resume_version_id', a.tailored_resume_version_id
             , 'resume_generation_status', a.resume_generation_status
             , 'job_source_url', j.source_url
             , 'job_apply_url', j.apply_url
           )
           ORDER BY ${applicationLoggedAt} DESC, a.id DESC
         ) FILTER (WHERE a.id IS NOT NULL),
         '[]'::jsonb
       ) AS applications
     FROM candidates c
     JOIN applications a ON a.candidate_id = c.id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE lower(COALESCE(c.status, '')) = $1
       AND lower(COALESCE(c.pipeline_stage, '')) = $2
       AND ${eligibleApplication}
       AND ${recentApplication}
     GROUP BY
       c.id,
       c.candidate_number,
       c.name,
       c.email,
       c.phone,
       c.linkedin_url,
       c.status,
       c.pipeline_stage,
       c.target_roles,
       c.target_industries,
       c.preferred_locations,
       c.location_preference,
       c.work_mode_preference,
       c.available_start_date
     ORDER BY c.name ASC, c.id ASC
     OFFSET $3 LIMIT $4`,
    [status, pipelineStage, offset, pageSize]
  );
  return NextResponse.json(
    {
      data: data ?? [],
      total: totalRow?.total ?? 0,
      page,
      pageSize,
      status,
      pipelineStage,
      applicationRecencyDays: CRM_RECRUITER_APPLICATION_RECENCY_DAYS,
      applicationStages: CRM_RECRUITER_APPLICATION_STAGES,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
