// AI calls for the Falood chatbot studio (/falood/studio/tailor/[id]).
// Previously src/app/api/falood/suggestions and .../extract-skills called
// OpenAI directly via a raw deployment credential, bypassing this app's
// entire multi-provider routing/key-management system entirely. Confirmed
// live: that key's OpenAI account is out of billing quota
// (insufficient_quota), so every chat message failed. Routed through
// callWithUsageTracking(...) - the same mechanism every other AI feature in
// the app uses - to get automatic fallback, usage tracking, and visibility
// in the AI Control Center. getFaloodSuggestions (the chat) uses the
// "base_resume_studio" automation (the same one the CLI-style base resume
// editor uses, configured with a working key at /admin/ai -> Agents &
// Routing) after the dedicated "falood_ai" automation's only configured
// route hit the same exhausted OpenAI key.

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

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

function safeJsonParse(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The model is asked to return strict JSON, but it doesn't always comply -
// when it declines to make a change (e.g. because doing so would fabricate
// something not in the resume/evidence), it replies in plain prose like
// "I cannot add that because...". A raw JSON.parse on that throws a
// SyntaxError and 500s the whole request, so the user just sees a generic
// error instead of the model's actual reasoning. Parse defensively: accept
// clean JSON, dig a JSON object out of surrounding prose if present, and
// otherwise treat the whole response as a conversational reply to show in
// the chat (with no suggestions to apply).
function parseSuggestionsResponse(raw: string): { suggestions: FaloodSuggestion[]; reply?: string } {
  const cleaned = stripFences(raw);

  const direct = safeJsonParse(cleaned);
  if (direct && Array.isArray(direct.suggestions)) {
    return { suggestions: direct.suggestions as FaloodSuggestion[] };
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const embedded = safeJsonParse(cleaned.slice(start, end + 1));
    if (embedded && Array.isArray(embedded.suggestions)) {
      const prose = cleaned.slice(0, start).trim();
      return { suggestions: embedded.suggestions as FaloodSuggestion[], reply: prose || undefined };
    }
  }

  // Pure conversational reply / refusal — surface it, don't crash.
  return { suggestions: [], reply: cleaned || "I couldn't produce any suggestions for that." };
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
- If the user asks to ADD a few skills, use type "skill" and include ONLY the new skills to add. Do NOT use "skill_reorg". Output a SEPARATE "skill" suggestion object for EACH individual skill - "suggested" MUST be a one-element array containing exactly that single skill, never multiple skills bundled into one suggestion. The user reviews and accepts skills one at a time, never as a batch.
- Only use "skill_reorg" if the user explicitly asks to reorganize/rewrite the entire skills section.
- If the user asks to REMOVE skills, use type "skill_remove" with the skills to remove.
- If the user asks to change Personal Info (name, title, email, phone, links, location), use type "personal_info" and set targetId to the exact field name.
- If the user asks to change Experience metadata (job title, company, location, start date, end date), use type "experience_info", set targetId to the experience item id, set "original" to the exact field name (jobTitle, company, location, startDate, endDate), and "suggested" to the new text.
- If the user asks to MODIFY or REWRITE an existing experience bullet/line, use type "experience", set "original" to the old bullet point text, and "suggested" to the new bullet point text. If modifying multiple bullets, output a SEPARATE suggestion object for EACH bullet. "suggested" MUST be a string, NEVER an array.
- If the user asks to ADD a new experience bullet/line, use type "experience_add". If adding multiple bullets, output a SEPARATE suggestion object for EACH bullet. "suggested" MUST be a string, NEVER an array.
- If the user asks to REMOVE an experience bullet/line, use type "experience_remove".
- If the user asks to ADD a whole new experience/job block, use type "experience_block_add". Set "suggested" to a JSON object: {"jobTitle": "...", "company": "...", "location": "...", "startDate": "...", "endDate": "...", "description": "...", "bulletPoints": ["..."]}.
- If the user asks to REMOVE an entire experience/job block, use type "experience_block_remove". Set targetId to the experience item id.
- If the user asks to add education (e.g. "pull education from her base resume", "add her degree"), use type "education_add". Pull the actual degree/institution/graduationYear from the CANDIDATE'S BASE RESUMES context if provided below - never invent a degree or school that isn't present there or already in the current resume. If no matching education data exists in either the current resume or the base-resume context, say so in your chat reply instead of fabricating a suggestion.
- CUSTOM SECTIONS: the resume JSON's "customSections" array holds user-defined sections beyond the standard ones (e.g. Languages, Awards, Publications, Volunteer Experience - any title the user chose). Treat each entry there exactly like any other real section - never say a custom section "doesn't exist" or can't be edited just because its title isn't one of the standard ones above.
  - If the user asks to CHANGE/REWRITE the content of an EXISTING custom section (match by its "title" in the customSections array, e.g. "update my Languages section" or "add Spanish to my Awards section"), use type "custom_section_edit". Set targetId to that section's "id" from the customSections array, set contextTitle to its exact "title", set "original" to its current "content", and set "suggested" to a JSON object: {"content": "the full new content text"}.
  - If the user asks to ADD a brand-new custom section that does not already exist in customSections (e.g. "add a Languages section", "add a Volunteer Experience section"), use type "custom_section_add". Set "suggested" to a JSON object: {"title": "the new section's title", "content": "the section content", "type": "bullets" or "paragraph"}. Use "bullets" when the content is naturally a list (one item per line) and "paragraph" for a single flowing block of text. Never add a custom section that already exists (by title, case-insensitive) - use custom_section_edit instead for those.

CRITICAL HISTORY RULE:
- ONLY address the user's LATEST message in the conversation history.
- Do NOT re-propose or repeat suggestions that you already made for previous messages. If a suggestion was accepted, it is already applied to the CURRENT RESUME JSON. If it was rejected, the user does not want it. You must completely ignore all past user requests in the history and focus ENTIRELY on executing the newest request.

Default behavior:
- Do NOT suggest adding or modifying sections that do not currently exist in the resume (e.g., if there is no summary, do not suggest adding a summary) UNLESS the user explicitly asks you to.
- Do not change Personal Info or Education unless the user explicitly asks.
- When a CANDIDATE'S BASE RESUMES context block is provided below, you may use it as a factual source for any suggestion (education, certifications, skills, experience) the user asks you to pull in - but only ever suggest edits to the CURRENT RESUME JSON (the active draft), never to the reference base resumes themselves.
- If the user asks what changes were made from their original resume (e.g., "what changed?", "what skills were added?"), compare the CURRENT RESUME JSON to the CANDIDATE'S BASE RESUMES and provide a clear, conversational summary of the differences in your reply. Do not output any JSON suggestions for this type of query unless they also asked for new edits.

CRITICAL BULLET POINT LENGTH RULE (applies to ALL experience bullet rewrites):
- Before writing the "suggested" text, mentally count the characters in the "original" text.
- The "suggested" rewrite MUST have a character count within ±10% of the original. This is non-negotiable.
- If the original bullet is 120 characters, the rewrite must be between 108 and 132 characters.
- If you cannot fit the improved content at the same length, TRIM words, combine phrases, or use abbreviations to stay within the ±10% window.
- NEVER produce a rewrite that is dramatically shorter than the original. A short rewrite leaves blank whitespace on the resume and breaks the layout.
- Keep suggestions ATS-friendly and concise.
For experience edits, always set targetId to the experience item's id and include "original" when modifying/removing an existing bullet.

Output strictly valid JSON (no markdown fences, no explanation) in the following format:
{
    "suggestions": [
        {
            "id": "unique_id",
            "type": "experience" | "experience_info" | "experience_block_add" | "experience_block_remove" | "experience_add" | "experience_remove" | "skill" | "skill_remove" | "summary" | "skill_reorg" | "personal_info" | "education_add" | "custom_section_edit" | "custom_section_add",
            "title": "Short title of suggestion",
            "contextTitle": "The exact name of the section or job role this change applies to (e.g., 'Experience: GIS Analyst', 'Technical Skills', 'Education: Bachelor of Science', or the exact title of a custom section e.g. 'Languages')",
            "description": "Reasoning for the suggestion",
            "original": "Original text (if applicable, or field name for experience_info, or the custom section's current content for custom_section_edit)",
            "suggested": "For summary/experience/personal_info/experience_add/experience_info: a plain string. For skill: a JSON ARRAY containing exactly ONE skill string (one suggestion per skill, never bundled). For skill_remove: a JSON ARRAY of strings. For skill_reorg: an array of objects. For education_add: a JSON ARRAY of objects. For experience_block_add: a JSON object. For custom_section_edit: a JSON object {\"content\": \"...\"}. For custom_section_add: a JSON object {\"title\": \"...\", \"content\": \"...\", \"type\": \"bullets\"|\"paragraph\"}.",
            "targetId": "For experience/experience_add/experience_remove/experience_info/experience_block_remove: experience item id. For skill/skill_remove: skill category id. For personal_info: field name. For custom_section_edit: that section's id from customSections."
        }
    ]
}`;

export interface FaloodSuggestion {
  id: string;
  type: string;
  title: string;
  contextTitle?: string;
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
): Promise<{ suggestions: FaloodSuggestion[]; reply?: string }> {
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

  const { result: response } = await callWithUsageTracking("base_resume_studio", { userId }, async (provider) => {
    return provider.send({
      system: `${SUGGESTIONS_SYSTEM_PROMPT}\n\n${conversationContext}`,
      messages: [{ role: "user", content: [{ type: "text", text: conversationText || "Please review my resume and suggest improvements." }] }],
      tools: [],
    });
  });

  return parseSuggestionsResponse(textOf(response.content));
}

// Precision rules mirror buildJobLensPrompt (src/lib/ai/application-agents/prompts/jobLens.ts)
// deliberately - that prompt is the proven, battle-tested extraction logic
// already relied on by the 4-agent pipeline. Reused here rather than
// re-derived, so the Falood Copilot's skill-gap suggestions hold the same
// precision bar: real, named technical requirements only, not generic filler.
const EXTRACT_SKILLS_SYSTEM_PROMPT = `You are an expert at extracting skill requirements from job descriptions, for a resume-tailoring tool. Precision matters: every skill you return may be suggested to a candidate as something to add to their resume, so accuracy directly affects whether that suggestion is actually useful.

Extract:
- requiredSkills: technical skills, tools, platforms, certifications, and methodologies the posting treats as must-haves - repeated multiple times, listed first, or marked "required"/"must have". Use the JD's EXACT product names and casing (e.g., "Vetro FiberMap" not "Vetro", "AutoCAD" not "autocad") - matching against a resume is verbatim. When the JD uses both an acronym and its spelled-out form (or clearly means both), include BOTH as separate entries (e.g., "OSP" and "Outside Plant", "GIS" and "Geographic Information Systems") - candidates and resumes are inconsistent about which form they use.
- preferredSkills: skills explicitly marked "preferred", "a plus", "bonus", or "nice to have". Never mix these into requiredSkills.
- companyName: the hiring company's name, or null if not stated.

Rules:
- Only extract concrete, checkable technical requirements - specific tools, languages, platforms, certifications, licenses, methodologies, or named systems. Do NOT extract generic soft skills ("communication", "teamwork", "problem-solving") or vague filler phrases unless the JD names them as an explicit, specific requirement (e.g., "Excellent written communication for client-facing documentation" is still too generic to extract; a named certification or a specific required tool is not).
- Do NOT invent or infer a skill the JD does not actually name, even if it seems implied by the role.
- Keep entries short (1-4 words) - a skill name or tool name, never a full sentence or JD excerpt.
- Deduplicate: each skill appears once, in whichever list (required or preferred) it most belongs to.

Output strictly valid JSON (no markdown fences, no explanation) in the following format:
{
    "companyName": "Company Name",
    "requiredSkills": ["Skill 1", "Skill 2"],
    "preferredSkills": ["Skill 3"]
}`;

export async function extractSkillsFromJobDescription(
  jobDescription: string,
  userId?: string
): Promise<{ companyName: string | null; skills: string[]; requiredSkills: string[]; preferredSkills: string[] }> {
  const { result: response } = await callWithUsageTracking("falood_ai", { userId }, async (provider) => {
    return provider.send({
      system: EXTRACT_SKILLS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: jobDescription }] }],
      tools: [],
    });
  });

  // Same defensive handling as the suggestions path: a non-JSON reply must
  // degrade to an empty result, not throw and 500 the request.
  const parsed = safeJsonParse(stripFences(textOf(response.content)));
  const requiredSkills = Array.isArray(parsed?.requiredSkills) ? parsed.requiredSkills.filter((s: unknown) => typeof s === "string") : [];
  const preferredSkills = Array.isArray(parsed?.preferredSkills) ? parsed.preferredSkills.filter((s: unknown) => typeof s === "string") : [];
  // Legacy shape some existing callers (falood/builder) still read directly -
  // required-first union, kept so nothing that reads `.skills` needs to change.
  const legacySkills = Array.isArray(parsed?.skills) ? parsed.skills.filter((s: unknown) => typeof s === "string") : [];
  return {
    companyName: typeof parsed?.companyName === "string" ? parsed.companyName : null,
    skills: requiredSkills.length > 0 || preferredSkills.length > 0 ? [...requiredSkills, ...preferredSkills] : legacySkills,
    requiredSkills,
    preferredSkills,
  };
}

// Mirrors how Resume Forge places skills (prompts/resumeForge.ts: "Use the
// base resume's own category names ... as the guide") - a skill-gap
// suggestion must land in the category it actually belongs to (e.g.
// "wastewater" under an OSP/civil-design category, not dumped into whichever
// category happens to be listed first), never a fixed position.
const CATEGORIZE_SKILLS_SYSTEM_PROMPT = `You are placing newly-suggested resume skills into the correct existing skill category on a candidate's resume.

You will receive a list of skills to place and a list of the resume's existing skill category names.

Rules:
- For each skill, choose the single existing category name it most naturally belongs to, based on what the category groups together (e.g. a CAD tool belongs with other design software, a documentation practice belongs with other documentation/QC skills).
- You MUST choose from the exact category names given - never invent a new one, never rename one.
- If a skill genuinely fits none of the categories well, choose the closest reasonable match rather than omitting it.

Output strictly valid JSON (no markdown fences, no explanation):
{
    "assignments": [{ "skill": "Skill 1", "category": "Exact Category Name" }]
}`;

/**
 * Maps each skill to the best-matching existing resume category name (not id -
 * the caller resolves that, since ids are React-side and category names are
 * duplicated between studio sessions). Skips the AI call entirely when there
 * is nothing to categorize or only one category exists (unambiguous).
 */
export async function categorizeSkillsIntoCategories(
  skills: string[],
  categoryNames: string[],
  userId?: string
): Promise<Record<string, string>> {
  if (skills.length === 0 || categoryNames.length === 0) return {};
  if (categoryNames.length === 1) {
    return Object.fromEntries(skills.map((s) => [s, categoryNames[0]]));
  }

  const { result: response } = await callWithUsageTracking("falood_ai", { userId }, async (provider) => {
    return provider.send({
      system: CATEGORIZE_SKILLS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ skills, categories: categoryNames }) }] }],
      tools: [],
    });
  });

  const parsed = safeJsonParse(stripFences(textOf(response.content)));
  const map: Record<string, string> = {};
  if (Array.isArray(parsed?.assignments)) {
    for (const a of parsed.assignments) {
      if (a && typeof a.skill === "string" && typeof a.category === "string") {
        map[a.skill] = a.category;
      }
    }
  }
  return map;
}
