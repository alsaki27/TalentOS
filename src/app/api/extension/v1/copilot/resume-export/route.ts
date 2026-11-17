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
import { evidenceResumeExportIsAllowed } from "@/server/services/resumeEvidenceReleaseService";
import { RESUME_EVIDENCE_VARIANT } from "@/lib/ai/application-agents/workflowStages";
import { findExportById } from "@/server/repositories/applicationResumeExportsRepository";
import { readApprovedResumePdf } from "@/server/services/approvedResumePdfDownload";
import { signApprovedResumePdfLink, verifyApprovedResumePdfLink } from "@/server/services/approvedResumePdfLink";
import { TEMPORARY_RESUME_PDF_PROVIDER } from "@/server/storage/approvedResumePdfStorage";

const EXPORT_TYPES = new Set(["pdf", "docx"]);

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const applicationId = req.nextUrl.searchParams.get("applicationId");
    const exportId = req.nextUrl.searchParams.get("exportId");
    const token = req.nextUrl.searchParams.get("download");
    if (token !== null) {
      if (!applicationId || !exportId || !await verifyApprovedResumePdfLink(applicationId, exportId, token).catch(() => false)) {
        return extensionError("validation_error", "This résumé download link is invalid or expired.", 403);
      }
      try {
        const record = await findExportById(exportId);
        if (!record || record.application_id !== applicationId
          || !await evidenceResumeExportIsAllowed(applicationId, record.resume_version_id, exportId)) {
          return extensionError("validation_error", "This is not the current approved resume PDF.", 409);
        }
        return new NextResponse(new Blob([new Uint8Array(await readApprovedResumePdf(record))]), {
          headers: { "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
        });
      } catch {
        return extensionError("internal_error", "The approved PDF could not be downloaded. Please retry.", 502);
      }
    }
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.resumeRead);
    if (auth instanceof NextResponse) return auth;

    try {
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
      const row = await queryOne<{ id: string; candidate_id: string; file_name: string; storage_url: string | null; created_at: string }>(
        `SELECT x.id, a.candidate_id, x.file_name, x.storage_url, x.created_at
         FROM application_resume_exports x
         JOIN applications a ON a.id = x.application_id
         LEFT JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
         LEFT JOIN application_resume_versions v ON v.id = a.tailored_resume_version_id
         WHERE x.application_id = $1 AND x.status = 'created' AND x.export_type = 'pdf'
           AND (x.storage_url IS NOT NULL OR x.storage_provider = $3)
           AND (w.config_snapshot->>'pipelineVariant' IS DISTINCT FROM $2 OR (
             v.id = x.resume_version_id AND v.workflow_id = w.id AND v.status = 'approved'
             AND x.id::text = to_jsonb(v)->'release_receipt'->>'exportId'
             AND x.content_sha256 = to_jsonb(v)->'release_receipt'->>'pdfHash'
           ))
         ORDER BY x.created_at DESC
         LIMIT 1`,
        [applicationId, RESUME_EVIDENCE_VARIANT, TEMPORARY_RESUME_PDF_PROVIDER]
      );

      if (!row) {
        const version = await queryOne<{ generated_text: string | null; content: unknown }>(
          `SELECT v.generated_text, v.content FROM application_resume_versions v
           JOIN applications a ON a.id = v.application_id
           LEFT JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
           WHERE v.application_id = $1 AND w.config_snapshot->>'pipelineVariant' IS DISTINCT FROM $2
           ORDER BY v.updated_at DESC, v.created_at DESC LIMIT 1`,
          [applicationId, RESUME_EVIDENCE_VARIANT]
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

      let url = row.storage_url;
      if (!url) {
        if (auth.key.candidate_id && auth.key.candidate_id !== row.candidate_id) {
          return extensionError("forbidden", "This key cannot access this candidate's résumé.", 403);
        }
        const download = new URL(req.nextUrl.pathname, req.nextUrl.origin);
        download.search = new URLSearchParams({
          applicationId, exportId: row.id, download: await signApprovedResumePdfLink(applicationId, row.id),
        }).toString();
        url = download.href;
      }
      return NextResponse.json({
        found: true,
        url,
        fileName: row.file_name,
        createdAt: row.created_at,
      }, { headers: { "Cache-Control": "private, no-store" } });
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
      if (!await evidenceResumeExportIsAllowed(applicationId, resumeVersionId)) {
        return extensionError("validation_error", "Use the PDF saved when the reviewer approves this resume.", 409);
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
