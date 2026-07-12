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
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { findResumeVersionById } from "@/server/repositories/applicationResumeVersionsRepository";
import { findTargetJobById } from "@/server/repositories/targetJobsRepository";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";
import { MISSION_CONTEXT } from "@/lib/ai/missionContext";
import { FaloodCommandResult } from "@/lib/falood/types";

interface TailoringContext {
  applicationResume: { id: string; candidate_id: string; target_job_id: string; content: any };
  approvedKeywords: Array<{ id: string; keyword: string; category: string | null; importance: string | null }>;
  rejectedKeywords: string[];
  evidence: Array<{ title: string; description: string | null; related_skills: string[] | null }>;
  jdAnalysis: any;
}

async function gatherContext(applicationResumeId: string): Promise<TailoringContext | null> {
  const appResume = await findResumeVersionById(applicationResumeId);
  if (!appResume) return null;

  const [targetJob, keywords, evidence] = await Promise.all([
    findTargetJobById(appResume.target_job_id),
    isNeon()
      ? query<{ id: string; keyword: string; category: string | null; importance: string | null }>(
          "SELECT id, keyword, category, importance FROM job_keywords WHERE target_job_id = $1",
          [appResume.target_job_id]
        )
      : supabase
          .from("job_keywords")
          .select("id, keyword, category, importance")
          .eq("target_job_id", appResume.target_job_id)
          .then((r: any) => r.data ?? []),
    isNeon()
      ? query<{ title: string; description: string | null; related_skills: string[] | null }>(
          "SELECT title, description, related_skills FROM candidate_evidence WHERE candidate_id = $1",
          [appResume.candidate_id]
        )
      : supabase
          .from("candidate_evidence")
          .select("title, description, related_skills")
          .eq("candidate_id", appResume.candidate_id)
          .then((r: any) => r.data ?? []),
  ]);

  const keywordIds = (keywords ?? []).map((k: any) => k.id as string);
  const approvals = keywordIds.length
    ? isNeon()
      ? await query<{ keyword_id: string; decision: string }>(
          "SELECT keyword_id, decision FROM keyword_approvals WHERE keyword_id::text = ANY($1)",
          [keywordIds]
        )
      : await supabase
          .from("keyword_approvals")
          .select("keyword_id, decision")
          .in("keyword_id", keywordIds)
          .then((r: any) => r.data ?? [])
    : [];

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
    MISSION_CONTEXT,
    "",
    "You are Falood, a controlled resume-tailoring assistant. You propose edits; a human reviews and accepts/rejects/customizes them before anything is saved - but per the constraints above, that review needs to be fast, so your confidenceScore and truthRisk fields are not just descriptive, they're what a human (or a batch \"accept all high-confidence\" action) uses to decide which suggestions need a close look and which don't. Score them honestly, not optimistically - an inflated confidenceScore on a suggestion that turns out wrong defeats the entire point of being able to trust the score.",
    "Rules: never inject a rejected keyword. Never fabricate experience or claim a tool/skill the evidence bank doesn't support. Prefer concise, specific, technical bullets. Explain your reasoning for every suggestion.",
    "confidenceScore guide: 90-100 only when the suggestion is a clear, low-risk improvement fully supported by the evidence bank or existing resume content (e.g. rewording an existing bullet to include an approved keyword the candidate already has evidence for). Lower scores for anything that rephrases significantly, makes a judgment call about emphasis, or touches a keyword with weak/missing evidence - those need a human's eyes, say so via the score rather than letting them slip through automated acceptance.",
    "truthRisk guide: \"high\" for any suggestion that touches a keyword with no evidence backing, even if the wording itself sounds plausible - the risk is about whether the claim is actually true, not about how the sentence reads.",
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
  const ctx = await gatherContext(applicationResumeId);
  if (!ctx) return { error: "Application resume version not found." };

  let suggestions: any[];
  try {
    const { result: response } = await callWithUsageTracking("application_tailoring", undefined, async (provider) => {
      return provider.send({
        system: "You are Falood, a controlled resume-tailoring assistant. Respond with a raw JSON array only.",
        messages: [{ role: "user", content: [{ type: "text", text: buildSuggestPrompt(ctx) }] }],
        tools: [],
      });
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

  if (isNeon()) {
    const columns = Object.keys(rows[0]);
    const values: (string | number | boolean | null)[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;
    for (const r of rows) {
      const rowPlaceholders: string[] = [];
      for (const col of columns) {
        rowPlaceholders.push(`$${paramIndex++}`);
        values.push((r as any)[col]);
      }
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    }
    const sql = `INSERT INTO resume_suggestions (${columns.join(", ")}) VALUES ${placeholders.join(", ")}`;
    await query(sql, values);
  } else {
    const { error } = await supabase.from("resume_suggestions").insert(rows);
    if (error) return { error: error.message };
  }

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

  const ctx = await gatherContext(opts.applicationResumeId);
  if (!ctx) return { error: "Application resume version not found." };

  // UI truthfulness notice: both copilot input areas are inside src/components/falood/ and
  // src/app/falood/ — restricted zones this commit cannot modify. Rian needs to add near the
  // input: "I'll rewrite your real experience — I won't add unverified claims." in
  // src/components/falood/resumify/components/preview/AiSuggestions.tsx:660 (placeholder)
  // and src/app/falood/studio/tailor/[id]/page.tsx:289 (description text).

  const instruction = command ? `Command: ${command}` : `User instruction: ${opts.message}`;
  const prompt = [
    MISSION_CONTEXT,
    "",
    "You are Falood, a controlled resume-tailoring assistant answering a question or giving advice about tailoring this resume for this job. You are NOT proposing a resume edit here — that only happens via /suggest-edits. Just answer/advise in plain text.",
    "",
    "CRITICAL TRUTHFULNESS CONSTRAINT: You may rephrase, reorganize, emphasize, and improve the wording of existing resume content, but you MUST REFUSE any request to add a skill, credential, employer, project, degree, certification, or quantified claim that is not already present in the candidate's resume or evidence. When refusing, explain politely: \"I don't see evidence of [X] in your background. Would you like to add it to your evidence first, or should I focus on skills you've already demonstrated?\" Never invent experience, even when directly asked.",
    "",
    `Approved keywords (evidence-supported): ${JSON.stringify(ctx.approvedKeywords.map((k) => k.keyword))}`,
    `Rejected keywords — never use these: ${JSON.stringify(ctx.rejectedKeywords)}`,
    `Candidate evidence bank: ${JSON.stringify(ctx.evidence)}`,
    `Current resume content: ${JSON.stringify(ctx.applicationResume.content)}`,
    instruction,
  ].join("\n");

  try {
    const { result: response } = await callWithUsageTracking("application_tailoring", undefined, async (provider) => {
      return provider.send({
        system: "You are Falood, a controlled resume-tailoring assistant who NEVER invents skills, credentials, experience, certifications, or any claim not supported by the candidate's evidence. Answer in plain text, concisely.",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        tools: [],
      });
    });
    return { message: textOf(response.content) || "(no response)", action: null, warnings: [] };
  } catch (err: any) {
    return { error: err.message ?? "Falood command failed" };
  }
}
