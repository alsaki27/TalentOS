import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export const GET = withExtensionCors(async (req) => {
  const headerError = checkRequiredHeaders(req);
  if (headerError) return headerError;

  const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
  if (auth instanceof NextResponse) return auth;

  try {
    // 1. Fetch active candidates
    const candidates = await query<any>(`
      SELECT id, name, target_roles
      FROM candidates
      WHERE status = 'active'
      ORDER BY created_at DESC
    `);

    // 2. Fetch resumes for all candidates. Excludes rows with no parsed
    // content — found live (RMSI/Zoho Recruit test) that a candidate can
    // have two resumes with the IDENTICAL displayed filename, one parsed and
    // one not; the dropdown gave no way to tell them apart, and picking the
    // empty one meant Fill Planner got zero resume text to work with while
    // looking indistinguishable from a normal, working selection.
    const resumes = await query<any>(`
      SELECT id, candidate_id, label, kind, file_url, filename, is_original_upload
      FROM resumes
      WHERE parsed_json IS NOT NULL
    `);

    const baseResumes = await query<any>(`
      SELECT id, candidate_id, name as label, 'base_resume' as kind, status
      FROM base_resumes
      WHERE status != 'archived'
    `);

    // Combine and group resumes by candidate
    const resumeMap: Record<string, any[]> = {};
    
    for (const r of resumes) {
      if (!resumeMap[r.candidate_id]) resumeMap[r.candidate_id] = [];
      resumeMap[r.candidate_id].push({
        id: r.id,
        label: r.label || r.filename,
        kind: r.kind,
        isOriginal: r.is_original_upload,
        sourceType: "resume"
      });
    }

    for (const br of baseResumes) {
      if (!resumeMap[br.candidate_id]) resumeMap[br.candidate_id] = [];
      resumeMap[br.candidate_id].push({
        id: br.id,
        label: br.label,
        kind: br.kind,
        isOriginal: false,
        sourceType: "base_resume"
      });
    }

    // Map candidates to their resumes
    const result = candidates.map(c => ({
      id: c.id,
      name: c.name,
      targetRoles: c.target_roles,
      resumes: resumeMap[c.id] || []
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
});
