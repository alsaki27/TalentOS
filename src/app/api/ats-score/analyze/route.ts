import { NextRequest, NextResponse } from "next/server";
import { execute, queryOne } from "@/server/db/neon";
import { 
  extractStructuredData, 
  computeDeterministicScore, 
  generateNarrative,
  filterMissingKeywords
} from "@/lib/atsScoring";

function stripPII(text: string): string {
  let safeText = text;
  // Strip email
  safeText = safeText.replace(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi, "[EMAIL]");
  // Strip phone numbers
  safeText = safeText.replace(/(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[PHONE]");
  // Strip addresses (very basic)
  safeText = safeText.replace(/\d{1,5}\s\w+\s\w+\s(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)/gi, "[ADDRESS]");
  return safeText;
}

export async function POST(req: NextRequest) {
  try {
    const { candidate_id, resume_id, resume_type, job_id } = await req.json();

    if (!candidate_id || !resume_id || !resume_type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // 1. Fetch Resume Text
    let resumeText = "";
    if (resume_type === "base") {
      const res = await queryOne("SELECT content FROM base_resumes WHERE id = $1", [resume_id]);
      if (!res) return NextResponse.json({ error: "Base resume not found" }, { status: 404 });
      resumeText = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    } else {
      const res = await queryOne("SELECT markdown_content FROM application_resume_versions WHERE id = $1", [resume_id]);
      if (!res) return NextResponse.json({ error: "Tailored resume not found" }, { status: 404 });
      resumeText = res.markdown_content || "";
    }

    if (!resumeText.trim()) {
      return NextResponse.json({ error: "Resume is empty" }, { status: 400 });
    }

    resumeText = stripPII(resumeText);

    // 2. Fetch Job Text (if job_id provided)
    let jobText = undefined;
    if (job_id) {
      const job = await queryOne("SELECT title, description_text, raw_description FROM jobs WHERE id = $1", [job_id]);
      if (job) {
        jobText = job.description_text || job.raw_description || `Title: ${job.title}`;
      }
    }

    // 3. Parseability Flags (Basic heuristics)
    let parseabilityScore = 100;
    const flags: string[] = [];
    if (resumeText.includes("|") && resumeText.split("|").length > 5) {
      flags.push("Possible tables or complex columns detected, which may confuse parsers.");
      parseabilityScore -= 10;
    }
    if (!resumeText.includes("@") && !resumeText.includes("[EMAIL]")) {
      flags.push("No email detected. Contact info might be in a header/footer block.");
      parseabilityScore -= 10;
    }
    
    // 4. Extraction
    const extraction = await extractStructuredData(resumeText, jobText);

    // 5. Deterministic Scoring
    const breakdown = computeDeterministicScore(extraction, parseabilityScore);

    // 6. Narrative Generation
    const rawNarrative = await generateNarrative(extraction, breakdown);

    // 6b. Post-process: cross-check AI missing-keyword list against the actual skills
    // extracted from the resume source data. Any keyword that fuzzy-matches a skill
    // already present in the candidate's data is removed — this prevents the AI from
    // falsely reporting keywords as "missing" when they actually exist in the resume.
    const narrative = filterMissingKeywords(rawNarrative, extraction.candidate.skills);

    // 7. Save to ats_score_evaluations
    const insertSql = `
      INSERT INTO ats_score_evaluations (
        candidate_id, resume_id, resume_type, job_id,
        overall_score, structured_extraction, deterministic_breakdown,
        narrative_feedback, parseability_flags, prompt_version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const savedRecord = await queryOne(insertSql, [
      candidate_id,
      resume_id,
      resume_type,
      job_id || null,
      breakdown.overallScore,
      JSON.stringify(extraction),
      JSON.stringify(breakdown),
      JSON.stringify(narrative),
      JSON.stringify(flags),
      "v1.0-structured"
    ]);

    return NextResponse.json({ success: true, data: savedRecord });
  } catch (err: any) {
    console.error("ATS Analysis Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
