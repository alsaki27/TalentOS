// src/lib/ai/faloodApplicationTailoring.ts
// Closes the real gap found in the Phase 2-6 audit: /api/resume-suggestions POST only
// ever accepted a suggestion handed to it by the client — nothing actually generated
// suggestions from the approved JD keywords + evidence bank, so the brief's core
// Grammarly-style feature had no AI behind it. This module is that AI: given an
// application resume version, it reads only APPROVED keywords (never rejected ones —
// "the system should not inject rejected keywords" is enforced by simply never handing
// rejected keywords to the model), the candidate's evidence bank, and the current
// resume content, then proposes specific bullet/skill edits.
//
// Like faloodBaseResume.ts, this NEVER writes application_resume_versions.content
// directly. It writes resume_suggestions rows with status='pending' — which IS the
// proposal object the brief describes; applying one is the existing, separate
// /api/resume-suggestions/[id]/apply endpoint (accept/reject/customize), unchanged.

import { supabase } from "@/lib/supabase";
import { getActiveProvider } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { FaloodCommandResult } from "@/lib/falood/types";

interface TailoringContext {
  applicationResume: { id: string; candidate_id: string; target_job_id: string; content: any };
  approvedKeywords: Array<{ id: string; keyword: string; category: string | null; importance: string | null }>;
  rejectedKeywords: string[];
  evidence: Array<{ title: string; description: string | null; related_skills: string[] | null }>;
  jdAnalysis: any;
}

async function gatherContext(applicationResumeId: string): Promise<TailoringContext | null> {
  const { data: appResume } = await supabase
    .from("application_resume_versions")
    .select("id, candidate_id, target_job_id, content")
    .eq("id", applicationResumeId)
    .single();
  if (!appResume) return null;

  const [{ data: targetJob }, { data: keywords }, { data: evidence }] = await Promise.all([
    supabase.from("target_jobs").select("parsed_description").eq("id", appResume.target_job_id).single(),
    supabase.from("job_keywords").select("id, keyword, category, importance").eq("target_job_id", appResume.target_job_id),
    supabase.from("candidate_evidence").select("title, description, related_skills").eq("candidate_id", appResume.candidate_id),
  ]);

  const keywordIds = (keywords ?? []).map((k: any) => k.id as string);
  const { data: approvals } = keywordIds.length
    ? await supabase.from("keyword_approvals").select("keyword_id, decision").in("keyword_id", keywordIds)
    : { data: [] as { keyword_id: string; decision: string }[] };

  const approvedIds = new Set((approvals ?? []).filter((a: any) => a.decision === "approved" || a.decision === "already_present").map((a: any) => a.keyword_id as string));
  const rejectedIds = new Set((approvals ?? []).filter((a: any) => a.decision === "rejected").map((a: any) => a.keyword_id as string));

  return {
    applicationResume: appResume,
    approvedKeywords: (keywords ?? []).filter((k: any) => approvedIds.has(k.id as string)),
    rejectedKeywords: (keywords ?? []).filter((k: any) => rejectedIds.has(k.id as string)).map((k: any) => k.keyword as string),
    evidence: evidence ?? [],
    jdAnalysis: targetJob?.parsed_description ?? null,
  };
}

function buildSuggestPrompt(ctx: TailoringContext): string {
  return [
    "You are Falood, a controlled resume-tailoring assistant. You propose edits; a human always reviews and accepts/rejects/customizes each one before anything is saved.",
    "Rules: never inject a rejected keyword. Never fabricate experience or claim a tool/skill the evidence bank doesn't support. Prefer concise, specific, technical bullets. Explain your reasoning for every suggestion.",
    "",
    `Approved keywords (safe to work toward, with evidence support where it exists): ${JSON.stringify(ctx.approvedKeywords.map((k) => k.keyword))}`,
    `Rejected keywords — DO NOT use these anywhere: ${JSON.stringify(ctx.rejectedKeywords)}`,
    `Job description analysis: ${JSON.stringify(ctx.jdAnalysis)}`,
    `Candidate evidence bank: ${JSON.stringify(ctx.evidence)}`,
    `Current resume content (ResumeDocument JSON): ${JSON.stringify(ctx.applicationResume.content)}`,
    "",
    "Propose 3-8 targeted suggestions. Each suggestion edits ONE existing bullet/skill-section/summary block (identify it by sectionType and the block's existing id from the content above) or proposes a new bullet within an existing experience block.",
    "Respond with ONLY this JSON array, no markdown fences, no other text:",
    '[{"sectionType": "summary"|"skills"|"experience"|"project"|"education", "targetBlockId": string, "originalText": string, "suggestedText": string, "reason": string, "confidenceScore": number (0-100), "truthRisk": "low"|"medium"|"high", "atsImpact": "low"|"medium"|"high"}]',
    "Return an empty array if no improvement is warranted.",
  ].join("\n");
}

export async function generateResumeSuggestions(applicationResumeId: string): Promise<{ created: number } | { error: string }> {
  const active = getActiveProvider();
  if (!active) return { error: "No AI provider configured (set ANTHROPIC_API_KEY or NVIDIA_API_KEY)." };

  const ctx = await gatherContext(applicationResumeId);
  if (!ctx) return { error: "Application resume version not found." };

  let suggestions: any[];
  try {
    const response = await active.provider.send({
      system: "You are Falood, a controlled resume-tailoring assistant. Respond with a raw JSON array only.",
      messages: [{ role: "user", content: [{ type: "text", text: buildSuggestPrompt(ctx) }] }],
      tools: [],
    });
    const raw = textOf(response.content).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    suggestions = JSON.parse(raw);
    if (!Array.isArray(suggestions)) suggestions = [];
  } catch (err: any) {
    return { error: err.message ?? "Suggestion generation failed" };
  }

  if (suggestions.length === 0) return { created: 0 };

  const rows = suggestions.map((s) => ({
    application_resume_id: applicationResumeId,
    section_type: s.sectionType ?? null,
    target_block_id: s.targetBlockId ?? null,
    original_text: s.originalText ?? "",
    suggested_text: s.suggestedText ?? "",
    reason: s.reason ?? null,
    confidence_score: typeof s.confidenceScore === "number" ? s.confidenceScore : null,
    truth_risk: s.truthRisk ?? null,
    ats_impact: s.atsImpact ?? null,
    status: "pending",
    created_by: "ai",
  }));

  const { error } = await supabase.from("resume_suggestions").insert(rows);
  if (error) return { error: error.message };
  return { created: rows.length };
}

export async function runApplicationTailoringCommand(opts: {
  applicationResumeId: string;
  command?: string;
  message?: string;
}): Promise<FaloodCommandResult | { error: string }> {
  const command = opts.command?.trim();

  if (command === "/suggest-edits" || command === "/inject-approved-keywords") {
    const result = await generateResumeSuggestions(opts.applicationResumeId);
    if ("error" in result) return result;
    return {
      message: result.created > 0
        ? `Generated ${result.created} suggestion(s) from your approved keywords and evidence bank. Review them in the suggestion panel — nothing is saved until you accept.`
        : "No improvements suggested — the resume already reflects the approved keywords well, or there isn't enough evidence to support new claims.",
      action: null,
      warnings: [],
    };
  }

  const active = getActiveProvider();
  if (!active) return { error: "No AI provider configured (set ANTHROPIC_API_KEY or NVIDIA_API_KEY)." };

  const ctx = await gatherContext(opts.applicationResumeId);
  if (!ctx) return { error: "Application resume version not found." };

  const instruction = command ? `Command: ${command}` : `User instruction: ${opts.message}`;
  const prompt = [
    "You are Falood, answering a question or giving advice about tailoring this resume for this job. You are NOT proposing a resume edit here — that only happens via /suggest-edits. Just answer/advise in plain text.",
    `Approved keywords: ${JSON.stringify(ctx.approvedKeywords.map((k) => k.keyword))}`,
    `Rejected keywords (never use): ${JSON.stringify(ctx.rejectedKeywords)}`,
    `Current resume content: ${JSON.stringify(ctx.applicationResume.content)}`,
    instruction,
  ].join("\n");

  try {
    const response = await active.provider.send({
      system: "You are Falood, a resume-tailoring assistant. Answer in plain text, concisely.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    return { message: textOf(response.content) || "(no response)", action: null, warnings: [] };
  } catch (err: any) {
    return { error: err.message ?? "Falood command failed" };
  }
}
