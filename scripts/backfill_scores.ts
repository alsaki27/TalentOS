import { query, queryOne, execute } from "../src/server/db/neon";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function backfill() {
  console.log("Starting backfill for existing applications...");
  
  // 1. Get all existing applications
  const apps = await query<any>("SELECT job_id, candidate_id FROM applications");
  
  // 2. Get all existing match scores
  const scores = await query<any>("SELECT job_id, candidate_id FROM job_match_scores");
  const scoredSet = new Set(scores.map((s: any) => `${s.job_id}_${s.candidate_id}`));
  
  // 3. Filter apps
  const appsToScoreMap = new Map();
  for (const a of apps) {
    const key = `${a.job_id}_${a.candidate_id}`;
    if (!scoredSet.has(key)) {
      appsToScoreMap.set(key, a);
    }
  }
  
  const appsToScore = Array.from(appsToScoreMap.values());
  console.log(`Found ${appsToScore.length} unique job+candidate combinations missing a score.`);
  
  let success = 0;
  let failed = 0;
  
  for (const app of appsToScore) {
    const { job_id, candidate_id } = app;
    console.log(`Generating score for Job ${job_id} / Candidate ${candidate_id}...`);
    try {
      // Logic from API route
      const br = await queryOne<any>("SELECT id, content FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1", [candidate_id]);
      if (!br) {
        const errorBreakdown = {
          skills_match: 0,
          experience_match: 0,
          reasoning: "Error: No base resume found for this candidate.",
        };
        const insertSql = `
          INSERT INTO job_match_scores (job_id, candidate_id, base_resume_id, score, breakdown) 
          VALUES ($1, $2, null, -1, $3)
          ON CONFLICT (job_id, candidate_id) 
          DO UPDATE SET score = -1, base_resume_id = null, breakdown = $3, updated_at = now()`;
        await execute(insertSql, [job_id, candidate_id, JSON.stringify(errorBreakdown)]);
        failed++;
        console.log(` -> Failed: No base resume`);
        continue;
      }

      const job = await queryOne<any>("SELECT title, description_text, raw_description FROM jobs WHERE id = $1", [job_id]);
      const jobDescText = job?.description_text || job?.raw_description || `Title: ${job?.title}`;

      if (!jobDescText || jobDescText.trim().length === 0) {
        failed++;
        console.log(` -> Failed: No job description`);
        continue;
      }

      const prompt = `You are an unbiased, expert technical recruiter evaluating a candidate's fit for a job.
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

Job Description:
${jobDescText}

Candidate Base Resume (JSON):
${JSON.stringify(br.content)}`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      });

      const responseText = completion.choices[0]?.message?.content;
      if (!responseText) throw new Error("No response from OpenAI");
      
      const parsed = JSON.parse(responseText);

      const insertSql = `
        INSERT INTO job_match_scores (job_id, candidate_id, base_resume_id, score, breakdown) 
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (job_id, candidate_id) 
        DO UPDATE SET score = EXCLUDED.score, base_resume_id = EXCLUDED.base_resume_id, breakdown = EXCLUDED.breakdown, updated_at = now()`;
      await execute(insertSql, [job_id, candidate_id, br.id, parsed.score, JSON.stringify(parsed)]);

      success++;
      console.log(` -> Success! Score: ${parsed.score}`);
    } catch (e: any) {
      failed++;
      console.log(` -> Error: ${e.message}`);
    }
    
    // Add delay to avoid rate limits
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log(`Backfill complete. ${success} generated, ${failed} failed (due to missing base resumes or API errors).`);
}

backfill().catch(console.error);
