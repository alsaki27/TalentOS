// POST /api/extension/v1/readiness/preview
// Scope: extension:readiness:read
// Computes readiness against a provided JD text, using the key's associated candidate's skills.

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, checkIdempotencyKey, extensionError, EXTENSION_SCOPES } from "@/lib/extensionAuth";
import { computeReadinessScore } from "@/server/services/readinessService";

export async function POST(request: NextRequest) {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;
  const idemError = checkIdempotencyKey(request);
  if (idemError) return idemError;

  const auth = await authenticateExtension(request, EXTENSION_SCOPES.readinessRead);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { jdText } = body;

    if (!jdText || typeof jdText !== "string") {
      return extensionError("validation_error", "jdText is required and must be a string.", 400);
    }

    const key = (auth as { key: { candidate_id: string | null } }).key;

    // Determine which candidate's skills to use
    let candidateId = key.candidate_id;
    if (!candidateId) {
      // Use whether body specifies one explicitly
      const bodyCandidateId = (body as any).candidateId;
      if (bodyCandidateId) candidateId = bodyCandidateId;
    }

    if (!candidateId) {
      return extensionError("validation_error", "No candidate associated with this API key. Pass candidateId in the body.", 400);
    }

    const candidate = await queryOne<{ verified_skills: string[] }>(
      `SELECT verified_skills FROM candidates WHERE id = $1`,
      [candidateId]
    );
    if (!candidate) return extensionError("not_found", "Candidate not found.", 404);

    const verifiedSkills: string[] = candidate.verified_skills ?? [];

    const evidenceRows = await query<{ skill: string }>(
      `SELECT DISTINCT unnest(related_skills) AS skill FROM candidate_evidence WHERE candidate_id = $1`,
      [candidateId]
    );
    const evidenceSkills = evidenceRows.map((r: any) => r.skill).filter(Boolean);

    const evidenced = Array.from(new Set([...verifiedSkills, ...evidenceSkills]));
    const vocabulary = evidenced.length > 0 ? evidenced : verifiedSkills;

    const result = computeReadinessScore({
      jdText,
      evidencedSkills: evidenced,
      claimedSkills: verifiedSkills,
      knownSkillVocabulary: vocabulary,
    });

    return NextResponse.json(result);
  } catch (err) {
    return extensionError("internal_error", String(err), 500);
  }
}