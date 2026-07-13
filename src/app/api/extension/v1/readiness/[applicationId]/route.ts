// GET /api/extension/v1/readiness/[applicationId]
// Scope: extension:readiness:read
// Returns the readiness score for a specific application.

import { NextRequest, NextResponse } from "next/server";
import { queryOne, query } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES } from "@/lib/extensionAuth";
import { computeReadinessScore } from "@/server/services/readinessService";

export async function GET(
  request: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;

  const auth = await authenticateExtension(request, EXTENSION_SCOPES.readinessRead);
  if (auth instanceof NextResponse) return auth;

  try {
    const applicationId = params.applicationId;

    const app = await queryOne<{ candidate_id: string; job_id: string }>(
      `SELECT candidate_id, job_id FROM applications WHERE id = $1`,
      [applicationId]
    );
    if (!app) return extensionError("not_found", "Application not found.", 404);

    // Get the job's JD text
    const job = await queryOne<{ description_text: string; title: string }>(
      `SELECT description_text, title FROM jobs WHERE id = $1`,
      [app.job_id]
    );
    if (!job) return extensionError("not_found", "Job not found for this application.", 404);

    const jdText = [job.title, job.description_text ?? ""].join("\n");

    // Get candidate's skills
    const candidate = await queryOne<{ verified_skills: string[] }>(
      `SELECT verified_skills FROM candidates WHERE id = $1`,
      [app.candidate_id]
    );

    const verifiedSkills: string[] = candidate?.verified_skills ?? [];

    // Get evidenced skills from candidate_evidence
    const evidenceRows = await query<{ skill: string }>(
      `SELECT DISTINCT unnest(related_skills) AS skill FROM candidate_evidence WHERE candidate_id = $1`,
      [app.candidate_id]
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