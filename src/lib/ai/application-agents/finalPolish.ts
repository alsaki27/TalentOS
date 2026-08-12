// Final Polish agent — applies reviewer feedback and runs final QA.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { FinalResumeSchema, type FinalResumeV1 } from "./schemas";
import { buildFinalPolishPrompt } from "./prompts/finalPolish";
import { textOf } from "@/lib/ai/provider";
import {
  enforceEducationIntegrity,
  enforceExperienceIntegrity,
  normalizeResumeBullet,
} from "./resumeIntegrity";

/**
 * Per-role minimum bullet count.
 * MUST stay in sync with buildBulletRequirements() in prompts/resumeForge.ts.
 *   idx 0 (most recent role) → 6
 *   idx 1 (second role)      → 4
 *   idx ≥2 (older roles)     → 3
 */
function getMinBullets(roleIndex: number): number {
  if (roleIndex === 0) return 6;
  if (roleIndex === 1) return 4;
  return 3;
}

export async function runFinalPolish(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<FinalResumeV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};
  const draft = ctx.previousOutputs["application_resume_forge"]?.data ?? {};
  const review = ctx.previousOutputs["application_hiring_panel"]?.data ?? {};

  // ── DEBUG: Final Polish ─────────────────────────────────────────
  console.log("[Agent:FinalPolish] ── INPUT ────────────────────────────────────");
  console.log("[Agent:FinalPolish] jobAnalysis (from JobLens):", JSON.stringify(jobAnalysis, null, 2));
  console.log("[Agent:FinalPolish] draft (from ResumeForge):", JSON.stringify(draft, null, 2));
  console.log("[Agent:FinalPolish] review (from HiringPanel):", JSON.stringify(review, null, 2));
  console.log("[Agent:FinalPolish] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  const response = await provider.send({
    system:
      options.system_prompt ??
      "You are Final Polish, an AI that applies reviewer feedback and produces a final resume. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildFinalPolishPrompt(
              ctx.job,
              ctx.baseResume,
              draft,
              review,
              jobAnalysis,
              ctx.sourceOfTruth
            ),
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
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(stripped);
  const validated = FinalResumeSchema.parse(parsed);
  if ("error" in validated)
    throw new Error(`Final Polish output validation failed: ${validated.error}`);

  // ── DEBUG: Final Polish ─────────────────────────────────────────
  console.log("[Agent:FinalPolish] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:FinalPolish] validated final resume:", JSON.stringify(validated, null, 2));
  console.log("[Agent:FinalPolish] exportReady:", validated.exportReady);
  console.log("[Agent:FinalPolish] experience count:", validated.experience.length);
  console.log(
    "[Agent:FinalPolish] experience roles with 0 bullets:",
    validated.experience.filter((e) => e.bullets.length === 0).map((e) => e.title)
  );
  console.log("[Agent:FinalPolish] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  const rawBaseContent = (ctx.baseResume as any)?.content;
  const baseContent = rawBaseContent && typeof rawBaseContent === "object" && !Array.isArray(rawBaseContent)
    ? rawBaseContent
    : {};

  // ── PERSONAL INFO RESTORE ───────────────────────────────────────
  if ((baseContent as any).personalInfo && typeof (baseContent as any).personalInfo === "object" && !Array.isArray((baseContent as any).personalInfo)) {
    (validated as any).personalInfo = JSON.parse(JSON.stringify((baseContent as any).personalInfo));
  }

  const contentExperience: unknown[] = Array.isArray((baseContent as any).experience)
    ? (baseContent as any).experience
    : [];
  const baseExperience: unknown[] = contentExperience.length > 0
    ? contentExperience
    : Array.isArray(ctx.baseResume.experience) ? ctx.baseResume.experience : [];
  const contentEducation: unknown[] = Array.isArray((baseContent as any).education)
    ? (baseContent as any).education
    : [];
  const baseEducation: unknown[] = contentEducation.length > 0
    ? contentEducation
    : Array.isArray(ctx.baseResume.education) ? ctx.baseResume.education : [];

  // Reconcile against the base resume regardless of generated array length.
  // This removes fabricated replacement roles and restores the exact base
  // title, company, location, dates, education identity, and graduation month.
  validated.experience = enforceExperienceIntegrity(validated.experience, baseExperience);
  validated.education = enforceEducationIntegrity(validated.education, baseEducation);

  // ── BULLET SAFETY NET ───────────────────────────────────────────
  // Defense in depth: if FinalPolish strips bullets from any role,
  // silently restore from the draft (ResumeForge output) or base resume.
  // Never throw here — throwing causes retries that also strip bullets.
  //
  // Per-role minimum matches buildBulletRequirements (prompts/resumeForge.ts):
  //   idx 0 → 6   idx 1 → 4   idx ≥2 → 3
  if (Array.isArray(validated.experience)) {
    const rawDraftExperience: unknown[] = Array.isArray((draft as any)?.experience)
      ? (draft as any).experience
      : [];
    const draftExperience = enforceExperienceIntegrity(rawDraftExperience, baseExperience);

    validated.experience.forEach((exp: any, i: number) => {
      const requiredMin = getMinBullets(i);
      const currentBullets: string[] = Array.isArray(exp.bullets) ? exp.bullets : [];
      if (currentBullets.length >= requiredMin) return; // already meets requirement

      let sourceBullets: string[] = [];

      // Step 1 — restore from the draft (ResumeForge output already has bullets)
      const draftMatch = draftExperience[i];
      if (draftMatch && Array.isArray(draftMatch.bullets) && draftMatch.bullets.length > 0) {
        sourceBullets = draftMatch.bullets
          .map(normalizeResumeBullet)
          .filter((b: string | null): b is string => b !== null);

      }

      // Step 2 — fall back to base resume bullets if draft also had none
      if (sourceBullets.length === 0 && baseExperience.length > 0) {
        const baseMatch: any = baseExperience[i];
        if (baseMatch) {
          const rawBase: unknown[] = Array.isArray(baseMatch.bullets)
            ? baseMatch.bullets
            : Array.isArray(baseMatch.bulletPoints)
            ? baseMatch.bulletPoints
            : [];
          sourceBullets = rawBase
            .map(normalizeResumeBullet)
            .filter((b): b is string => b !== null);
        }
      }

      if (sourceBullets.length > 0) {
        const merged = [...currentBullets];
        for (const sb of sourceBullets) {
          if (merged.length >= requiredMin) break;
          const isDupe = merged.some(
            (m) => normalizeResumeBullet(m)?.toLocaleLowerCase("en-US").slice(0, 40) === sb.toLocaleLowerCase("en-US").slice(0, 40)
          );
          if (!isDupe) merged.push(sb);
        }
        exp.bullets = merged;
        console.warn(
          `[Agent:FinalPolish] BULLET GUARD "${exp.title}": ${currentBullets.length} → ${merged.length} bullets (required min ${requiredMin})`
        );
      }
    });
  }
  // ───────────────────────────────────────────────────────────────

  return validated;
}
