import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";


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

export async function POST(req: NextRequest) {
  let job_id = "";
  let candidate_id = "";

  try {
    const body = await req.json();
    job_id = body.job_id;
    candidate_id = body.candidate_id;

    if (!job_id || !candidate_id) {
      return NextResponse.json({ error: "job_id and candidate_id are required" }, { status: 400 });
    }

    let baseResumes: any[] = [];
    const br = await queryOne("SELECT id, content FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1", [candidate_id]);
    if (br) baseResumes = [br];

    if (!baseResumes || baseResumes.length === 0) {
      const finalScoreRecord = await storeErrorScore(job_id, candidate_id, "Error: No base resume found for this candidate.");
      return NextResponse.json(finalScoreRecord);
    }

    const latestBaseResume = baseResumes[0];

    // 2. Check if a valid score already exists
    let existingScore = null;
    existingScore = await queryOne("SELECT * FROM job_match_scores WHERE job_id = $1 AND candidate_id = $2", [job_id, candidate_id]);

    if (existingScore && existingScore.base_resume_id === latestBaseResume.id) {
      return NextResponse.json(existingScore);
    }

    // 3. Fetch Job Description
    let jobDescText = "";
    const job = await queryOne("SELECT title, description_text, raw_description FROM jobs WHERE id = $1", [job_id]);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    jobDescText = job.description_text || job.raw_description || `Title: ${job.title}`;

    if (!jobDescText || jobDescText.trim().length === 0) {
      const finalScoreRecord = await storeErrorScore(job_id, candidate_id, "Error: Job has no description text to score against.");
      return NextResponse.json(finalScoreRecord);
    }

    // 4. Generate Score via the app's routed AI provider — this previously
    // called `new OpenAI(...)` directly against a hardcoded, quota-exhausted
    // OPENAI_API_KEY, bypassing the multi-provider routing/key-management
    // system every other AI feature uses (same root cause and same fix as
    // src/server/services/faloodAiService.ts). Confirmed live: every "Gen
    // Score" click failed with "429 You exceeded your current quota."
    const systemPrompt = `You are an unbiased, expert technical recruiter evaluating a candidate's fit for a job.
You must return your evaluation strictly as a JSON object with the following keys:
- "score": Integer from 0-100 representing the overall match.
- "skills_match": Integer from 0-100 representing hard skills overlap.
- "experience_match": Integer from 0-100 representing experience relevance.
- "reasoning": A brief, 1-2 sentence explanation of the score.

Strictness Rules:
1. Base your evaluation 100% strictly on the explicit evidence in the base resume versus the job description. Do not assume any skills or experience that are not explicitly mentioned.
2. Be completely unbiased and objective. Do NOT apply any leniency for transferable skills. If a required skill is missing, heavily penalize the score.
3. Calculate the match score rigorously based on the exact overlap of required skills, exact years of experience, and responsibilities.
4. Be realistic and extremely strict. A perfect 100 should only happen if the candidate meets every single requirement perfectly.

Output strictly valid JSON (no markdown fences, no explanation).`;

    const userPrompt = `Job Description:
${jobDescText}

Candidate Base Resume (JSON):
${JSON.stringify(latestBaseResume.content)}`;

    const { result: response } = await callWithUsageTracking("job_match_score", undefined, async (provider) => {
      return provider.send({
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
        tools: [],
        temperature: 0.1,
      });
    });

    const rawText = textOf(response.content).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const resultJson = JSON.parse(rawText || "{}");

    // Ensure types
    const score = parseInt(resultJson.score) || 0;
    const breakdown = {
      skills_match: parseInt(resultJson.skills_match) || 0,
      experience_match: parseInt(resultJson.experience_match) || 0,
      reasoning: resultJson.reasoning || "No reasoning provided.",
    };

    // 5. Store Score
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
