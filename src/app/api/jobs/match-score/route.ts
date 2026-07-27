import { NextRequest, NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";
import { findSoTByCandidateId } from "@/server/repositories/sourceOfTruthRepository";

const AUTOMATION_ID = "job_match_score";

async function storeErrorScore(job_id: string, candidate_id: string, reasoning: string) {
  const errorBreakdown = {
    skills_match: 0,
    experience_match: 0,
    reasoning,
  };
  const insertSql = `
    INSERT INTO job_match_scores (job_id, candidate_id, base_resume_id, score, breakdown)
    VALUES ($1, $2, null, -1, $3)
    ON CONFLICT (job_id, candidate_id)
    DO UPDATE SET score = -1, base_resume_id = null, breakdown = $3, updated_at = now()
    RETURNING *`;
  return queryOne(insertSql, [job_id, candidate_id, JSON.stringify(errorBreakdown)]);
}

async function scoreSingleResume(
  resumeContent: any,
  jobDescText: string,
  verifiedSkills: string[] = [],
  sotSkills: string[] = []
): Promise<{ score: number; skills_match: number; experience_match: number; reasoning: string }> {
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

Candidate Base Resume Content:
${JSON.stringify(resumeContent)}

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
    score: parseInt(result.score) || 0,
    skills_match: parseInt(result.skills_match) || 0,
    experience_match: parseInt(result.experience_match) || 0,
    reasoning: result.reasoning || "No reasoning provided.",
  };
}

export async function POST(req: NextRequest) {
  let job_id = "";
  let candidate_id = "";

  try {
    const body = await req.json();
    job_id = body.job_id;
    candidate_id = body.candidate_id;
    const base_resume_id = body.base_resume_id;

    if (!job_id || !candidate_id) {
      return NextResponse.json({ error: "job_id and candidate_id are required" }, { status: 400 });
    }

    let baseResumes: any[] = [];
    if (base_resume_id) {
      const br = await queryOne(
        "SELECT id, content FROM base_resumes WHERE id = $1 AND candidate_id = $2",
        [base_resume_id, candidate_id]
      );
      if (br) baseResumes = [br];
    }
    if (baseResumes.length === 0) {
      baseResumes = await query(
        "SELECT id, content FROM base_resumes WHERE candidate_id = $1 ORDER BY updated_at DESC",
        [candidate_id]
      );
    }

    if (!baseResumes || baseResumes.length === 0) {
      const finalScoreRecord = await storeErrorScore(job_id, candidate_id, "Error: No base resume found for this candidate.");
      return NextResponse.json(finalScoreRecord);
    }

    let existingScore: any = await queryOne(
      "SELECT * FROM job_match_scores WHERE job_id = $1 AND candidate_id = $2",
      [job_id, candidate_id]
    );

    // If a specific base_resume_id was requested (or if we default to the first one) and we already have a score for it, return existing
    const targetResumeId = base_resume_id || baseResumes[0].id;
    if (existingScore && existingScore.base_resume_id === targetResumeId && existingScore.score >= 0 && !body.force_rescore) {
      return NextResponse.json(existingScore);
    }

    let jobDescText = "";
    const job = await queryOne<{ title: string; description_text: string | null; raw_description: string | null }>(
      "SELECT title, description_text, raw_description FROM jobs WHERE id = $1",
      [job_id]
    );
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    jobDescText = job.description_text || job.raw_description || `Title: ${job.title}`;

    if (!jobDescText || jobDescText.trim().length === 0) {
      const finalScoreRecord = await storeErrorScore(job_id, candidate_id, "Error: Job has no description text to score against.");
      return NextResponse.json(finalScoreRecord);
    }

    const [candidateRow, sotRow] = await Promise.all([
      queryOne<{ verified_skills: string[] | null }>("SELECT verified_skills FROM candidates WHERE id = $1", [candidate_id]),
      findSoTByCandidateId(candidate_id)
    ]);
    const verifiedSkills = candidateRow?.verified_skills || [];
    const sotSkills = sotRow?.confirmed_skills || [];

    let latestBaseResume = baseResumes[0];
    let scoreRes: { score: number; skills_match: number; experience_match: number; reasoning: string };

    if (baseResumes.length > 1 && !base_resume_id) {
      // Evaluate all base resumes in parallel and select the best match
      const results = await Promise.allSettled(
        baseResumes.map(br => scoreSingleResume(br.content, jobDescText, verifiedSkills, sotSkills))
      );
      let bestScore = -1;
      let bestIdx = 0;
      results.forEach((res, idx) => {
        if (res.status === "fulfilled" && res.value.score > bestScore) {
          bestScore = res.value.score;
          bestIdx = idx;
        }
      });
      latestBaseResume = baseResumes[bestIdx];
      const bestVal = results[bestIdx];
      scoreRes = bestVal.status === "fulfilled" ? bestVal.value : await scoreSingleResume(latestBaseResume.content, jobDescText, verifiedSkills, sotSkills);
    } else {
      scoreRes = await scoreSingleResume(latestBaseResume.content, jobDescText, verifiedSkills, sotSkills);
    }

    const score = scoreRes.score;
    const breakdown = {
      skills_match: scoreRes.skills_match,
      experience_match: scoreRes.experience_match,
      reasoning: scoreRes.reasoning,
    };

    let finalScoreRecord = null;
    if (existingScore) {
      const updateSql = `UPDATE job_match_scores SET base_resume_id = $1, score = $2, breakdown = $3, updated_at = now() WHERE id = $4 RETURNING *`;
      finalScoreRecord = await queryOne(updateSql, [latestBaseResume.id, score, JSON.stringify(breakdown), existingScore.id]);
    } else {
      const insertSql = `INSERT INTO job_match_scores (job_id, candidate_id, base_resume_id, score, breakdown) VALUES ($1, $2, $3, $4, $5) RETURNING *`;
      finalScoreRecord = await queryOne(insertSql, [job_id, candidate_id, latestBaseResume.id, score, JSON.stringify(breakdown)]);
    }

    return NextResponse.json(finalScoreRecord);

  } catch (error: any) {
    console.error("Match score error:", error);
    if (job_id && candidate_id) {
      try {
        const errorRecord = await storeErrorScore(
          job_id,
          candidate_id,
          `Error: ${error.message || "Unknown error during score generation"}`
        );
        if (errorRecord) return NextResponse.json(errorRecord);
      } catch (dbError) {
        console.error("Failed to store match score error record:", dbError);
      }
    }
    return NextResponse.json({ error: error.message || "Score generation failed" }, { status: 500 });
  }
}
