// Resume Forge agent — produces an evidence-supported tailored draft.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { ResumeDraftSchema, type ResumeDraftV1 } from "./schemas";
import { buildResumeForgePrompt } from "./prompts/resumeForge";
import { textOf } from "@/lib/ai/provider";

export async function runResumeForge(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<ResumeDraftV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};

  // ── DEBUG: Resume Forge ──────────────────────────────────────────
  const baseContent = (ctx.baseResume as any)?.content ?? {};
  const baseExperience = baseContent?.experience ?? [];
  const promptText = buildResumeForgePrompt(ctx.job, ctx.baseResume, ctx.evidence, jobAnalysis, ctx.verifiedSkills);

  console.log("[Agent:ResumeForge] ── INPUT ────────────────────────────────────");
  console.log("[Agent:ResumeForge] baseResume raw DB fields:", Object.keys(ctx.baseResume as any));
  console.log("[Agent:ResumeForge] baseResume.content.experience (count):", baseExperience.length);
  baseExperience.forEach((exp: any, i: number) => {
    console.log(`[Agent:ResumeForge]   exp[${i}] title: ${exp.title} @ ${exp.company}`);
    console.log(`[Agent:ResumeForge]   exp[${i}] bullets (count): ${exp.bullets?.length ?? 0}`);
    (exp.bullets ?? []).forEach((b: any, j: number) => {
      const bulletText = typeof b === "string" ? b : b?.text ?? JSON.stringify(b);
      console.log(`[Agent:ResumeForge]     bullet[${j}]: ${bulletText?.slice(0, 120)}`);
    });
  });
  console.log("[Agent:ResumeForge] baseResume.content JSON char count:", JSON.stringify(baseContent).length);
  console.log("[Agent:ResumeForge] prompt BASE RESUME section (first 3000 chars sent to AI):");
  const baseResumeSection = promptText.slice(promptText.indexOf("BASE RESUME:"), promptText.indexOf("EVIDENCE BANK:"));
  console.log(baseResumeSection.slice(0, 3000));
  console.log("[Agent:ResumeForge] evidence (count):", ctx.evidence.length);
  console.log("[Agent:ResumeForge] verifiedSkills:", ctx.verifiedSkills);
  console.log("[Agent:ResumeForge] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  const response = await provider.send({
    system: options.system_prompt ?? "You are Resume Forge, an AI that tailors resumes using only supported evidence. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: promptText,
          },
        ],
      },
    ],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });

  const raw = textOf(response.content);
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const validated = ResumeDraftSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Resume Forge output validation failed: ${validated.error}`);

  // ── DEBUG: Resume Forge ──────────────────────────────────────────
  console.log("[Agent:ResumeForge] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:ResumeForge] validated draft:", JSON.stringify(validated, null, 2));
  console.log("[Agent:ResumeForge] experience roles (count):", (validated as any).experience?.length ?? "N/A");
  console.log("[Agent:ResumeForge] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return validated;
}
