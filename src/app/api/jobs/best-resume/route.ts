// src/app/api/jobs/best-resume/route.ts
//
// POST /api/jobs/best-resume
// Scores ALL base resumes for a candidate in parallel against a job description
// and returns the best-matching one. Uses the existing "job_match_score"
// automation — no new AI key or routing slot required.
//
// Body:  { job_id: string, candidate_id: string }
// Returns: { best_resume_id, score, breakdown, all_scores[] }

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";
import { findSoTByCandidateId } from "@/server/repositories/sourceOfTruthRepository";

const AUTOMATION_ID = "job_match_score";

interface BaseResume {
  id: string;
  name: string;
  content: unknown;
}

interface ResumeScore {
  resume_id: string;
  resume_name: string;
  score: number;
  skills_match: number;
  experience_match: number;
  reasoning: string;
}

/**
 * Score a single base resume against a job description text.
 * Mirrors the prompt logic in /api/jobs/match-score exactly — same AI call,
 * same automation, same routing — just parameterised over a specific resume
 * rather than always the most-recent one.
 */
async function scoreResume(
  resume: BaseResume,
  jobDescText: string,
  verifiedSkills: string[] = [],
  sotSkills: string[] = []
): Promise<ResumeScore> {
  const systemPrompt =
    "You are an unbiased, expert technical recruiter evaluating a candidate's fit for a job. Reply with valid JSON only, no markdown, no explanation.";

  const userPrompt = `You must return your evaluation strictly as a JSON object with the following keys:
- "score": Integer from 0-100 representing the overall match.
- "skills_match": Integer from 0-100 representing hard skills overlap.
- "experience_match": Integer from 0-100 representing experience relevance.
- "reasoning": A brief, 1-2 sentence explanation of the score.

Evaluation Rules:
1. Base your evaluation on ALL available candidate information: the base resume content, recruiter-verified skills, and Source of Truth confirmed skills.
2. Evaluate how well the candidate's technical skills, methodologies, domain knowledge, and professional experience align with the job description requirements.
3. Be objective, accurate, and realistic. Give credit for direct experience as well as strongly transferable domain skills and recruiter-verified competencies.
4. Calculate a realistic, fair, and comprehensive match score (0-100) reflecting the candidate's true qualifications for this role.

Job Description:
${jobDescText}

Candidate Base Resume (JSON):
${JSON.stringify(resume.content)}

Recruiter-Verified & Source of Truth Confirmed Skills (Treat these as 100% verified candidate competencies):
${JSON.stringify([...(verifiedSkills || []), ...(sotSkills || [])])}
`;

  const { result } = await callWithUsageTracking(
    AUTOMATION_ID,
    undefined,
    async (provider) => {
      const response = await provider.send({
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
        tools: [],
        temperature: 0.1,
      });
      const raw = textOf(response.content);
      const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      return JSON.parse(stripped);
    }
  );

  return {
    resume_id: resume.id,
    resume_name: resume.name,
    score: parseInt(result.score) || 0,
    skills_match: parseInt(result.skills_match) || 0,
    experience_match: parseInt(result.experience_match) || 0,
    reasoning: result.reasoning || "No reasoning provided.",
  };
}

export async function POST(req: NextRequest) {
  // Auth — same gates as the rest of the Jobs page AI features
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let job_id = "";
  let candidate_id = "";

  try {
    const body = await req.json();
    job_id = body.job_id;
    candidate_id = body.candidate_id;

    if (!job_id || !candidate_id) {
      return NextResponse.json(
        { error: "job_id and candidate_id are required" },
        { status: 400 }
      );
    }

    // ── 1. Load ALL approved base resumes for this candidate ──
    const baseResumes = await query<BaseResume>(
      `SELECT id, name, content
       FROM base_resumes
       WHERE candidate_id = $1
       ORDER BY updated_at DESC`,
      [candidate_id]
    );

    if (baseResumes.length === 0) {
      return NextResponse.json(
        { error: "No base resumes found for this candidate" },
        { status: 404 }
      );
    }

    // ── 2. Load job description ──
    const job = await queryOne<{
      title: string;
      description_text: string | null;
      raw_description: string | null;
    }>(
      "SELECT title, description_text, raw_description FROM jobs WHERE id = $1",
      [job_id]
    );

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const jobDescText =
      job.description_text ||
      job.raw_description ||
      `Title: ${job.title}`;

    if (!jobDescText.trim()) {
      // No description to score against — fall back to most recent resume
      return NextResponse.json({
        best_resume_id: baseResumes[0].id,
        best_resume_name: baseResumes[0].name,
        score: null,
        breakdown: null,
        all_scores: [],
        fallback_reason: "job_has_no_description",
      });
    }

    const [candidateRow, sotRow] = await Promise.all([
      queryOne<{ verified_skills: string[] | null }>("SELECT verified_skills FROM candidates WHERE id = $1", [candidate_id]),
      findSoTByCandidateId(candidate_id)
    ]);
    const verifiedSkills = candidateRow?.verified_skills || [];
    const sotSkills = sotRow?.confirmed_skills || [];

    // ── 3. Score all resumes in parallel ──
    console.log(
      `[best-resume] Scoring ${baseResumes.length} base resumes for candidate ${candidate_id} against job ${job_id}`
    );

    const scoringResults = await Promise.allSettled(
      baseResumes.map((resume) => scoreResume(resume, jobDescText, verifiedSkills, sotSkills))
    );

    const all_scores: ResumeScore[] = [];
    let best: ResumeScore | null = null;

    for (const result of scoringResults) {
      if (result.status === "fulfilled") {
        all_scores.push(result.value);
        if (!best || result.value.score > best.score) {
          best = result.value;
        }
      }
      // Rejected promises are silently skipped — we work with whatever scored
    }

    // All scoring attempts failed — fall back to most recent resume
    if (!best) {
      console.warn(
        `[best-resume] All ${baseResumes.length} scoring attempts failed for candidate ${candidate_id}. Falling back to most-recent resume.`
      );
      return NextResponse.json({
        best_resume_id: baseResumes[0].id,
        best_resume_name: baseResumes[0].name,
        score: null,
        breakdown: null,
        all_scores: [],
        fallback_reason: "all_scoring_failed",
      });
    }

    // ── 4. Persist the winning score to job_match_scores (idempotent) ──
    // This means the match-score badge on the main Jobs page also reflects
    // the AI's best-resume choice instead of always using the most-recent one.
    const breakdown = JSON.stringify({
      skills_match: best.skills_match,
      experience_match: best.experience_match,
      reasoning: best.reasoning,
      source: "best_resume_picker",
    });

    await queryOne(
      `INSERT INTO job_match_scores (job_id, candidate_id, base_resume_id, score, breakdown)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (job_id, candidate_id)
       DO UPDATE SET
         base_resume_id = EXCLUDED.base_resume_id,
         score          = EXCLUDED.score,
         breakdown      = EXCLUDED.breakdown,
         updated_at     = now()
       RETURNING id`,
      [job_id, candidate_id, best.resume_id, best.score, breakdown]
    );

    console.log(
      `[best-resume] Best resume for candidate ${candidate_id}: "${best.resume_name}" (score ${best.score}) out of ${all_scores.length} evaluated`
    );

    return NextResponse.json({
      best_resume_id: best.resume_id,
      best_resume_name: best.resume_name,
      score: best.score,
      breakdown: {
        skills_match: best.skills_match,
        experience_match: best.experience_match,
        reasoning: best.reasoning,
      },
      all_scores: all_scores.sort((a, b) => b.score - a.score),
    });
  } catch (error: any) {
    console.error("[best-resume] Error:", error);
    return NextResponse.json(
      { error: error.message || "Best resume selection failed" },
      { status: 500 }
    );
  }
}
