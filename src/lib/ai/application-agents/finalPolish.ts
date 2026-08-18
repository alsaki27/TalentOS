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
  readBaseSummary,
} from "./resumeIntegrity";
import { finalResumeToStudioDocument, type RenderableResumeContent } from "./finalResumeToStudioDocument";
import { renderResumePdfWithMetrics, type ResumePageMetrics } from "@/lib/falood/skarionPdfDocument";
import { normalizeResumeContentForExport } from "@/lib/falood/resumeDocumentAdapters";
import { mapMetricsToPageFit, MAX_UTILIZATION } from "@/lib/falood/pageFitThresholds";

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

// Renders the polished resume through the same PDF renderer the actual
// export path uses, so page-fit is measured, not guessed. Must never throw -
// a rendering failure degrades to no metrics rather than failing the stage.
function renderPolishMetrics(resume: RenderableResumeContent, baseContent: any): ResumePageMetrics | null {
  try {
    const studioDoc = finalResumeToStudioDocument(resume, baseContent ?? {});
    return renderResumePdfWithMetrics(normalizeResumeContentForExport(studioDoc)).metrics;
  } catch (err) {
    console.warn("[Agent:FinalPolish] Page-fit rendering failed, proceeding without metrics:", (err as Error)?.message);
    return null;
  }
}

function jobKeywords(jobAnalysis: any): string[] {
  return [
    ...(Array.isArray(jobAnalysis?.requiredSkills) ? jobAnalysis.requiredSkills : []),
    ...(Array.isArray(jobAnalysis?.atsKeywords) ? jobAnalysis.atsKeywords : []),
  ].filter((k): k is string => typeof k === "string" && k.trim().length > 0);
}

/**
 * Bounded, deterministic, code-only trim - no LLM call, so it can never
 * violate "never remove an entire role" the way a second freeform LLM pass
 * risks doing. Removes at most one low-value bullet per role (a bullet
 * counts as low-value only if it has no digit AND matches none of the job's
 * required skills/ATS keywords - which means any quantified bullet is never
 * touched here at all, a stricter guarantee than "never the role's only
 * quantified bullet"), and at most one keyword-unmatched skill from the
 * lowest-priority skill group. Never invents content - this function only
 * ever removes, never adds or rewrites.
 */
export function applyDeterministicTrim(resume: FinalResumeV1, jobAnalysis: any): void {
  const keywords = jobKeywords(jobAnalysis);
  const hasDigit = (text: string) => /\d/.test(text);
  const matchesKeyword = (text: string) => {
    const lower = text.toLowerCase();
    return keywords.some((k) => lower.includes(k.toLowerCase()));
  };
  const isLowValue = (text: string) => !hasDigit(text) && !matchesKeyword(text);

  for (let roleIndex = 0; roleIndex < resume.experience.length; roleIndex++) {
    const exp = resume.experience[roleIndex];
    const floor = getMinBullets(roleIndex);
    if (exp.bullets.length <= floor) continue; // no slack to trim
    const removeIndex = exp.bullets.findIndex(isLowValue);
    if (removeIndex !== -1) exp.bullets.splice(removeIndex, 1);
  }

  for (const group of resume.skills) {
    const seen = new Set<string>();
    group.skills = group.skills.filter((s) => {
      const key = s.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const lastGroup = resume.skills[resume.skills.length - 1];
  if (lastGroup && lastGroup.skills.length > 1) {
    const unmatchedIndex = lastGroup.skills.findIndex((s) => !matchesKeyword(s));
    if (unmatchedIndex !== -1) lastGroup.skills.splice(unmatchedIndex, 1);
  }
}

export async function runFinalPolish(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<FinalResumeV1> {
  const jobAnalysis = ctx.previousOutputs["application_job_lens"]?.data ?? {};
  const draft = ctx.previousOutputs["application_resume_forge"]?.data ?? {};
  const review = ctx.previousOutputs["application_hiring_panel"]?.data ?? {};

  const rawBaseContentForPrompt = (ctx.baseResume as any)?.content;
  const baseContent = rawBaseContentForPrompt && typeof rawBaseContentForPrompt === "object" && !Array.isArray(rawBaseContentForPrompt)
    ? rawBaseContentForPrompt
    : {};
  const draftPageMetrics = renderPolishMetrics(draft as RenderableResumeContent, baseContent);

  // ── DEBUG: Final Polish ─────────────────────────────────────────
  console.log("[Agent:FinalPolish] ── INPUT ────────────────────────────────────");
  console.log("[Agent:FinalPolish] jobAnalysis (from JobLens):", JSON.stringify(jobAnalysis, null, 2));
  console.log("[Agent:FinalPolish] draft (from ResumeForge):", JSON.stringify(draft, null, 2));
  console.log("[Agent:FinalPolish] review (from HiringPanel):", JSON.stringify(review, null, 2));
  console.log("[Agent:FinalPolish] draftPageMetrics (measured):", JSON.stringify(draftPageMetrics, null, 2));
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
              ctx.sourceOfTruth,
              draftPageMetrics
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

  // baseContent was already computed above (before the LLM call, to measure
  // the draft's page-fit for the prompt) - reused here rather than recomputed.

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

  // ── PROFESSIONAL SUMMARY GUARD ───────────────────────────────────────────
  // Same base-driven rule as Resume Forge: a summary is allowed only when the
  // base resume has one. If Final Polish dropped it, restore from the draft
  // (Resume Forge's tailored summary) or, failing that, the base resume
  // verbatim. If the base resume has no summary, force null.
  const baseSummaryText = readBaseSummary(baseContent);
  const draftSummaryText = typeof (draft as any)?.summary === "string" ? String((draft as any).summary).trim() : "";
  if (baseSummaryText) {
    if (!validated.summary || !validated.summary.trim()) {
      validated.summary = draftSummaryText || baseSummaryText;
      console.warn("[Agent:FinalPolish] SUMMARY GUARD: restored professional summary (AI returned none)");
    }
  } else {
    validated.summary = null;
  }

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

  // ── PAGE FIT QA (measured, bounded) ─────────────────────────────
  // Re-render once after the integrity/bullet-safety-net edits above to see
  // the real, current page fit; if it overflows or is packed too tight,
  // apply exactly one bounded deterministic trim pass and re-measure once
  // more. Never loop back into the LLM here - a second freeform pass risks
  // violating "never remove an entire role" more than deterministic code
  // does. Give up gracefully (exportReady: false + a warning) rather than
  // retrying indefinitely.
  const metricsBefore = renderPolishMetrics(validated, baseContent);
  if (metricsBefore) {
    validated.pageFit = mapMetricsToPageFit(metricsBefore);
    if (metricsBefore.overflow || metricsBefore.contentUtilization > MAX_UTILIZATION) {
      applyDeterministicTrim(validated, jobAnalysis);
      const metricsAfter = renderPolishMetrics(validated, baseContent);
      if (metricsAfter) validated.pageFit = mapMetricsToPageFit(metricsAfter);
      if (!metricsAfter || metricsAfter.overflow || !metricsAfter.readable) {
        validated.exportReady = false;
        validated.unresolvedWarnings = [
          ...validated.unresolvedWarnings,
          "Resume still overflows one page after automated trimming — needs manual review.",
        ];
      }
    } else if (!metricsBefore.readable) {
      validated.exportReady = false;
      validated.unresolvedWarnings = [
        ...validated.unresolvedWarnings,
        "Rendered font size is below the readability floor.",
      ];
    }
  } else {
    // Render failed — don't block the pipeline, but don't claim a page-fit
    // guarantee either.
    validated.pageFit = null;
  }
  // ───────────────────────────────────────────────────────────────

  return validated;
}
