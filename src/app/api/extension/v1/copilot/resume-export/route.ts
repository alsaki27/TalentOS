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
import { getPublicUrl } from "@/server/storage/storageApi";

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
        return NextResponse.json({ found: false });
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

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
