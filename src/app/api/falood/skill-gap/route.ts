// POST /api/falood/skill-gap
// Deterministic skill-gap suggestions for the Falood Copilot: skills present
// in the job description, the candidate's base resumes, or their
// Source-of-Truth confirmed skills, but missing from the tailored resume
// currently open in the studio. See docs/FALOOD_COPILOT_SKILL_GAP_SUGGESTIONS_PLAN_2026-08-24.md.
//
// Stateless, same shape as /api/falood/suggestions - the client sends its
// current resume/JD rather than this route re-fetching a session row, so it
// always reflects exactly what's on screen right now.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { query } from "@/server/db/neon";
import { sanitizeApiError } from "@/lib/utils";
import { extractSkillsFromJobDescription } from "@/server/services/faloodAiService";
import { getSourceOfTruth } from "@/server/services/sourceOfTruthService";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import {
  detectSkillGaps,
  filterSkillGapsForScoreIncrease,
  flattenResumeSkills,
} from "@/lib/falood/skillGapDetector";

export const dynamic = "force-dynamic";

async function getBaseResumeSkills(candidateId: string): Promise<string[]> {
  const rows = await query<{ content: any }>(
    "SELECT content FROM base_resumes WHERE candidate_id = $1",
    [candidateId]
  );
  const skills: string[] = [];
  for (const row of rows) {
    try {
      const parsed = typeof row.content === "string" ? JSON.parse(row.content) : row.content;
      skills.push(...flattenResumeSkills(studioDocumentToResumeData(parsed).skills));
    } catch {
      // A malformed base resume shouldn't block gap detection for the rest.
    }
  }
  return skills;
}

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const jobDescription: string = typeof body.jobDescription === "string" ? body.jobDescription : "";
  const resumeSkills: string[] = Array.isArray(body.resumeSkills) ? body.resumeSkills.filter((s: unknown) => typeof s === "string") : [];
  const candidateId: string | undefined = typeof body.candidateId === "string" ? body.candidateId : undefined;

  if (jobDescription.trim().length < 80) {
    // Same floor the existing auto-suggest effect already uses before it
    // trusts a job description enough to act on it.
    return NextResponse.json({ gaps: [] });
  }

  try {
    const [{ skills: jdSkills }, baseResumeSkills, sot] = await Promise.all([
      extractSkillsFromJobDescription(jobDescription, currentUser.profile.user_id),
      candidateId ? getBaseResumeSkills(candidateId) : Promise.resolve<string[]>([]),
      candidateId ? getSourceOfTruth(candidateId) : Promise.resolve(null),
    ]);

    const gaps = detectSkillGaps({
      resumeSkills,
      jdSkills,
      baseResumeSkills,
      sourceOfTruthSkills: sot?.confirmedSkills ?? [],
    });
    const filtered = filterSkillGapsForScoreIncrease(gaps, resumeSkills, jdSkills);

    return NextResponse.json({ gaps: filtered.map((g) => g.skill) });
  } catch (e: any) {
    return NextResponse.json({ error: sanitizeApiError(e) }, { status: 500 });
  }
}
