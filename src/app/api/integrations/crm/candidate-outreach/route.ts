import { NextRequest, NextResponse } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import {
  CRM_RECRUITER_APPLICATION_RECENCY_DAYS,
  CRM_RECRUITER_APPLICATION_STAGES,
  CRM_RECRUITER_BLOCKING_STAGES,
  CRM_RECRUITER_LEGACY_STATUSES,
  crmRecruiterApplicationStage,
} from "@/lib/crmCandidateEligibility";
import { fetchJobPageText, isSafeExternalUrl } from "@/lib/ai/job-agents/fetchJobPage";

function authorized(req: NextRequest) {
  const secret = process.env.CRM_INTEGRATION_SECRET;
  if (!secret) return false;
  const presented =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    req.headers.get("x-crm-integration-secret")?.trim();
  return Boolean(presented && presented === secret);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function textValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function flattenResumeContent(value: unknown, key = "", output: string[] = []): string {
  if (output.join("\n").length >= 12_000) return output.join("\n").slice(0, 12_000);
  const primitive = textValue(value);
  if (primitive) {
    output.push(key ? `${key}: ${primitive}` : primitive);
    return output.join("\n").slice(0, 12_000);
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenResumeContent(item, key, output);
    return output.join("\n").slice(0, 12_000);
  }
  if (!value || typeof value !== "object") return output.join("\n").slice(0, 12_000);
  const ignored = new Set([
    "id",
    "candidate_id",
    "target_job_id",
    "application_id",
    "created_at",
    "updated_at",
    "status",
    "source_type",
  ]);
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (ignored.has(childKey)) continue;
    flattenResumeContent(childValue, childKey.replaceAll("_", " "), output);
  }
  return output.join("\n").slice(0, 12_000);
}

function storedJobDescription(row: Record<string, unknown>): string {
  let rawPayload = row.raw_source_payload;
  if (typeof rawPayload === "string") {
    try {
      rawPayload = JSON.parse(rawPayload);
    } catch {
      rawPayload = null;
    }
  }
  const payloadDescription =
    rawPayload && typeof rawPayload === "object"
      ? (rawPayload as Record<string, unknown>).description
      : null;
  const candidates = [
    textValue(row.description_text),
    textValue(row.notes),
    textValue(payloadDescription),
    stripHtml(textValue(row.description_html)),
  ];
  return candidates.find((value) => value.length >= 200) || candidates.find(Boolean) || "";
}

async function fetchExternalDescription(url: string): Promise<string> {
  if (!isSafeExternalUrl(url)) return "";
  try {
    const result = await Promise.race([
      fetchJobPageText(url),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 18_000)),
    ]);
    return result.trim().slice(0, 12_000);
  } catch (error) {
    console.warn("[CRM candidate outreach] external job description fetch failed", error);
    return "";
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized CRM integration request." }, { status: 401 });
  }

  const url = new URL(req.url);
  const candidateId = url.searchParams.get("candidateId")?.trim() || "";
  const applicationId = url.searchParams.get("applicationId")?.trim() || null;
  if (!isUuid(candidateId) || (applicationId && !isUuid(applicationId))) {
    return NextResponse.json({ error: "Valid candidateId and applicationId are required." }, { status: 400 });
  }

  const canonicalStages = CRM_RECRUITER_APPLICATION_STAGES.map((stage) => `'${stage}'`).join(", ");
  const legacyStatuses = CRM_RECRUITER_LEGACY_STATUSES.map((stage) => `'${stage}'`).join(", ");
  const blockingStages = CRM_RECRUITER_BLOCKING_STAGES.map((stage) => `'${stage}'`).join(", ");
  const canonicalStage = "lower(NULLIF(trim(a.application_stage), ''))";
  const legacyStatus = "lower(NULLIF(trim(a.status), ''))";
  const eligibleApplication = `(
    ${canonicalStage} IN (${canonicalStages})
    OR ((${canonicalStage} IS NULL OR ${canonicalStage} NOT IN (${blockingStages}))
      AND ${legacyStatus} IN (${legacyStatuses}))
  )`;

  const row = await queryOne<Record<string, unknown>>(
    `SELECT
       c.id AS candidate_id, c.name AS candidate_name, c.email AS candidate_email,
       c.phone AS candidate_phone, c.linkedin_url AS candidate_linkedin_url,
       c.target_roles, c.target_industries, c.location_preference, c.work_mode_preference,
       a.id AS application_id, a.job_id, a.status AS raw_application_status,
       a.application_stage, a.applied_at, a.created_at AS application_created_at,
       a.tailored_resume_version_id, a.resume_generation_status,
       COALESCE(NULLIF(j.title, ''), NULLIF(a.adhoc_job_data->>'title', '')) AS job_title,
       COALESCE(NULLIF(j.company, ''), NULLIF(a.adhoc_job_data->>'company', '')) AS job_company,
       COALESCE(NULLIF(j.location, ''), NULLIF(a.adhoc_job_data->>'location', '')) AS job_location,
       j.posted_at AS job_posted_at, j.source_url AS job_source_url, j.apply_url AS job_apply_url,
       j.description_text, j.description_html, j.notes, j.raw_source_payload,
       rv.generated_text AS tailored_resume_text, rv.content AS tailored_resume_content,
       br.content AS base_resume_content
     FROM candidates c
     JOIN applications a ON a.candidate_id = c.id
     LEFT JOIN jobs j ON j.id = a.job_id
     LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     LEFT JOIN base_resumes br ON br.id = a.base_resume_id
     WHERE c.id = $1::uuid
       AND lower(COALESCE(c.status, '')) = 'active'
       AND ${eligibleApplication}
       AND COALESCE(a.applied_at, a.created_at) >= NOW() - INTERVAL '${CRM_RECRUITER_APPLICATION_RECENCY_DAYS} days'
       AND ($2::uuid IS NULL OR a.id = $2::uuid)
     ORDER BY COALESCE(a.applied_at, a.created_at) DESC, a.id DESC
     LIMIT 1`,
    [candidateId, applicationId]
  );
  if (!row) return NextResponse.json({ error: "Eligible candidate application not found." }, { status: 404 });

  const storedDescription = storedJobDescription(row);
  const sourceUrl = textValue(row.job_source_url) || textValue(row.job_apply_url);
  const externalDescription = storedDescription.length < 200 && sourceUrl
    ? await fetchExternalDescription(sourceUrl)
    : "";
  const jobDescription = (externalDescription || storedDescription).slice(0, 12_000);
  const tailoredResume =
    textValue(row.tailored_resume_text) || flattenResumeContent(row.tailored_resume_content) || flattenResumeContent(row.base_resume_content);
  const appBase = (process.env.TALENTOS_APP_URL || "https://talent.skarion.com").replace(/\/+$/, "");
  const jobId = textValue(row.job_id);
  const resumeVersionId = textValue(row.tailored_resume_version_id);

  return NextResponse.json({
    observedAt: new Date().toISOString(),
    candidate: {
      id: textValue(row.candidate_id),
      name: textValue(row.candidate_name),
      email: textValue(row.candidate_email) || null,
      phone: textValue(row.candidate_phone) || null,
      linkedinUrl: textValue(row.candidate_linkedin_url) || null,
      targetRoles: row.target_roles ?? null,
      targetIndustries: row.target_industries ?? null,
      locationPreference: textValue(row.location_preference) || null,
      workModePreference: textValue(row.work_mode_preference) || null,
    },
    application: {
      id: textValue(row.application_id),
      jobId: jobId || null,
      role: textValue(row.job_title) || null,
      company: textValue(row.job_company) || null,
      location: textValue(row.job_location) || null,
      postedAt: textValue(row.job_posted_at) || null,
      appliedAt: textValue(row.applied_at) || textValue(row.application_created_at) || null,
      status: crmRecruiterApplicationStage(row.application_stage, row.raw_application_status),
      sourceUrl: textValue(row.job_source_url) || null,
      applyUrl: textValue(row.job_apply_url) || null,
      jobPageUrl: jobId ? `${appBase}/jobs/${encodeURIComponent(jobId)}` : null,
      tailoredResumeVersionId: resumeVersionId || null,
      tailoredResumeUrl: resumeVersionId
        ? `${appBase}/falood/studio/application/${encodeURIComponent(resumeVersionId)}`
        : null,
      resumeGenerationStatus: textValue(row.resume_generation_status) || null,
    },
    content: {
      tailoredResume,
      jobDescription,
      jobDescriptionSource: externalDescription ? "external_html" : "database",
    },
  });
}
