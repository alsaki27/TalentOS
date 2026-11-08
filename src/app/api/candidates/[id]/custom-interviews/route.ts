import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, getCurrentUserContext } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { uploadResumeFile, deleteResumeFile } from "@/lib/resumeStorage";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const MAX_RESUME_BYTES = 15 * 1024 * 1024;
const ALLOWED_RESUME_EXTENSIONS = new Set(["pdf", "doc", "docx"]);

function parseOptionalDate(value: FormDataEntryValue | null): string | null | undefined {
  if (value == null || String(value).trim() === "") return null;
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  return date;
}

function parseOptionalHttpUrl(value: FormDataEntryValue | null): string | null | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

async function requireStaff() {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (!ALL_USER_ROLES.includes(currentUser.profile.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { currentUser };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  try {
    const candidate = await queryOne<{ id: string }>("SELECT id FROM candidates WHERE id = $1", [params.id]);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    const interviews = await query<Record<string, any>>(
      `SELECT
         a.id AS application_id,
         a.candidate_id,
         c.name AS candidate_name,
         'interview'::text AS status,
         a.applied_at,
         a.follow_up_at,
         a.job_id,
         j.title AS job_title,
         COALESCE(j.company, '') AS company_name,
         j.company_website,
         j.source AS job_source,
         COALESCE(j.apply_url, j.source_url) AS source_url,
         j.location,
         a.source_type,
         a.resume_id,
         a.resume_filename AS application_resume_filename,
         a.resume_url AS application_resume_url,
         a.application_stage,
         a.application_stage_changed_at,
         tj.fit_score,
         tj.recommendation,
         a.tailored_resume_version_id,
         iv.scheduled_at AS interview_scheduled_at,
         iv.time_zone AS interview_time_zone,
         iv.interview_format,
         stages.interview_stages,
         c.timezone AS candidate_timezone
       FROM applications a
       JOIN candidates c ON c.id = a.candidate_id
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN target_jobs tj ON tj.job_id = j.id AND tj.candidate_id = a.candidate_id
       LEFT JOIN LATERAL (
         SELECT s.scheduled_at, s.time_zone, s.interview_format
         FROM interview_schedules s
         WHERE s.application_id = a.id AND COALESCE(s.status, 'scheduled') <> 'cancelled'
         ORDER BY s.created_at DESC LIMIT 1
       ) iv ON true
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
           'round_number', s.round_number,
           'scheduled_at', s.scheduled_at,
           'time_zone', s.time_zone,
           'interview_format', s.interview_format,
           'status', COALESCE(s.status, 'scheduled'),
           'notes', s.notes,
           'rescheduled_at', s.rescheduled_at
         ) ORDER BY s.round_number) AS interview_stages
         FROM interview_schedules s
         WHERE s.application_id = a.id AND COALESCE(s.status, 'scheduled') <> 'cancelled'
       ) stages ON true
       WHERE a.candidate_id = $1
         AND COALESCE(NULLIF(BTRIM(a.application_stage), ''), CASE WHEN a.status = 'replied' THEN 'screening' ELSE a.status END) = 'interview'
       ORDER BY COALESCE(a.application_stage_changed_at, a.updated_at, a.created_at) DESC, a.id DESC`,
      [params.id]
    );

    return NextResponse.json({ interviews });
  } catch (error: any) {
    console.error("[Custom Interview Hub] Could not load candidate interviews:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to load interviews" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  let uploadedUrl: string | null = null;
  try {
    const form = await req.formData();
    const title = String(form.get("jobTitle") ?? "").trim();
    const company = String(form.get("companyName") ?? "").trim();
    const location = String(form.get("location") ?? "").trim() || null;
    const appliedAt = parseOptionalDate(form.get("appliedAt"));
    const jobUrl = parseOptionalHttpUrl(form.get("jobUrl"));
    const resumeValue = form.get("resume");
    const resume = resumeValue instanceof File && resumeValue.size > 0 ? resumeValue : null;

    if (!title || !company) return NextResponse.json({ error: "Job title and company name are required." }, { status: 400 });
    if (appliedAt === undefined) return NextResponse.json({ error: "Applied date must be a valid date." }, { status: 400 });
    if (jobUrl === undefined) return NextResponse.json({ error: "Job link must be an http or https URL." }, { status: 400 });
    if (resume) {
      const extension = resume.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_RESUME_EXTENSIONS.has(extension)) {
        return NextResponse.json({ error: "Resume must be a PDF, DOC, or DOCX file." }, { status: 400 });
      }
      if (resume.size > MAX_RESUME_BYTES) {
        return NextResponse.json({ error: "Resume file must be 15 MB or smaller." }, { status: 400 });
      }
    }

    const candidate = await queryOne<{ id: string }>("SELECT id FROM candidates WHERE id = $1", [params.id]);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    let fileBytes: Uint8Array | null = null;
    let contentType = "application/octet-stream";
    let fileName = "";
    if (resume) {
      fileBytes = new Uint8Array(await resume.arrayBuffer());
      contentType = resume.type || "application/octet-stream";
      fileName = resume.name;
      const extension = fileName.split(".").pop()?.toLowerCase() ?? "pdf";
      const storagePath = `candidates/${params.id}/custom-interviews/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      let uploaded: Awaited<ReturnType<typeof uploadResumeFile>>;
      try {
        uploaded = await uploadResumeFile(storagePath, fileBytes, contentType);
      } catch (error: any) {
        console.error("[Custom Interview Hub] Resume upload failed:", error?.message ?? error);
        return NextResponse.json(
          { error: "Resume upload failed. Check the configured storage provider and retry; the interview was not saved." },
          { status: 503 }
        );
      }
      uploadedUrl = uploaded.url;
    }

    const actor = auth.currentUser.profile;
    const actorName = actor.display_name || actor.email || "TalentOS staff";
    const resumeLabel = `Interview resume · ${company} · ${title}`;
    // The application is at the interview stage, but this manually logged record
    // is already past the AE work queue. ae_stage only accepts its four workflow values.
    // Read the job from RETURNING: the jobs table scan cannot see this statement's insert.
    const application = await queryOne<Record<string, any>>(
      `WITH created_job AS (
         INSERT INTO jobs (title, company, location, source, source_url, is_active)
         VALUES ($1, $2, $3, 'custom_interview', $4, false)
         RETURNING id, title, company, location, source_url
       ), created_resume AS (
         INSERT INTO resumes (candidate_id, label, kind, file_url, filename, is_original_upload)
         SELECT $5, $6, 'resume', $7, $8, false WHERE $9::boolean
         RETURNING id
       ), created_application AS (
         INSERT INTO applications (
           candidate_id, job_id, status, application_stage, application_stage_changed_at,
           application_stage_changed_by_user_id, application_stage_changed_by_name,
           ae_stage, ae_stage_updated_at, ae_stage_updated_by_user_id, ae_stage_updated_by_name,
           source_type, applied_at, resume_id, resume_url, resume_filename
         )
         SELECT $5, j.id, 'interview', 'interview', now(), $10, $11,
                'applied', now(), $10, $11,
                'custom_interview', $12::date::timestamptz,
                (SELECT id FROM created_resume), $7, NULLIF($8, '')
         FROM created_job j
         RETURNING id, candidate_id, job_id, status, application_stage, applied_at, resume_id, resume_filename
       ), stage_history AS (
         INSERT INTO application_stage_history
           (application_id, from_stage, to_stage, changed_by_user_id, changed_by_name, reason, source)
         SELECT id, NULL, 'interview', $10, $11, 'Custom interview manually added', 'manual'
         FROM created_application
         RETURNING id
       ), app_event AS (
         INSERT INTO application_events (application_id, from_status, to_status, note)
         SELECT id, NULL, 'interview', 'Interview added by the TalentOS team.' FROM created_application
         RETURNING id
       ), audit AS (
         INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
         SELECT $10, $13, 'custom_interview.created', 'application', id,
                jsonb_build_object('candidate_id', candidate_id, 'job_id', job_id, 'source_type', 'custom_interview')
         FROM created_application
         RETURNING id
       )
       SELECT a.*, j.title AS job_title, j.company AS company_name, j.location, j.source_url
       FROM created_application a JOIN created_job j ON j.id = a.job_id`,
      [title, company, location, jobUrl, params.id, resumeLabel, uploadedUrl, fileName, Boolean(resume), actor.user_id, actorName, appliedAt, actor.email]
    );

    if (!application) throw new Error("Custom interview insert returned no application.");
    uploadedUrl = null; // The saved application now owns the file.

    await logActivity({
      userId: actor.user_id,
      actorName,
      type: "create",
      description: `Added a custom interview for ${company} · ${title}`,
      entityType: "application",
      entityId: application.id,
      entityName: `${company} · ${title}`,
      metadata: { candidate_id: params.id, source_type: "custom_interview" },
    }).catch((error) => console.error("[Custom Interview Hub] Activity log failed:", error));

    return NextResponse.json({ interview: application }, { status: 201 });
  } catch (error: any) {
    if (uploadedUrl) await deleteResumeFile(uploadedUrl).catch(() => undefined);
    console.error("[Custom Interview Hub] Could not create interview:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to create interview" }, { status: 500 });
  }
}
