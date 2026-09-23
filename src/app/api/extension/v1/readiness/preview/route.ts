// POST /api/extension/v1/readiness/preview
// Scope: extension:readiness:read
// Computes readiness against a provided JD text, using the key's associated candidate's
// verified skills, evidence, AND a specific resume (or latest if none provided).

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, checkIdempotencyKey, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { computeReadinessScore, extractAllResumeText } from "@/server/services/readinessService";

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

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;
    const idemError = checkIdempotencyKey(req);
    if (idemError) return idemError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.readinessRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { jdText, candidateId, resumeId } = body;

      if (!jdText || typeof jdText !== "string") {
        return extensionError("validation_error", "jdText is required and must be a string.", 400);
      }

      const key = (auth as { key: { candidate_id: string | null } }).key;

      let targetCandidateId = key.candidate_id || candidateId;

      if (!targetCandidateId) {
        return extensionError("validation_error", "No candidate associated with this API key. Pass candidateId in the body.", 400);
      }

      const candidate = await queryOne<{ verified_skills: string[], target_roles: string[] }>(
        `SELECT verified_skills, target_roles FROM candidates WHERE id = $1`,
        [targetCandidateId]
      );
      if (!candidate) return extensionError("not_found", "Candidate not found.", 404);

      const verifiedSkills: string[] = candidate.verified_skills ?? [];
      const targetRoles: string[] = candidate.target_roles ?? [];

      const evidenceRows = await query<{ skill: string }>(
        `SELECT DISTINCT unnest(related_skills) AS skill FROM candidate_evidence WHERE candidate_id = $1`,
        [targetCandidateId]
      );
      const evidenceSkills = evidenceRows.map((r: any) => r.skill).filter(Boolean);

      let resumeRow;
      if (resumeId) {
        resumeRow = await queryOne<{ parsed_json: Record<string, unknown> | null }>(
          `SELECT parsed_json FROM resumes WHERE id = $1 AND candidate_id = $2`,
          [resumeId, targetCandidateId]
        );
      } else {
        resumeRow = await queryOne<{ parsed_json: Record<string, unknown> | null }>(
          `SELECT parsed_json FROM resumes WHERE candidate_id = $1 ORDER BY is_original_upload DESC, created_at DESC LIMIT 1`,
          [targetCandidateId]
        );
      }
      
      const resumeSkills = extractResumeSkills(resumeRow?.parsed_json ?? null);
      const resumeTextCorpus = extractAllResumeText(resumeRow?.parsed_json ?? null);

      const result = computeReadinessScore({
        jdText,
        candidate: {
          verified_skills: verifiedSkills,
          target_roles: targetRoles
        },
        evidenceSkills,
        resumeSkills,
        resumeTextCorpus
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
