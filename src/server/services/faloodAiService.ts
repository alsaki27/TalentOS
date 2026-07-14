// AI calls for the Falood chatbot studio (/falood/studio/tailor/[id]).
// Previously src/app/api/falood/suggestions and .../extract-skills called
// OpenAI directly via a raw process.env.OPENAI_API_KEY, bypassing this app's
// entire multi-provider routing/key-management system entirely. Confirmed
// live: that key's OpenAI account is out of billing quota
// (insufficient_quota), so every chat message failed. Routed through the
// same callWithUsageTracking("falood_ai", ...) mechanism every other AI
// feature in the app uses instead - gets automatic fallback, usage
// tracking, and shows up in the AI Control Center like everything else.

import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

const SUGGESTIONS_SYSTEM_PROMPT = `You are an expert resume optimizer and career coach. Your job is to propose specific, actionable resume edits that the user can accept or reject.

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

Default behavior:
- Do NOT suggest adding or modifying sections that do not currently exist in the resume (e.g., if there is no summary, do not suggest adding a summary) UNLESS the user explicitly asks you to.
- Do not change Personal Info or Education unless the user explicitly asks.

Ensure the length of rewritten bullet points is similar to the original to maintain formatting. Keep suggestions ATS-friendly and concise.
For experience edits, always set targetId to the experience item's id and include "original" when modifying/removing an existing bullet.

Output strictly valid JSON (no markdown fences, no explanation) in the following format:
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

export interface FaloodSuggestion {
  id: string;
  type: string;
  title: string;
  description: string;
  original?: string;
  suggested: unknown;
  targetId?: string;
}

export async function getFaloodSuggestions(
  resume: unknown,
  jobDescription: string | undefined,
  messages: { role: string; content: string }[],
  userId?: string
): Promise<{ suggestions: FaloodSuggestion[] }> {
  const conversationContext = `
CURRENT RESUME JSON:
${JSON.stringify(resume)}

JOB DESCRIPTION (if provided by user in chat):
${jobDescription || "Not provided yet, infer from chat context."}`;

  const conversationText = messages
    .filter((m) => m && (m as any).id !== "welcome" && m.role && m.content)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  const { result: response } = await callWithUsageTracking("falood_ai", { userId }, async (provider) => {
    return provider.send({
      system: `${SUGGESTIONS_SYSTEM_PROMPT}\n\n${conversationContext}`,
      messages: [{ role: "user", content: [{ type: "text", text: conversationText || "Please review my resume and suggest improvements." }] }],
      tools: [],
    });
  });

  return parseJsonResponse<{ suggestions: FaloodSuggestion[] }>(textOf(response.content));
}

const EXTRACT_SKILLS_SYSTEM_PROMPT = `You are an expert at extracting information from job descriptions.
Your goal is to extract the explicitly required or preferred skills as an array of concise strings (e.g., "Python", "React"), AND to extract the name of the hiring company. If the company name is not found, return null.

Output strictly valid JSON (no markdown fences, no explanation) in the following format:
{
    "companyName": "Company Name",
    "skills": ["Skill 1", "Skill 2"]
}`;

export async function extractSkillsFromJobDescription(
  jobDescription: string,
  userId?: string
): Promise<{ companyName: string | null; skills: string[] }> {
  const { result: response } = await callWithUsageTracking("falood_ai", { userId }, async (provider) => {
    return provider.send({
      system: EXTRACT_SKILLS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: jobDescription }] }],
      tools: [],
    });
  });

  return parseJsonResponse<{ companyName: string | null; skills: string[] }>(textOf(response.content));
}
