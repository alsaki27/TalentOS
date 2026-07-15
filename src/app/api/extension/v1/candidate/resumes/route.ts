// GET /api/extension/v1/candidate/resumes?candidateId=<uuid>
// Scope: extension:resume:read
// Returns a list of resumes belonging to the candidate.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.resumeRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const candidateId = req.nextUrl.searchParams.get("candidateId");
      if (!candidateId) {
        return extensionError("validation_error", "candidateId query parameter is required.", 400);
      }

      const rows = await query<{ id: string; file_url: string; is_original_upload: boolean; created_at: string }>(
        `SELECT id, file_url, is_original_upload, created_at
         FROM resumes
         WHERE candidate_id = $1
         ORDER BY is_original_upload DESC, created_at DESC
         LIMIT 20`,
        [candidateId]
      );

      const resumes = rows.map((r) => {
        const segments = r.file_url.split("/");
        const fileName = segments[segments.length - 1] || "resume.pdf";
        return {
          id: r.id,
          fileName,
          fileUrl: r.file_url,
          isOriginalUpload: r.is_original_upload,
          createdAt: r.created_at,
        };
      });

      return NextResponse.json({ resumes });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}
