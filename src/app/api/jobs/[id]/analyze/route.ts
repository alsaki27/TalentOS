import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

const AUTOMATION_ID = "jd_analysis";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const job = await queryOne(
      `SELECT id, description_text, notes, employment_type, seniority_level, salary_range, work_authorization FROM jobs WHERE id = $1`,
      [params.id]
    );

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const fullText = [job.description_text, job.notes].filter(Boolean).join("\n\n");
    if (!fullText.trim()) {
      return NextResponse.json({ error: "No description text to analyze" }, { status: 400 });
    }

    const systemPrompt =
      "You are an elite, top 1% expert HR data analyst AI with 100% precision. Analyze the entire job description text and extract the specified fields. Reply with valid JSON only, no markdown, no explanation.";

    const userPrompt = `Analyze the entire job description text (including 'Basic Qualifications' and 'Preferred Qualifications') and extract the specified fields.
Return the result strictly as a JSON object matching this exact schema:
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
Do not hallucinate data. If a field is not mentioned, return null or an empty array. Be absolutely unbiased, highly rigorous, and double-check qualifications for experience requirements.

JOB DESCRIPTION:
${fullText}`;

    const { result, providerName, model } = await callWithUsageTracking(
      AUTOMATION_ID,
      undefined,
      async (provider) => {
        const response = await provider.send({
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
          tools: [],
        });
        const raw = textOf(response.content);
        const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        return JSON.parse(stripped);
      }
    );

    console.log(
      `[job-analyze] analyzed job ${params.id} via ${providerName}${model ? `/${model}` : ""}`
    );

    const parsedData = result;

    const updates: any = {
      parsed_description: parsedData
    };

    if (!job.employment_type && parsedData.employment_type) updates.employment_type = parsedData.employment_type;
    if (!job.salary_range && parsedData.salary_range) updates.salary_range = parsedData.salary_range;
    if (!job.seniority_level && parsedData.experience_required) updates.seniority_level = parsedData.experience_required;
    if ((!job.work_authorization || job.work_authorization === "unspecified") && parsedData.work_auth) {
      updates.work_authorization = parsedData.work_auth;
    }

    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(updates);
    values.push(params.id);
    const updatedJob = await queryOne(
      `UPDATE jobs SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );

    return NextResponse.json(updatedJob);
  } catch (error: any) {
    console.error("Analyze error:", error);
    return NextResponse.json({ error: error.message || "Analysis failed" }, { status: 500 });
  }
}
