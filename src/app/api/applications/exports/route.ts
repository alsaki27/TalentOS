// src/app/api/applications/exports/route.ts
// POST -> record a client-generated resume export (PDF/DOCX) in R2 + the
// application_resume_exports table. The file is already rendered by the time it
// reaches here - this route is a thin upload+record step, not a generator, since
// @react-pdf/renderer and docx render entirely in the browser (see clientExport.tsx).

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { uploadToSharePoint } from "@/lib/integrations/sharepoint";

const EXPORT_TYPES = new Set(["pdf", "docx"]);

function safeSegment(value: string, fallback: string) {
  const cleaned = value.normalize("NFKD").replace(/[^a-zA-Z0-9._ -]+/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 90);
}

async function sha256Hex(buffer: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
  const linked = await queryOne<{ id: string; candidate_name: string; company_name: string; job_title: string }>(
    `SELECT a.id, c.name AS candidate_name, COALESCE(j.company, 'Unknown Company') AS company_name,
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
  const contentType =
    exportType === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const contentHash = await sha256Hex(buffer);
  const extension = exportType === "pdf" ? "pdf" : "docx";
  const candidateName = safeSegment(linked.candidate_name, "Candidate");
  const companyName = safeSegment(linked.company_name, "Company");
  const jobTitle = safeSegment(linked.job_title, "Application");
  const versionSuffix = archiveLabel ? ` - ${safeSegment(archiveLabel, "version")}` : "";
  const fileName = `${candidateName} - ${companyName} - ${jobTitle} - app-${applicationId} - resume-${resumeVersionId}${versionSuffix}.${extension}`;
  const path = `${candidateName}/${applicationId}/${fileName}`;

  // One archive slot per application/resume/export filename. Normal exports
  // reuse the same filename and therefore overwrite the current SharePoint
  // file. Version-labeled saves intentionally have a different filename so
  // historical versions remain available.
  const existing = await queryOne<{
    id: string;
    status: string;
    storage_url: string | null;
    content_sha256: string | null;
  }>(
    `SELECT id, status, storage_url, content_sha256 FROM application_resume_exports
     WHERE application_id = $1 AND resume_version_id = $2 AND export_type = $3 AND file_name = $4
       AND status <> 'deleted' ORDER BY created_at DESC LIMIT 1`,
    [applicationId, resumeVersionId, exportType, fileName]
  );
  if (existing?.status === "created" && existing.storage_url && existing.content_sha256 === contentHash) {
    return NextResponse.json({ id: existing.id, url: existing.storage_url, archived: true, duplicate: true });
  }

  let publicUrl: string;
  try {
    const sharePoint = await uploadToSharePoint(path, buffer, contentType);
    const result = { url: sharePoint.url, provider: "sharepoint" as const, itemId: sharePoint.itemId };
    publicUrl = result.url;
    const rows = existing
      ? await query<{ id: string }>(
          `UPDATE application_resume_exports SET file_name = $1, file_path = $2, storage_provider = $3,
             storage_url = $4, storage_item_id = $5, file_size_bytes = $6, status = 'created', error = NULL,
             content_sha256 = $7, candidate_name_snapshot = $8, company_name_snapshot = $9, job_title_snapshot = $10,
             created_by = $11, updated_at = NOW() WHERE id = $12 RETURNING id`,
          [fileName, path, result.provider, result.url, result.itemId ?? null, buffer.byteLength, contentHash,
           linked.candidate_name, linked.company_name, linked.job_title, context?.profile.user_id, existing.id]
        )
      : await query<{ id: string }>(
          `INSERT INTO application_resume_exports
             (application_id, resume_version_id, export_type, file_name, file_path, storage_provider, storage_url,
              storage_item_id, file_size_bytes, status, created_by, content_sha256,
              candidate_name_snapshot, company_name_snapshot, job_title_snapshot, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'created',$10,$11,$12,$13,$14,NOW()) RETURNING id`,
          [applicationId, resumeVersionId, exportType, fileName, path, result.provider, result.url,
           result.itemId ?? null, buffer.byteLength, context?.profile.user_id, contentHash,
           linked.candidate_name, linked.company_name, linked.job_title]
        );
    return NextResponse.json({ id: rows[0]?.id, url: publicUrl, archived: true, provider: result.provider });
  } catch (err: any) {
    // Record the failure too, matching the table's own status enum - lets the
    // export history page show *why* a download is missing instead of nothing.
    if (existing) {
      await query(
        `UPDATE application_resume_exports
         SET status = 'failed', error = $1, content_sha256 = $2, file_size_bytes = $3,
             created_by = $4, updated_at = NOW()
         WHERE id = $5`,
        [err.message ?? String(err), contentHash, buffer.byteLength, context?.profile.user_id, existing.id]
      );
    } else {
      await query(
        `INSERT INTO application_resume_exports
           (application_id, resume_version_id, export_type, file_name, file_path, status, error, created_by,
            content_sha256, candidate_name_snapshot, company_name_snapshot, job_title_snapshot, updated_at)
         VALUES ($1,$2,$3,$4,$5,'failed',$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (application_id, resume_version_id, export_type, content_sha256)
           WHERE content_sha256 IS NOT NULL AND status <> 'deleted'
         DO UPDATE SET status='failed', error=EXCLUDED.error, updated_at=NOW(), created_by=EXCLUDED.created_by`,
        [applicationId, resumeVersionId, exportType, fileName, path, err.message ?? String(err), context?.profile.user_id,
         contentHash, linked.candidate_name, linked.company_name, linked.job_title]
      );
    }
    return NextResponse.json({ error: `Upload failed: ${err.message ?? err}` }, { status: 500 });
  }
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
