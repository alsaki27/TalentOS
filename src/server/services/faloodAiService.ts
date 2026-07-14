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
import { query } from "@/server/db/neon";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";

// The chat studio only has whatever was in the resumeData snapshot at
// session-creation time - it can't answer "pull education from her base
// resume" without actually being given that data. This loads the
// candidate's other base resumes as read-only reference context (distinct
// from `resume` - the one actually being edited - so the model can pull
// facts from them but the edits still target the active draft).
async function buildCandidateContext(candidateId: string | undefined): Promise<string> {
  if (!candidateId) return "";
  try {
    const rows = await query<{ id: string; name: string; content: any }>(
      "SELECT id, name, content FROM base_resumes WHERE candidate_id = $1",
      [candidateId]
    );
    if (rows.length === 0) return "";
    const normalized = rows.map((r) => {
      const parsed = typeof r.content === "string" ? JSON.parse(r.content) : r.content;
      return { name: r.name, resume: studioDocumentToResumeData(parsed) };
    });
    return `\n\nCANDIDATE'S BASE RESUMES ON FILE (read-only reference - pull facts like education/certifications/skills from these if the user asks for something missing from the current draft; never invent anything not present here):\n${JSON.stringify(normalized)}`;
  } catch (err) {
    console.error("[faloodAiService] buildCandidateContext failed (non-fatal):", err);
    return "";
  }
}

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
- If the user asks to add education (e.g. "pull education from her base resume", "add her degree"), use type "education_add". Pull the actual degree/institution/graduationYear from the CANDIDATE'S BASE RESUMES context if provided below - never invent a degree or school that isn't present there or already in the current resume. If no matching education data exists in either the current resume or the base-resume context, say so in your chat reply instead of fabricating a suggestion.

Default behavior:
- Do NOT suggest adding or modifying sections that do not currently exist in the resume (e.g., if there is no summary, do not suggest adding a summary) UNLESS the user explicitly asks you to.
- Do not change Personal Info or Education unless the user explicitly asks.
- When a CANDIDATE'S BASE RESUMES context block is provided below, you may use it as a factual source for any suggestion (education, certifications, skills, experience) the user asks you to pull in - but only ever suggest edits to the CURRENT RESUME JSON (the active draft), never to the reference base resumes themselves.

Ensure the length of rewritten bullet points is similar to the original to maintain formatting. Keep suggestions ATS-friendly and concise.
For experience edits, always set targetId to the experience item's id and include "original" when modifying/removing an existing bullet.

Output strictly valid JSON (no markdown fences, no explanation) in the following format:
{
    "suggestions": [
        {
            "id": "unique_id",
            "type": "experience" | "experience_add" | "experience_remove" | "skill" | "skill_remove" | "summary" | "skill_reorg" | "personal_info" | "education_add",
            "title": "Short title of suggestion",
            "description": "Reasoning for the suggestion",
            "original": "Original text (if applicable)",
            "suggested": "For summary/experience/personal_info/experience_add: a plain string. For skill/skill_remove: a JSON ARRAY of strings. For skill_reorg: an array of objects: [{\\"id\\": \\"cat1\\", \\"name\\": \\"Category Name\\", \\"skills\\": [\\"Skill 1\\"]}]. For education_add: a JSON ARRAY of objects: [{\\"degree\\": \\"...\\", \\"institution\\": \\"...\\", \\"graduationYear\\": \\"...\\", \\"location\\": \\"...\\"}]",
            "targetId": "For experience/experience_add/experience_remove: experience item id. For skill/skill_remove: skill category id. For personal_info: one of fullName|jobTitle|email|phone|location|website|linkedin|github|birthDate. Not used for education_add."
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
  userId?: string,
  candidateId?: string
): Promise<{ suggestions: FaloodSuggestion[] }> {
  const candidateContext = await buildCandidateContext(candidateId);
  const conversationContext = `
CURRENT RESUME JSON (the draft being edited - suggestions target this):
${JSON.stringify(resume)}

JOB DESCRIPTION (if provided by user in chat):
${jobDescription || "Not provided yet, infer from chat context."}${candidateContext}`;

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
