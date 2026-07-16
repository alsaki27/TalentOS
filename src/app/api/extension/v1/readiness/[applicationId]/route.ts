// GET /api/extension/v1/readiness/[applicationId]
// Scope: extension:readiness:read
// Returns the readiness score for a specific application, including resume skills.

import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { computeReadinessScore } from "@/server/services/readinessService";

function extractResumeSkills(parsedJson: Record<string, unknown> | null): string[] {
  if (!parsedJson) return [];
  const rawSkills = (parsedJson as any).skills;
  if (!Array.isArray(rawSkills)) return [];
  const tokens: string[] = [];
  for (const s of rawSkills) {
    let str = "";
    if (typeof s === "string") str = s;
    else if (typeof s === "object" && s && "name" in s) str = String((s as any).name);
    if (!str) continue;
    str.split(/[:,\s]+/).forEach((t) => {
      const trimmed = t.trim();
      if (trimmed && trimmed.length > 1) tokens.push(trimmed);
    });
  }
  return tokens;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.readinessRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const applicationId = params.applicationId;

      const app = await queryOne<{ candidate_id: string; job_id: string }>(
        `SELECT candidate_id, job_id FROM applications WHERE id = $1`,
        [applicationId]
      );
      if (!app) return extensionError("not_found", "Application not found.", 404);

      const job = await queryOne<{ description_text: string; title: string }>(
        `SELECT description_text, title FROM jobs WHERE id = $1`,
        [app.job_id]
      );
      if (!job) return extensionError("not_found", "Job not found for this application.", 404);

      const jdText = [job.title, job.description_text ?? ""].join("\n");

      const candidate = await queryOne<{ verified_skills: string[] }>(
        `SELECT verified_skills FROM candidates WHERE id = $1`,
        [app.candidate_id]
      );

      const verifiedSkills: string[] = candidate?.verified_skills ?? [];

      const evidenceRows = await query<{ skill: string }>(
        `SELECT DISTINCT unnest(related_skills) AS skill FROM candidate_evidence WHERE candidate_id = $1`,
        [app.candidate_id]
      );
      const evidenceSkills = evidenceRows.map((r: any) => r.skill).filter(Boolean);

      const resumeRow = await queryOne<{ parsed_json: Record<string, unknown> | null }>(
        `SELECT parsed_json FROM resumes WHERE candidate_id = $1 ORDER BY is_original_upload DESC, created_at DESC LIMIT 1`,
        [app.candidate_id]
      );
      const resumeSkills = extractResumeSkills(resumeRow?.parsed_json ?? null);

      const evidenced = Array.from(new Set([...verifiedSkills, ...evidenceSkills, ...resumeSkills]));
      const vocabulary = evidenced.length > 0 ? evidenced : verifiedSkills;

      const result = computeReadinessScore({
        jdText,
        evidencedSkills: evidenced,
        claimedSkills: verifiedSkills,
        knownSkillVocabulary: vocabulary,
      });

      return NextResponse.json({
        ...result,
        resumeSkillsFound: resumeSkills.length,
        totalEvidenceSources: evidenceSkills.length + resumeSkills.length,
      });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
