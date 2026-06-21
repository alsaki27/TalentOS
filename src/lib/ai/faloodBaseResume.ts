// src/lib/ai/faloodBaseResume.ts
// Single-shot (no tool-calling) handler for Base Resume CLI Studio commands —
// /create-base, /make-skarion-style, /organize-skills, /improve-bullets, /truth-check,
// /add-projects, /remove-ai-slop, /shorten-section, /expand-section, /rewrite-summary,
// /explain, plus free-text chat instructions. Same generation pattern as
// src/lib/ai/digest.ts and the job categorization pass — no second turn for the model
// to degenerate on (see README/ROADMAP for why that pattern is avoided here).
//
// This NEVER writes to base_resumes.content. It returns a proposed FaloodAction; the
// caller (the API route) persists it to falood_messages for the log, and the client
// must call a separate, explicit "apply draft" endpoint to actually commit it. That
// separation is the literal enforcement of "AI suggests, human approves" for base
// resumes (see ROADMAP/PLAN — Architecture decision #9).

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { emptyResumeDocument, FaloodCommandResult, ResumeDocument, ResumeFormatting } from "@/lib/falood/types";

const PROMPTING_RULES = [
  "Do not fabricate experience.",
  "Do not add tools or skills unless they are supported by the candidate's evidence bank, uploaded resume, or explicit instruction.",
  "Keep the resume in the Skarion style described below.",
  "Prefer concise, high-impact bullets over long ones.",
  "Explain every major edit in your message.",
  "Separate content suggestions from formatting suggestions.",
  "Never silently delete important content — if removing something significant, say so explicitly in your message.",
  "Respect any prior rejected keywords or forbidden claims noted in context.",
  "Do not optimize for one-page fit during base resume creation — that only matters during final application prep (a later phase).",
  "If you are not confident a claim is true, flag it as a risk in your message instead of inventing supporting detail.",
].map((r, i) => `${i + 1}. ${r}`).join("\n");

const SKARION_STYLE_GUIDE = `Skarion resume format:
- Header: full name, then one line of "City, State | Phone | Email | LinkedIn | Portfolio/GitHub".
- Technical Skills: categorized into 4-7 named groups (e.g. for OSP/telecom: "Fiber Network Data & Analysis", "Fiber Optic Engineering & Telecom Knowledge", "GIS, Mapping & Engineering Tools", "Fiber Testing & Troubleshooting"; for software: "Programming Languages", "Backend & APIs", "Frontend", "Databases", "Cloud & DevOps"). Pick categories that fit the candidate's actual target industry.
- Professional Experience: Job Title / Company | Location / Month Year – Month Year, then action-oriented, specific, technical bullets, quantified only when evidence supports it. Not generic, not AI-sounding, not overstuffed.
- Projects: optional — include for entry-level/software candidates, omit for OSP candidates with sufficient work experience.
- Education: degree, university, graduation month/year, at the bottom.
- One page target eventually, but not enforced during base resume creation. No colors, no photos, no icons, ATS-friendly headings, no two-column layout.`;

interface BaseResumeContext {
  baseResume: { id: string; name: string; target_industry: string | null; target_roles: string[] | null; content: ResumeDocument; status: string };
  candidate: { id: string; name: string | null; email: string | null; phone: string | null; work_authorization: string | null; linkedin_url: string | null; github_url: string | null; portfolio_url: string | null };
  evidence: Array<{ title: string; description: string | null; related_skills: string[] | null; source_type: string; confidence_score: number | null }>;
  originalParsedResume: Record<string, unknown> | null;
  originalResumeFile: { filename: string; file_url: string } | null;
}

async function gatherContext(baseResumeId: string): Promise<BaseResumeContext | null> {
  const baseResume = isNeon()
    ? await queryOne<{ id: string; name: string; target_industry: string | null; target_roles: string[] | null; content: ResumeDocument; status: string; candidate_id: string }>(
        "SELECT * FROM base_resumes WHERE id = $1",
        [baseResumeId]
      )
    : await supabase
        .from("base_resumes")
        .select("id, name, target_industry, target_roles, content, status, candidate_id")
        .eq("id", baseResumeId)
        .single()
        .then((r: any) => r.data ?? null);
  if (!baseResume) return null;

  const [candidate, evidence, originalResume] = await Promise.all([
    findCandidateById(baseResume.candidate_id),
    isNeon()
      ? query<{ title: string; description: string | null; related_skills: string[] | null; source_type: string; confidence_score: number | null }>(
          "SELECT title, description, related_skills, source_type, confidence_score FROM candidate_evidence WHERE candidate_id = $1",
          [baseResume.candidate_id]
        )
      : supabase
          .from("candidate_evidence")
          .select("title, description, related_skills, source_type, confidence_score")
          .eq("candidate_id", baseResume.candidate_id)
          .then((r: { data: any[] | null }) => r.data ?? []),
    isNeon()
      ? queryOne<{ parsed_json: Record<string, unknown>; filename: string; file_url: string }>(
          "SELECT parsed_json, filename, file_url FROM resumes WHERE candidate_id = $1 AND is_original_upload = true ORDER BY created_at DESC LIMIT 1",
          [baseResume.candidate_id]
        )
      : supabase
          .from("resumes")
          .select("parsed_json, filename, file_url")
          .eq("candidate_id", baseResume.candidate_id)
          .eq("is_original_upload", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r: { data: { parsed_json: Record<string, unknown>; filename: string; file_url: string } | null }) => r.data ?? null),
  ]);

  if (!candidate) return null;

  return {
    baseResume,
    candidate,
    evidence: evidence ?? [],
    originalParsedResume: (originalResume?.parsed_json as Record<string, unknown>) ?? null,
    originalResumeFile: originalResume ? { filename: originalResume.filename, file_url: originalResume.file_url } : null,
  };
}

function buildPrompt(ctx: BaseResumeContext, command: string | undefined, userMessage: string | undefined): string {
  const instruction = command
    ? `Command: ${command}`
    : `User instruction: ${userMessage}`;

  const resumeSection = ctx.originalParsedResume
    ? `Original uploaded resume (parsed): ${JSON.stringify(ctx.originalParsedResume)}`
    : ctx.originalResumeFile
      ? `An original resume was uploaded (${ctx.originalResumeFile.filename}) but has not been parsed yet. If the user is asking to build from their resume, you can only work with the information provided in the prompt — you cannot access the file directly. Ask the user to paste their resume text if they want you to parse it.`
      : "No original resume has been uploaded for this candidate yet.";

  return [
    "You are Falood, a controlled resume-preparation assistant for Skarion's candidate placement workflow.",
    "You suggest. A human always approves before anything is saved. Follow these rules strictly:",
    PROMPTING_RULES,
    "",
    SKARION_STYLE_GUIDE,
    "",
    `Candidate: ${ctx.candidate.name}, target industry: ${ctx.baseResume.target_industry ?? "unspecified"}, target roles: ${(ctx.baseResume.target_roles ?? []).join(", ") || "unspecified"}.`,
    `Candidate contact: email=${ctx.candidate.email ?? "?"} phone=${ctx.candidate.phone ?? "?"} linkedin=${ctx.candidate.linkedin_url ?? "?"} github=${ctx.candidate.github_url ?? "?"} portfolio=${ctx.candidate.portfolio_url ?? "?"} work_authorization=${ctx.candidate.work_authorization ?? "?"}.`,
    resumeSection,
    `Evidence bank (${ctx.evidence.length} entries): ${JSON.stringify(ctx.evidence)}`,
    `Current base resume draft (ResumeDocument JSON): ${JSON.stringify(ctx.baseResume.content)}`,
    "",
    instruction,
    "",
    "Respond with ONLY this JSON object, no markdown fences, no other text:",
    '{"message": string, "action": {"type": "update_resume_document", "newContent": <full ResumeDocument JSON, same shape as the current draft above>, "reason": string} | null, "warnings": string[]}',
    "Set action to null only if no resume change is warranted (e.g. /explain, or a pure question). Always include the COMPLETE updated ResumeDocument in newContent when proposing a change, not a partial patch — the caller replaces the whole document with what you return.",
  ].join("\n");
}

function parseResult(raw: string): FaloodCommandResult {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  return {
    message: typeof parsed.message === "string" ? parsed.message : "(no message)",
    action: parsed.action && parsed.action.type === "update_resume_document"
      ? { type: "update_resume_document", newContent: parsed.action.newContent, reason: parsed.action.reason ?? "" }
      : parsed.action && parsed.action.type === "create_warning"
        ? { type: "create_warning", warningType: parsed.action.warningType ?? "truth_risk", message: parsed.action.message ?? "" }
        : null,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
  };
}

export async function runBaseResumeCommand(opts: {
  baseResumeId: string;
  command?: string;
  message?: string;
}): Promise<FaloodCommandResult | { error: string }> {
  const active = await getActiveProviderAsync();
  if (!active) return { error: "No AI provider configured (set ANTHROPIC_API_KEY, NVIDIA_API_KEY, or GOOGLE_API_KEY)." };

  const ctx = await gatherContext(opts.baseResumeId);
  if (!ctx) return { error: "Base resume not found." };

  const prompt = buildPrompt(ctx, opts.command, opts.message);

  try {
    const response = await active.provider.send({
      system: "You are Falood, a controlled resume assistant. Respond with raw JSON only, exactly matching the requested schema.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    return parseResult(textOf(response.content));
  } catch (err: any) {
    return { error: err.message ?? "Falood command failed" };
  }
}

export function buildSkeletonDocument(candidate: { name: string; email: string | null; phone: string | null; linkedin_url: string | null; github_url: string | null; portfolio_url: string | null }, formatting: ResumeFormatting): ResumeDocument {
  return emptyResumeDocument(
    {
      fullName: candidate.name,
      email: candidate.email ?? undefined,
      phone: candidate.phone ?? undefined,
      linkedin: candidate.linkedin_url ?? undefined,
      github: candidate.github_url ?? undefined,
      portfolio: candidate.portfolio_url ?? undefined,
    },
    formatting,
  );
}
