import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import {
  CRM_RECRUITER_APPLICATION_RECENCY_DAYS,
  CRM_RECRUITER_APPLICATION_STAGES,
  CRM_RECRUITER_BLOCKING_STAGES,
  CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE,
  CRM_RECRUITER_CANDIDATE_STATUS,
  CRM_RECRUITER_LEGACY_STATUSES,
} from "@/lib/crmCandidateEligibility";

function authorized(req: NextRequest) {
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!secret) return false;
  const presented = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim()
    || req.headers.get("x-crm-integration-secret")?.trim();
  return Boolean(presented && presented === secret);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized CRM integration request." }, { status: 401 });
  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "100", 10) || 100));
  const offset = (page - 1) * pageSize;
  const activeOnly = url.searchParams.get("activeOnly") === "true";

  if (activeOnly) {
    // Companies with at least one candidate application currently in the
    // CRM recruiter workflow's actionable stages (applied/screening/
    // interview/offer - see crmCandidateEligibility.ts, the same source of
    // truth GET /candidate-outreach uses, so the two endpoints can never
    // silently drift apart on what "actionable" means).
    //
    // jobs.company is a free-text field with no foreign key to the
    // `companies` directory table (confirmed: only a plain btree index,
    // sql/01_schema.sql:78) - the two have never been reliably joinable.
    // Returning the name straight from the application/job record and
    // letting the CRM's own company-name matching (already proven via its
    // LinkedIn-capture path) resolve/create the company row avoids adding a
    // second, fragile name-matching layer on top of an already-lossy one.
    const canonicalStage = "lower(nullif(trim(a.application_stage), ''))";
    const legacyStatus = "lower(nullif(trim(a.status), ''))";
    const applicationLoggedAt = "coalesce(a.applied_at, a.ae_applied_at, a.created_at)";
    const canonicalStages = CRM_RECRUITER_APPLICATION_STAGES.map((s) => `'${s}'`).join(", ");
    const legacyStatuses = CRM_RECRUITER_LEGACY_STATUSES.map((s) => `'${s}'`).join(", ");
    const blockingStages = CRM_RECRUITER_BLOCKING_STAGES.map((s) => `'${s}'`).join(", ");
    const eligibleApplication = `(
      ${canonicalStage} IN (${canonicalStages})
      OR ((${canonicalStage} IS NULL OR ${canonicalStage} NOT IN (${blockingStages}))
        AND ${legacyStatus} IN (${legacyStatuses}))
    )`;

    const totalRow = await queryOne<{ total: number }>(
      `SELECT COUNT(DISTINCT j.company)::int AS total
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
        WHERE j.company IS NOT NULL AND btrim(j.company) <> ''
          AND c.status = $1 AND c.pipeline_stage = $2
          AND ${eligibleApplication}
          AND ${applicationLoggedAt} >= now() - ($3 || ' days')::interval`,
      [CRM_RECRUITER_CANDIDATE_STATUS, CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE, String(CRM_RECRUITER_APPLICATION_RECENCY_DAYS)]
    );
    const data = await query(
      `SELECT j.company AS name,
              COUNT(DISTINCT a.id)::int AS active_application_count,
              MAX(${applicationLoggedAt}) AS most_recent_applied_at
         FROM applications a
         JOIN candidates c ON c.id = a.candidate_id
         JOIN jobs j ON j.id = a.job_id
        WHERE j.company IS NOT NULL AND btrim(j.company) <> ''
          AND c.status = $1 AND c.pipeline_stage = $2
          AND ${eligibleApplication}
          AND ${applicationLoggedAt} >= now() - ($3 || ' days')::interval
        GROUP BY j.company
        ORDER BY most_recent_applied_at DESC
        OFFSET $4 LIMIT $5`,
      [CRM_RECRUITER_CANDIDATE_STATUS, CRM_RECRUITER_CANDIDATE_PIPELINE_STAGE, String(CRM_RECRUITER_APPLICATION_RECENCY_DAYS), offset, pageSize]
    );
    return NextResponse.json({ data: data ?? [], total: totalRow?.total ?? 0, page, pageSize });
  }

  const totalRow = await queryOne<{ total: number }>("SELECT COUNT(*)::int AS total FROM companies", []);
  const data = await query(
    `SELECT id, name, website, linkedin_url, logo_url, employees_count, slogan, source, last_seen_at, created_at
     FROM companies ORDER BY last_seen_at DESC NULLS LAST, updated_at DESC OFFSET $1 LIMIT $2`,
    [offset, pageSize]
  );
  return NextResponse.json({ data: data ?? [], total: totalRow?.total ?? 0, page, pageSize });
}
