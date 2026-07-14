import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned || "{}") as T;
}

// Previously called `new OpenAI(...)` directly against a hardcoded, quota-
// exhausted OPENAI_API_KEY - same root cause as the Jobs match-score, ATS
// scoring, and autofill-form bugs. Routed through
// callWithUsageTracking("job_ai_analyze", ...).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const job = await queryOne(`SELECT id, description_text, notes, employment_type, seniority_level, salary_range, work_authorization FROM jobs WHERE id = $1`, [params.id]);

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const fullText = [job.description_text, job.notes].filter(Boolean).join("\n\n");
    if (!fullText.trim()) {
      return NextResponse.json({ error: "No description text to analyze" }, { status: 400 });
    }

    const systemPrompt = `You are an elite, top 1% expert HR data analyst AI with 100% precision. Analyze the entire job description text (including 'Basic Qualifications' and 'Preferred Qualifications') and extract the specified fields.
Return the result strictly as a JSON object (no markdown fences, no explanation) matching this exact schema:
{
  "employment_type": "string or null (e.g., Full-time, Contract)",
  "experience_required": "string or null (Deeply analyze the text to find ANY mention of experience required, including spelled-out numbers like 'Three or more years of experience' or implicit seniority. Summarize it concisely, e.g., '3+ years', 'Entry level', 'Senior'. If no experience is mentioned whatsoever, return null.)",
  "salary_range": "string or null",
  "work_auth": "string or null (e.g. US Citizen, Green Card)",
  "required_skills": ["string", "string"],
  "responsibilities": ["string", "string"],
  "qualifications": ["string", "string"],
  "job_summary": "string (A 2-3 line concise summary of the role)"
}
Do not hallucinate data. If a field is not mentioned, return null or an empty array. Be absolutely unbiased, highly rigorous, and double-check qualifications for experience requirements.`;

    const { result: aiResponse } = await callWithUsageTracking("job_ai_analyze", undefined, async (provider) => {
      return provider.send({
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: fullText }] }],
        tools: [],
      });
    });

    const parsedData = parseJsonResponse<any>(textOf(aiResponse.content));

    const updates: any = {
      parsed_description: parsedData
    };

    if (!job.employment_type && parsedData.employment_type) updates.employment_type = parsedData.employment_type;
    if (!job.salary_range && parsedData.salary_range) updates.salary_range = parsedData.salary_range;
    if (!job.seniority_level && parsedData.experience_required) updates.seniority_level = parsedData.experience_required;
    if ((!job.work_authorization || job.work_authorization === "unspecified") && parsedData.work_auth) {
      updates.work_authorization = parsedData.work_auth;
    }

    let updatedJob: any;
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(updates);
    values.push(params.id);
    updatedJob = await queryOne(`UPDATE jobs SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`, values);

    return NextResponse.json(updatedJob);
  } catch (error: any) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 });
  }
}
