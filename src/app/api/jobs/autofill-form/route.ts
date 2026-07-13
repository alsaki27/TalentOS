import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import OpenAI from "openai";



export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing. Configure it to enable AI autofill." }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Missing or invalid text to analyze" }, { status: 400 });
    }

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert HR AI assistant. Analyze the raw job posting text and extract the basic details to populate a job creation form.
Return strictly a JSON object matching this schema:
{
  "title": "string (the job title, e.g., 'Software Engineer')",
  "company": "string (the company hiring)",
  "location": "string (e.g., 'New York, NY', 'Remote', 'Hybrid')",
  "description_text": "string (the core job description text. Clean up any weird formatting but keep it intact as readable text)"
}
If a field is completely missing and impossible to determine, use an empty string.`
        },
        {
          role: "user",
          content: text.trim().substring(0, 30000) // cap length to prevent token bloat
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });

    const parsedData = JSON.parse(aiResponse.choices[0].message.content || "{}");

    return NextResponse.json(parsedData);
  } catch (error: any) {
    console.error("AI autofill error:", error);
    return NextResponse.json({ error: error.message || "Failed to process text" }, { status: 500 });
  }
}
