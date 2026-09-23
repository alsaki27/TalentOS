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
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { archiveResumeToSharePoint } from "@/server/services/resumeSharePointArchiveService";

const EXPORT_TYPES = new Set(["pdf", "docx"]);

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

      // storage_url (the real, already-complete link returned by whichever
      // provider archived it - SharePoint's webUrl or R2's public URL) is
      // read directly rather than rebuilt from file_path: file_path for a
      // SharePoint-archived row is a SharePoint-relative graph path
      // (CandidateName/JobId/filename.pdf), and running that through R2's
      // getPublicUrl() previously produced a URL pointing at a bucket that
      // never had the file - a broken link the extension had no way to detect.
      const row = await queryOne<{ file_name: string; storage_url: string | null; export_type: string; created_at: string }>(
        `SELECT file_name, storage_url, export_type, created_at
         FROM application_resume_exports
         WHERE application_id = $1 AND status = 'created' AND export_type = 'pdf' AND storage_url IS NOT NULL
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
        url: row.storage_url,
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

      const linked = await queryOne<{ candidate_id: string; job_id: string | null; candidate_name: string; company_name: string; job_title: string }>(
        `SELECT a.candidate_id, a.job_id, c.name AS candidate_name, COALESCE(j.company, 'Unknown Company') AS company_name,
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
        createdByUserId: null,
      });
      if (!result.ok) return extensionError("internal_error", result.error || "Upload failed.", 500);
      return NextResponse.json({ archived: true, duplicate: result.duplicate, id: result.id, url: result.url, storageItemId: result.storageItemId ?? null });
    } catch (err) {
      console.error("[Copilot Resume Export Archive Error]", err);
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
