import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

const AUTOMATION_ID = "job_autofill";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Missing or invalid text to analyze" }, { status: 400 });
    }

    const systemPrompt =
      "You are an expert HR AI assistant. Analyze the raw job posting text and extract the basic details. Reply with valid JSON only, no markdown, no explanation.";

    const userPrompt = `Analyze the raw job posting text and extract the basic details to populate a job creation form.
Return strictly a JSON object matching this schema:
{
  "title": "string (the job title, e.g., 'Software Engineer')",
  "company": "string (the company hiring)",
  "location": "string (e.g., 'New York, NY', 'Remote', 'Hybrid')",
  "description_text": "string (the core job description text. Clean up any weird formatting but keep it intact as readable text)"
}
If a field is completely missing and impossible to determine, use an empty string.

RAW TEXT:
${text.trim().substring(0, 30000)}`;

    const { result, providerName, model } = await callWithUsageTracking(
      AUTOMATION_ID,
      undefined,
      async (provider) => {
        const response = await provider.send({
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
          tools: [],
          temperature: 0,
        });
        const raw = textOf(response.content);
        const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
        return JSON.parse(stripped);
      }
    );

    console.log(
      `[job-autofill] processed via ${providerName}${model ? `/${model}` : ""}`
    );

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("AI autofill error:", error);
    return NextResponse.json({ error: error.message || "Failed to process text" }, { status: 500 });
  }
}
