// src/app/api/applications/exports/route.ts
// POST -> record a client-generated resume export (PDF/DOCX) in R2 + the
// application_resume_exports table. The file is already rendered by the time it
// reaches here - this route is a thin upload+record step, not a generator, since
// @react-pdf/renderer and docx render entirely in the browser (see clientExport.tsx).

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { archiveResumeToSharePoint } from "@/server/services/resumeSharePointArchiveService";

const EXPORT_TYPES = new Set(["pdf", "docx"]);

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const applicationId = formData.get("applicationId") as string | null;
  const resumeVersionId = formData.get("resumeVersionId") as string | null;
  const exportType = formData.get("exportType") as string | null;
  const archiveLabel = formData.get("archiveLabel") as string | null;

  if (!file || !applicationId || !resumeVersionId || !exportType) {
    return NextResponse.json(
      { error: "file, applicationId, resumeVersionId, and exportType are required" },
      { status: 400 }
    );
  }
  if (!EXPORT_TYPES.has(exportType)) {
    return NextResponse.json({ error: "exportType must be pdf or docx" }, { status: 400 });
  }

  // Confirm the application exists and is actually linked to this resume version -
  // prevents recording an export under an application the caller doesn't own/manage
  // the data for, even though they're already role-gated above.
  const linked = await queryOne<{ id: string; candidate_id: string; job_id: string | null; candidate_name: string; company_name: string; job_title: string }>(
    `SELECT a.id, a.candidate_id, a.job_id, c.name AS candidate_name, COALESCE(j.company, 'Unknown Company') AS company_name,
            COALESCE(j.title, 'Job Application') AS job_title
     FROM applications a
     JOIN application_resume_versions arv ON arv.id = $2
     JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1
       AND (
         arv.application_id = a.id
         OR EXISTS (
           SELECT 1
           FROM application_packets p
           WHERE p.application_id = a.id
             AND p.final_resume_version_id = arv.id
         )
         OR (
           arv.candidate_id = a.candidate_id
           AND EXISTS (
             SELECT 1 FROM target_jobs tj
             WHERE tj.id = arv.target_job_id AND tj.job_id = a.job_id
           )
         )
       )`,
    [applicationId, resumeVersionId]
  );
  if (!linked) {
    return NextResponse.json(
      { error: "applicationId/resumeVersionId do not match an existing application" },
      { status: 404 }
    );
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const result = await archiveResumeToSharePoint({
    applicationId,
    resumeVersionId,
    exportType: exportType as "pdf" | "docx",
    candidateId: linked.candidate_id,
    candidateName: linked.candidate_name,
    companyName: linked.company_name,
    jobTitle: linked.job_title,
    jobId: linked.job_id,
    buffer,
    createdByUserId: context?.profile.user_id ?? null,
    variantLabel: archiveLabel,
  });

  if (!result.ok) {
    return NextResponse.json({ error: `Upload failed: ${result.error}` }, { status: 500 });
  }
  return NextResponse.json({ id: result.id, url: result.url, archived: true, duplicate: result.duplicate, provider: "sharepoint" });
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const rows = await query(
    `SELECT id, application_id, resume_version_id, export_type, file_name, status, file_size_bytes,
            storage_provider, storage_url, storage_item_id, error, created_at, updated_at
     FROM application_resume_exports
     WHERE application_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [applicationId]
  );

  return NextResponse.json({ exports: rows });
}
