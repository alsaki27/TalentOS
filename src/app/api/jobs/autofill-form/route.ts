import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(cleaned || "{}") as T;
}

// Previously called `new OpenAI(...)` directly against a hardcoded, quota-
// exhausted OPENAI_API_KEY - same root cause as the Jobs match-score and
// ATS scoring bugs. Routed through callWithUsageTracking("job_autofill_form", ...).
export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Missing or invalid text to analyze" }, { status: 400 });
    }

    const systemPrompt = `You are an expert HR AI assistant. Analyze the raw job posting text and extract the basic details to populate a job creation form.
Return strictly a JSON object matching this schema (no markdown fences, no explanation):
{
  "title": "string (the job title, e.g., 'Software Engineer')",
  "company": "string (the company hiring)",
  "location": "string (e.g., 'New York, NY', 'Remote', 'Hybrid')",
  "description_text": "string (the core job description text. Clean up any weird formatting but keep it intact as readable text)"
}
If a field is completely missing and impossible to determine, use an empty string.`;

    const { result: aiResponse } = await callWithUsageTracking("job_autofill_form", undefined, async (provider) => {
      return provider.send({
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: text.trim().substring(0, 30000) }] }],
        tools: [],
        temperature: 0,
      });
    });

    const parsedData = parseJsonResponse<any>(textOf(aiResponse.content));

    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("AI autofill error:", error);
    return NextResponse.json({ error: error.message || "Failed to process text" }, { status: 500 });
  }
}
