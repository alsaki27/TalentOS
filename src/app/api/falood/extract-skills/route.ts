// src/app/api/falood/extract-skills/route.ts
// TypeScript port of resumify-next/api/ai.py /api/extract-skills endpoint

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured on the server." },
      { status: 500 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const jobDescription = body.jobDescription;
  if (!jobDescription) {
    return NextResponse.json({ error: "Missing job description" }, { status: 400 });
  }

  const systemPrompt = `You are an expert at extracting information from job descriptions.
Your goal is to extract the explicitly required or preferred skills as an array of concise strings (e.g., "Python", "React"), AND to extract the name of the hiring company. If the company name is not found, return null.

Output strictly valid JSON in the following format:
{
    "companyName": "Company Name",
    "skills": ["Skill 1", "Skill 2"]
}`;

  try {
    const model = process.env.FALOOD_OPENAI_MODEL || "gpt-5.4-mini";
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: jobDescription },
      ],
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
    }

    try {
      const skillsData = JSON.parse(content);
      return NextResponse.json(skillsData);
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }
  } catch (e: any) {
    console.error("Error calling OpenAI API:", e);
    return NextResponse.json({ error: e.message || "OpenAI API error" }, { status: 500 });
  }
}
