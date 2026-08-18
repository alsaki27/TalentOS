// Resume Forge agent — produces an evidence-supported tailored draft.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { ResumeDraftSchema, type ResumeDraftV1 } from "./schemas";
import { buildResumeForgePrompt } from "./prompts/resumeForge";
import { textOf } from "@/lib/ai/provider";
import {
  enforceEducationIntegrity,
  enforceExperienceIntegrity,
  normalizeResumeBullet,
  readBaseSummary,
} from "./resumeIntegrity";

export async function runResumeForge(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<ResumeDraftV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};

  // ── DEBUG: Resume Forge ──────────────────────────────────────────
  const rawBaseContent = (ctx.baseResume as any)?.content;
  const baseContent = rawBaseContent && typeof rawBaseContent === "object" && !Array.isArray(rawBaseContent)
    ? rawBaseContent
    : {};
  const contentExperience: unknown[] = Array.isArray((baseContent as any).experience)
    ? (baseContent as any).experience
    : [];
  const baseExperience: unknown[] = contentExperience.length > 0
    ? contentExperience
    : Array.isArray(ctx.baseResume.experience) ? ctx.baseResume.experience : [];
  const promptText = buildResumeForgePrompt(
    ctx.job, 
    ctx.baseResume, 
    ctx.evidence, 
    jobAnalysis, 
    ctx.verifiedSkills,
    ctx.sourceOfTruth
  );

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

  // Base-resume identity is immutable. The AI may tailor bullets, but may not
  // add, drop, reorder, rename, relocate, or redate employment entries.
  const contentEducation: unknown[] = Array.isArray((baseContent as any).education)
    ? (baseContent as any).education
    : [];
  const baseEducation: unknown[] = contentEducation.length > 0
    ? contentEducation
    : Array.isArray(ctx.baseResume.education) ? ctx.baseResume.education : [];
  const basePersonalInfo = (baseContent as any).personalInfo;
  if (basePersonalInfo && typeof basePersonalInfo === "object" && !Array.isArray(basePersonalInfo)) {
    (validated as any).personalInfo = JSON.parse(JSON.stringify(basePersonalInfo));
  }
  validated.experience = enforceExperienceIntegrity(validated.experience, baseExperience);

  // ── BULLET SAFETY NET ─────────────────────────────────────────────────────
  // Defense in depth: if the AI returned fewer than the required minimum bullets
  // for any role, force-restore from the base resume. Fires silently — no throw,
  // no retry — so the resume always has content.
  //
  // Per-role minimum (must match buildBulletRequirements in prompts/resumeForge.ts):
  //   idx 0 (most recent) → 6   idx 1 → 4   idx ≥2 → 3
  const getMinBullets = (idx: number) => idx === 0 ? 6 : idx === 1 ? 4 : 3;

  if (Array.isArray(validated.experience) && Array.isArray(baseExperience)) {
    validated.experience.forEach((exp: any, i: number) => {
      const requiredMin = getMinBullets(i);
      const currentBullets: string[] = Array.isArray(exp.bullets) ? exp.bullets : [];
      if (currentBullets.length >= requiredMin) return; // already meets requirement

      // Experience integrity reconciliation keeps base and output in the same
      // order, so index matching is now deterministic and cannot hit a fake role.
      const baseMatch: any = baseExperience[i];

      if (baseMatch) {
        // Normalise base bullets from { text } objects or plain strings
        const rawBase: unknown[] = Array.isArray(baseMatch.bullets)
          ? baseMatch.bullets
          : Array.isArray(baseMatch.bulletPoints)
          ? baseMatch.bulletPoints
          : [];
        const baseBullets: string[] = rawBase
          .map(normalizeResumeBullet)
          .filter((b): b is string => b !== null);

        if (baseBullets.length > 0) {
          // Keep AI-generated bullets, then append base bullets until requiredMin is met
          const merged = [...currentBullets];
          for (const bb of baseBullets) {
            if (merged.length >= requiredMin) break;
            const isDupe = merged.some(
              (m) => normalizeResumeBullet(m)?.toLocaleLowerCase("en-US").slice(0, 40) === bb.toLocaleLowerCase("en-US").slice(0, 40)
            );
            if (!isDupe) merged.push(bb);
          }
          exp.bullets = merged;
          console.warn(
            `[Agent:ResumeForge] BULLET GUARD "${exp.title}": ${currentBullets.length} → ${merged.length} bullets (required min ${requiredMin})`
          );
        }
      }
    });
  }
  // Education identity and the complete graduation date (including month) are
  // also immutable and always come from the base resume.
  validated.education = enforceEducationIntegrity(validated.education, baseEducation);
  // ──────────────────────────────────────────────────────────────────────────

  // ── PROFESSIONAL SUMMARY GUARD ───────────────────────────────────────────
  // The summary follows the base resume: allowed only when the base has one.
  // If the AI dropped it or returned null, restore the base summary verbatim
  // (truthful by construction - it came from the candidate's own resume); if
  // the base resume has no summary, force null so nothing is ever invented.
  const baseSummaryText = readBaseSummary(baseContent);
  if (baseSummaryText) {
    if (!validated.summary || !validated.summary.trim()) {
      validated.summary = baseSummaryText;
      console.warn("[Agent:ResumeForge] SUMMARY GUARD: restored base professional summary (AI returned none)");
    }
  } else {
    validated.summary = null;
  }

  // ── DEBUG: Resume Forge ──────────────────────────────────────────
  console.log("[Agent:ResumeForge] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:ResumeForge] validated draft:", JSON.stringify(validated, null, 2));
  console.log("[Agent:ResumeForge] experience roles (count):", (validated as any).experience?.length ?? "N/A");
  console.log("[Agent:ResumeForge] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return validated;
}
