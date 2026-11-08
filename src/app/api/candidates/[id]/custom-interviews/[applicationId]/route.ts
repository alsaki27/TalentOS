import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, getCurrentUserContext } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { uploadResumeFile, deleteResumeFile } from "@/lib/resumeStorage";
import { queryOne, sql } from "@/server/db/neon";

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

export async function PATCH(req: NextRequest, { params }: { params: { id: string; applicationId: string } }) {
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
    const clearResume = String(form.get("clearResume") ?? "") === "true";
    const resumeValue = form.get("resume");
    const resume = resumeValue instanceof File && resumeValue.size > 0 ? resumeValue : null;

    if (!title || !company) return NextResponse.json({ error: "Job title and company name are required." }, { status: 400 });
    if (appliedAt === undefined) return NextResponse.json({ error: "Applied date must be a valid date." }, { status: 400 });
    if (jobUrl === undefined) return NextResponse.json({ error: "Job link must be an http or https URL." }, { status: 400 });
    if (clearResume && resume) return NextResponse.json({ error: "Choose a new resume or remove the current one, not both." }, { status: 400 });
    if (resume) {
      const extension = resume.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_RESUME_EXTENSIONS.has(extension)) {
        return NextResponse.json({ error: "Resume must be a PDF, DOC, or DOCX file." }, { status: 400 });
      }
      if (resume.size > MAX_RESUME_BYTES) {
        return NextResponse.json({ error: "Resume file must be 15 MB or smaller." }, { status: 400 });
      }
    }

    const current = await queryOne<{ id: string; job_id: string }>(
      `SELECT a.id, a.job_id FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.id = $1 AND a.candidate_id = $2 AND a.source_type = 'custom_interview' AND j.source = 'custom_interview'`,
      [params.applicationId, params.id]
    );
    if (!current) return NextResponse.json({ error: "Custom interview not found" }, { status: 404 });

    let fileName = "";
    if (resume) {
      fileName = resume.name;
      const extension = fileName.split(".").pop()?.toLowerCase() ?? "pdf";
      const storagePath = `candidates/${params.id}/custom-interviews/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
      let uploaded: Awaited<ReturnType<typeof uploadResumeFile>>;
      try {
        uploaded = await uploadResumeFile(storagePath, new Uint8Array(await resume.arrayBuffer()), resume.type || "application/octet-stream");
      } catch (error: any) {
        console.error("[Custom Interview Hub] Resume upload failed:", error?.message ?? error);
        return NextResponse.json(
          { error: "Resume upload failed. Check the configured storage provider and retry; the interview was left unchanged." },
          { status: 503 }
        );
      }
      uploadedUrl = uploaded.url;
    }

    const actor = auth.currentUser.profile;
    const actorName = actor.display_name || actor.email || "TalentOS staff";
    const resumeLabel = `Interview resume · ${company} · ${title}`;
    const result = await queryOne<Record<string, any>>(
      `WITH locked_application AS (
         SELECT id, job_id FROM applications
         WHERE id = $13 AND candidate_id = $6 AND job_id = $5 AND source_type = 'custom_interview'
         FOR UPDATE
       ), updated_job AS (
         UPDATE jobs j SET title = $1, company = $2, location = $3, source_url = $4
         FROM locked_application a
         WHERE j.id = a.job_id AND j.source = 'custom_interview'
         RETURNING j.id, j.title, j.company, j.location, j.source_url
       ), created_resume AS (
         INSERT INTO resumes (candidate_id, label, kind, file_url, filename, is_original_upload)
         SELECT $6, $7, 'resume', $8, $9, false FROM updated_job WHERE $10::boolean
         RETURNING id
       ), updated_application AS (
         UPDATE applications a
         SET applied_at = $11::date::timestamptz,
             resume_id = CASE WHEN $12::boolean THEN NULL WHEN $10::boolean THEN (SELECT id FROM created_resume) ELSE a.resume_id END,
             resume_url = CASE WHEN $12::boolean THEN NULL WHEN $10::boolean THEN $8 ELSE a.resume_url END,
             resume_filename = CASE WHEN $12::boolean THEN NULL WHEN $10::boolean THEN NULLIF($9, '') ELSE a.resume_filename END,
             updated_at = now()
         WHERE a.id = $13 AND a.candidate_id = $6 AND a.source_type = 'custom_interview'
           AND a.job_id IN (SELECT id FROM updated_job)
         RETURNING a.id, a.candidate_id, a.job_id, a.status, a.application_stage, a.applied_at, a.resume_id, a.resume_filename
       ), audit AS (
         INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, entity_id, metadata)
         SELECT $14, $15, 'custom_interview.updated', 'application', id,
                jsonb_build_object('candidate_id', candidate_id, 'job_id', job_id, 'source_type', 'custom_interview')
         FROM updated_application RETURNING id
       )
       SELECT a.*, j.title AS job_title, j.company AS company_name, j.location, j.source_url
       FROM updated_application a JOIN updated_job j ON j.id = a.job_id`,
      [title, company, location, jobUrl, current.job_id, params.id, resumeLabel, uploadedUrl, fileName, Boolean(resume), appliedAt, clearResume, params.applicationId, actor.user_id, actor.email]
    );

    if (!result) {
      if (uploadedUrl) await deleteResumeFile(uploadedUrl).catch(() => undefined);
      return NextResponse.json({ error: "Custom interview could not be updated." }, { status: 409 });
    }
    uploadedUrl = null; // The saved application now owns the file.

    await logActivity({
      userId: actor.user_id,
      actorName,
      type: "update",
      description: `Updated a custom interview for ${company} · ${title}`,
      entityType: "application",
      entityId: params.applicationId,
      entityName: `${company} · ${title}`,
      metadata: { candidate_id: params.id, source_type: "custom_interview" },
    }).catch((error) => console.error("[Custom Interview Hub] Activity log failed:", error));

    return NextResponse.json({ interview: result });
  } catch (error: any) {
    if (uploadedUrl) await deleteResumeFile(uploadedUrl).catch(() => undefined);
    console.error("[Custom Interview Hub] Could not update interview:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to update custom interview" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; applicationId: string } }) {
  const auth = await requireStaff();
  if (auth.error) return auth.error;

  const current = await queryOne<{ id: string; job_id: string; title: string; company: string | null }>(
    `SELECT a.id, a.job_id, j.title, j.company
     FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1 AND a.candidate_id = $2 AND a.source_type = 'custom_interview' AND j.source = 'custom_interview'`,
    [params.applicationId, params.id]
  );
  if (!current) return NextResponse.json({ error: "Custom interview not found" }, { status: 404 });

  try {
    const tx = sql();
    const [deletedRows] = await tx.transaction((db) => [
      db.query(`DELETE FROM applications WHERE id = $1 AND candidate_id = $2 AND source_type = 'custom_interview' RETURNING id`, [params.applicationId, params.id]),
      db.query(`DELETE FROM target_jobs WHERE candidate_id = $1 AND job_id = $2`, [params.id, current.job_id]),
      db.query(`DELETE FROM jobs WHERE id = $1 AND source = 'custom_interview' AND NOT EXISTS (SELECT 1 FROM applications WHERE job_id = $1)`, [current.job_id]),
    ]);

    if (!deletedRows?.length) return NextResponse.json({ error: "Custom interview not found" }, { status: 404 });

    const actor = auth.currentUser.profile;
    await logActivity({
      userId: actor.user_id,
      actorName: actor.display_name || actor.email || "TalentOS staff",
      type: "delete",
      description: `Removed a custom interview for ${current.company || "the candidate"} · ${current.title}`,
      entityType: "application",
      entityId: params.applicationId,
      entityName: `${current.company || "Unknown company"} · ${current.title}`,
      metadata: { candidate_id: params.id, source_type: "custom_interview", job_id: current.job_id },
    }).catch((error) => console.error("[Custom Interview Hub] Activity log failed:", error));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Custom Interview Hub] Could not remove interview:", error?.message ?? error);
    return NextResponse.json({ error: "Failed to remove custom interview" }, { status: 500 });
  }
}
