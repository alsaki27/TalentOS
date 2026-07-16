// GET /api/extension/v1/candidates/list
// Scope: extension:readiness:read
// Returns a list of active candidates and their associated resumes for the QA extension candidate picker.

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    // Reusing readinessRead scope because it's for QA check
    const auth = await authenticateExtension(req, EXTENSION_SCOPES.readinessRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const search = req.nextUrl.searchParams.get("search") || "";
      
      let candidateQuery = `
        SELECT id, name, email, status, city, country
        FROM candidates 
      `;
      const queryParams: any[] = [];
      
      if (search) {
        candidateQuery += ` WHERE name ILIKE $1 `;
        queryParams.push(`%${search}%`);
      }
      
      candidateQuery += ` ORDER BY created_at DESC LIMIT 100`;
      
      const candidateRows = await query<any>(candidateQuery, queryParams);
      
      if (candidateRows.length === 0) {
        return NextResponse.json({ candidates: [] });
      }
      
      const candidateIds = candidateRows.map(c => c.id);
      
      const resumeRows = await query<any>(
        `SELECT id, candidate_id, label, kind, filename, is_original_upload, created_at 
         FROM resumes 
         WHERE candidate_id = ANY($1) 
         ORDER BY is_original_upload DESC, created_at DESC`,
        [candidateIds]
      );
      
      const resumesByCandidate = new Map<string, any[]>();
      for (const row of resumeRows) {
         if (!resumesByCandidate.has(row.candidate_id)) {
            resumesByCandidate.set(row.candidate_id, []);
         }
         resumesByCandidate.get(row.candidate_id)!.push({
            id: row.id,
            label: row.label,
            kind: row.kind,
            filename: row.filename,
            isOriginalUpload: row.is_original_upload,
            createdAt: row.created_at
         });
      }
      
      const candidates = candidateRows.map(c => ({
        id: c.id,
        name: c.name,
        email: c.email,
        status: c.status,
        city: c.city,
        country: c.country,
        resumes: resumesByCandidate.get(c.id) || []
      }));

      return NextResponse.json({ candidates });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
