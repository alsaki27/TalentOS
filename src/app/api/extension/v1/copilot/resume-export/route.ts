// GET /api/extension/v1/copilot/resume-export?applicationId=X
// Scope: extension:resume:read
// Looks up the latest successful client-rendered PDF export for this
// application (created via Falood Studio's "Open in Studio" -> export flow,
// see clientExport.tsx + /api/applications/exports) so the Copilot extension
// can download the REAL resume file, rename it, and attach it to a job's
// file upload field. There is no server-side resume PDF generation to fall
// back to here — see resumeExportService.ts for why (Cloudflare Worker
// runtime can't run @react-pdf/renderer/docx). If no export exists yet, the
// extension tells the AE to export one from Studio first.

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { uploadToSharePoint } from "@/lib/integrations/sharepoint";
import { getPublicUrl } from "@/server/storage/storageApi";

const EXPORT_TYPES = new Set(["pdf", "docx"]);

function safeSegment(value: string, fallback: string) {
  const cleaned = value.normalize("NFKD").replace(/[^a-zA-Z0-9._ -]+/g, "").replace(/\s+/g, " ").trim();
  return (cleaned || fallback).slice(0, 90);
}

async function sha256Hex(buffer: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.resumeRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const applicationId = req.nextUrl.searchParams.get("applicationId");
      if (!applicationId) {
        return extensionError("validation_error", "applicationId is required.", 400);
      }

      const row = await queryOne<{ file_name: string; file_path: string; export_type: string; created_at: string }>(
        `SELECT file_name, file_path, export_type, created_at
         FROM application_resume_exports
         WHERE application_id = $1 AND status = 'created' AND export_type = 'pdf'
         ORDER BY created_at DESC
         LIMIT 1`,
        [applicationId]
      );

      if (!row) {
        const version = await queryOne<{ generated_text: string | null; content: unknown }>(
          `SELECT generated_text, content FROM application_resume_versions
           WHERE application_id = $1 ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
          [applicationId]
        );
        const resumeText = version?.generated_text || (version?.content
          ? typeof version.content === "string" ? version.content : JSON.stringify(version.content)
          : "");
        // Text fallback is useful for form filling, but it is not an export.
        // Never report it as found, otherwise the extension can submit an
        // application without creating the SharePoint/archive record.
        return resumeText
          ? NextResponse.json({ found: false, archived: false, requiresArchive: true,
              applicationId, resumeText, generatedLocally: true })
          : NextResponse.json({ found: false, archived: false, requiresArchive: true, applicationId });
      }

      return NextResponse.json({
        found: true,
        url: getPublicUrl(row.file_path),
        fileName: row.file_name,
        createdAt: row.created_at,
      });
    } catch (err) {
      console.error("[Copilot Resume Export Lookup Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

// POST /api/extension/v1/copilot/resume-export
// Archives the exact PDF/DOCX produced by the extension in SharePoint before
// the AE completes the application. This is deliberately separate from the
// text fallback above: a locally downloaded/attached file is not considered
// archived until this endpoint returns archived=true.
export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;
    const auth = await authenticateExtension(req, EXTENSION_SCOPES.resumeRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const applicationId = formData.get("applicationId") as string | null;
      const resumeVersionId = formData.get("resumeVersionId") as string | null;
      const exportType = formData.get("exportType") as string | null;
      if (!file || !applicationId || !resumeVersionId || !exportType) {
        return extensionError("validation_error", "file, applicationId, resumeVersionId, and exportType are required.", 400);
      }
      if (!EXPORT_TYPES.has(exportType)) {
        return extensionError("validation_error", "exportType must be pdf or docx.", 400);
      }

      const linked = await queryOne<{ candidate_name: string; company_name: string; job_title: string }>(
        `SELECT c.name AS candidate_name, COALESCE(j.company, 'Unknown Company') AS company_name,
                COALESCE(j.title, 'Job Application') AS job_title
         FROM applications a JOIN candidates c ON c.id = a.candidate_id
         LEFT JOIN jobs j ON j.id = a.job_id
         JOIN application_resume_versions arv ON arv.id = $2
         WHERE a.id = $1 AND (arv.application_id = a.id OR
           (arv.candidate_id = a.candidate_id AND EXISTS
             (SELECT 1 FROM target_jobs tj WHERE tj.id = arv.target_job_id AND tj.job_id = a.job_id)))`,
        [applicationId, resumeVersionId]
      );
      if (!linked) return extensionError("not_found", "Application and resume version do not match.", 404);

      const buffer = new Uint8Array(await file.arrayBuffer());
      const contentHash = await sha256Hex(buffer);
      const extension = exportType === "pdf" ? "pdf" : "docx";
      const contentType = exportType === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const fileName = `${safeSegment(linked.candidate_name, "Candidate")} - ${safeSegment(linked.company_name, "Company")} - ${safeSegment(linked.job_title, "Application")} - app-${applicationId} - resume-${resumeVersionId}.${extension}`;
      const path = `${safeSegment(linked.candidate_name, "Candidate")}/${applicationId}/${fileName}`;

      const existing = await queryOne<{ id: string; storage_url: string | null; content_sha256: string | null }>(
        `SELECT id, storage_url, content_sha256 FROM application_resume_exports
         WHERE application_id = $1 AND resume_version_id = $2 AND export_type = $3 AND file_name = $4 AND status <> 'deleted'
         ORDER BY created_at DESC LIMIT 1`, [applicationId, resumeVersionId, exportType, fileName]);
      if (existing?.storage_url && existing.content_sha256 === contentHash) {
        return NextResponse.json({ archived: true, duplicate: true, id: existing.id, url: existing.storage_url });
      }

      const sharePoint = await uploadToSharePoint(path, buffer, contentType);
      const saved = existing
        ? await queryOne<{ id: string }>(`UPDATE application_resume_exports SET file_name=$1,file_path=$2,storage_provider='sharepoint',storage_url=$3,storage_item_id=$4,file_size_bytes=$5,status='created',error=NULL,content_sha256=$6,updated_at=NOW() WHERE id=$7 RETURNING id`, [fileName, path, sharePoint.url, sharePoint.itemId ?? null, buffer.byteLength, contentHash, existing.id])
        : await queryOne<{ id: string }>(`INSERT INTO application_resume_exports (application_id,resume_version_id,export_type,file_name,file_path,storage_provider,storage_url,storage_item_id,file_size_bytes,status,content_sha256,updated_at) VALUES ($1,$2,$3,$4,$5,'sharepoint',$6,$7,$8,'created',$9,NOW()) RETURNING id`, [applicationId, resumeVersionId, exportType, fileName, path, sharePoint.url, sharePoint.itemId ?? null, buffer.byteLength, contentHash]);
      return NextResponse.json({ archived: true, id: saved?.id, url: sharePoint.url, storageItemId: sharePoint.itemId ?? null });
    } catch (err) {
      console.error("[Copilot Resume Export Archive Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
