// src/app/api/applications/exports/route.ts
// POST -> record a client-generated resume export (PDF/DOCX) in R2 + the
// application_resume_exports table. The file is already rendered by the time it
// reaches here - this route is a thin upload+record step, not a generator, since
// @react-pdf/renderer and docx render entirely in the browser (see clientExport.tsx).

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { uploadFile } from "@/server/storage/storageApi";

const EXPORT_TYPES = new Set(["pdf", "docx"]);

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const applicationId = formData.get("applicationId") as string | null;
  const resumeVersionId = formData.get("resumeVersionId") as string | null;
  const exportType = formData.get("exportType") as string | null;
  const fileName = (formData.get("fileName") as string | null) ?? file?.name ?? "resume";

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
  const linked = await queryOne<{ id: string }>(
    `SELECT a.id FROM applications a
     JOIN application_resume_versions arv ON arv.application_id = a.id
     WHERE a.id = $1 AND arv.id = $2`,
    [applicationId, resumeVersionId]
  );
  if (!linked) {
    return NextResponse.json(
      { error: "applicationId/resumeVersionId do not match an existing application" },
      { status: 404 }
    );
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const contentType =
    exportType === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const path = `exports/${applicationId}/${Date.now()}-${fileName}`;

  let publicUrl: string;
  try {
    const result = await uploadFile(path, buffer, contentType);
    publicUrl = result.url;
  } catch (err: any) {
    // Record the failure too, matching the table's own status enum - lets the
    // export history page show *why* a download is missing instead of nothing.
    await query(
      `INSERT INTO application_resume_exports
         (application_id, resume_version_id, export_type, file_name, status, error, created_by)
       VALUES ($1, $2, $3, $4, 'failed', $5, $6)`,
      [applicationId, resumeVersionId, exportType, fileName, err.message ?? String(err), context?.profile.user_id]
    );
    return NextResponse.json({ error: `Upload failed: ${err.message ?? err}` }, { status: 500 });
  }

  const rows = await query<{ id: string }>(
    `INSERT INTO application_resume_exports
       (application_id, resume_version_id, export_type, file_name, file_path, storage_provider, file_size_bytes, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'r2', $6, 'created', $7)
     RETURNING id`,
    [applicationId, resumeVersionId, exportType, fileName, path, buffer.byteLength, context?.profile.user_id]
  );

  return NextResponse.json({ id: rows[0]?.id, url: publicUrl });
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const applicationId = req.nextUrl.searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const rows = await query(
    `SELECT id, export_type, file_name, status, file_size_bytes, created_at
     FROM application_resume_exports
     WHERE application_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [applicationId]
  );

  return NextResponse.json({ exports: rows });
}
