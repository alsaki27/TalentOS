// src/app/api/falood/suggestions/route.ts
// TypeScript port of resumify-next/api/ai.py /api/suggestions endpoint
// Uses OpenAI SDK directly instead of proxying to a Python Flask server.

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

  const resumeData = body.resume;
  const jobDescription = body.jobDescription;
  const messages: { role: string; content: string }[] = body.messages ?? [];

  if (!resumeData) {
    return NextResponse.json({ error: "Missing resume data" }, { status: 400 });
  }

  const model = process.env.FALOOD_OPENAI_MODEL || "gpt-5.4-mini";

  const systemPrompt = `You are an expert resume optimizer and career coach. Your job is to propose specific, actionable resume edits that the user can accept or reject.

Focus on:
1. Experience bullet points: rewrite them to be more impactful, quantifying results where possible.
2. Skills: Suggest adding relevant skills.
   CRITICAL CONSTRAINT FOR SKILLS:
   - You must organize skills into EXACTLY 3 categories if you suggest a full skill overhaul.
   - If editing existing skills, ensure the final count adheres to:
     * MAX 8 skills in the first category.
     * MAX 8 skills in the second category.
     * MAX 5 skills in the third category.
   - Do NOT exceed these limits.

Do NOT fabricate experiences, employers, dates, credentials, tools, or metrics.
Be intent-aware based on the user's latest message:
- If the user asks to ADD a few skills, use type "skill" and include ONLY the new skills to add. Do NOT use "skill_reorg".
- Only use "skill_reorg" if the user explicitly asks to reorganize/rewrite the entire skills section.
- If the user asks to REMOVE skills, use type "skill_remove" with the skills to remove.
- If the user asks to change Personal Info (name, title, email, phone, links, location), use type "personal_info" and set targetId to the exact field name.
- If the user asks to ADD a new experience bullet/line, use type "experience_add".
- If the user asks to REMOVE an experience bullet/line, use type "experience_remove".

Default behavior: do not change Personal Info or Education unless the user explicitly asks.
Ensure the length of rewritten bullet points is similar to the original to maintain formatting. Keep suggestions ATS-friendly and concise.
For experience edits, always set targetId to the experience item's id and include "original" when modifying/removing an existing bullet.

Output strictly valid JSON in the following format:
{
    "suggestions": [
        {
            "id": "unique_id",
            "type": "experience" | "experience_add" | "experience_remove" | "skill" | "skill_remove" | "summary" | "skill_reorg" | "personal_info",
            "title": "Short title of suggestion",
            "description": "Reasoning for the suggestion",
            "original": "Original text (if applicable)",
            "suggested": "For summary/experience/personal_info/experience_add: a plain string. For skill/skill_remove: a JSON ARRAY of strings. For skill_reorg: an array of objects: [{\\"id\\": \\"cat1\\", \\"name\\": \\"Category Name\\", \\"skills\\": [\\"Skill 1\\"]}]",
            "targetId": "For experience/experience_add/experience_remove: experience item id. For skill/skill_remove: skill category id. For personal_info: one of fullName|jobTitle|email|phone|location|website|linkedin|github|birthDate"
        }
    ]
}`;

  const conversionContext = `
CURRENT RESUME JSON:
${JSON.stringify(resumeData)}

JOB DESCRIPTION (if provided by user in chat):
${jobDescription || "Not provided yet, infer from chat context."}`;

  const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    { role: "system", content: conversionContext },
  ];

  for (const msg of messages) {
    if ((msg as any).id === "welcome") continue;
    const role = msg.role as "user" | "assistant";
    const content = msg.content;
    if (role && content) {
      openaiMessages.push({ role, content });
    }
  }

  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });

    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: openaiMessages,
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "Empty response from AI" }, { status: 500 });
    }

    try {
      const suggestionsData = JSON.parse(content);
      return NextResponse.json(suggestionsData);
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 });
    }
  } catch (e: any) {
    console.error("Error calling OpenAI API:", e);
    return NextResponse.json({ error: e.message || "OpenAI API error" }, { status: 500 });
  }
}
