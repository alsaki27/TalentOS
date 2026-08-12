// Final Polish agent — applies reviewer feedback and runs final QA.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { FinalResumeSchema, type FinalResumeV1 } from "./schemas";
import { buildFinalPolishPrompt } from "./prompts/finalPolish";
import { textOf } from "@/lib/ai/provider";

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

/**
 * Normalise a raw bullet value that may be a plain string or a { text/content/description }
 * object (both formats appear in older base resumes and draft outputs).
 */
function normaliseBullet(b: unknown): string | null {
  if (typeof b === "string" && b.trim()) return b.trim();
  if (b && typeof b === "object" && !Array.isArray(b)) {
    const o = b as Record<string, unknown>;
    const t = o.text ?? o.content ?? o.description ?? "";
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return null;
}

/**
 * Find the base/draft experience entry that corresponds to the output experience
 * entry at position `idx`. Cascade: exact company match → fuzzy → index fallback.
 */
function findMatchingEntry(
  exp: any,
  idx: number,
  outputLen: number,
  sourceEntries: any[]
): any | undefined {
  return (
    sourceEntries.find(
      (s) =>
        s.company &&
        exp.company &&
        s.company.toLowerCase().trim() === exp.company.toLowerCase().trim()
    ) ??
    sourceEntries.find(
      (s) =>
        s.company &&
        exp.company &&
        (s.company.toLowerCase().includes(exp.company.toLowerCase()) ||
          exp.company.toLowerCase().includes(s.company.toLowerCase()))
    ) ??
    (outputLen === sourceEntries.length ? sourceEntries[idx] : undefined)
  );
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

  const baseContent = (ctx.baseResume as any)?.content ?? {};

  // ── PERSONAL INFO RESTORE ───────────────────────────────────────
  if (baseContent.personalInfo && Object.keys(baseContent.personalInfo).length > 0) {
    (validated as any).personalInfo = JSON.parse(JSON.stringify(baseContent.personalInfo));
  }

  const baseExperience: any[] = Array.isArray(baseContent.experience)
    ? baseContent.experience
    : [];

  // ── DATE / LOCATION RESTORE ─────────────────────────────────────
  if (Array.isArray(validated.experience) && baseExperience.length > 0) {
    validated.experience.forEach((exp: any, i: number) => {
      const baseMatch = findMatchingEntry(
        exp,
        i,
        validated.experience.length,
        baseExperience
      );
      if (baseMatch) {
        exp.startDate = baseMatch.startDate ?? null;
        exp.endDate = baseMatch.endDate ?? null;
        if (baseMatch.location !== undefined) {
          exp.location = baseMatch.location;
        }
      }
    });
  }

  // Education entries key on `school` and `graduationDate` - there is no
  // startDate/endDate on education at all (see EducationBlock in
  // src/lib/falood/types.ts and ResumeDraftV1/FinalResumeV1 in schemas.ts).
  // The previous version matched on `institution` (undefined on both sides,
  // so it never matched) and then restored startDate/endDate (fields that
  // don't exist on education), so this block was a complete no-op.
  if (Array.isArray(validated.education) && Array.isArray(baseContent.education)) {
    validated.education.forEach((edu: any) => {
      const baseMatch = baseContent.education.find(
        (b: any) =>
          b.school &&
          edu.school &&
          b.school.toLowerCase().trim() === edu.school.toLowerCase().trim()
      );
      if (baseMatch) {
        edu.graduationDate = baseMatch.graduationDate ?? edu.graduationDate ?? null;
      }
    });
  }

  // ── EDUCATION SAFETY NET ────────────────────────────────────────────────
  // Mirrors the ROLE SAFETY NET below: the schema accepts an empty education
  // array as valid, so nothing previously stopped FinalPolish from silently
  // dropping education entirely. Restore any base entries missing from the
  // final draft, matched by school name.
  if (Array.isArray(validated.education) && Array.isArray(baseContent.education)) {
    if (validated.education.length < baseContent.education.length) {
      console.warn(`[Agent:FinalPolish] EDUCATION GUARD: Restoring dropped education. Expected ${baseContent.education.length}, got ${validated.education.length}`);
      baseContent.education.forEach((baseEdu: any, idx: number) => {
        const found = validated.education.find((edu: any) =>
          edu.school && baseEdu.school && edu.school.toLowerCase().trim() === baseEdu.school.toLowerCase().trim()
        );
        if (!found) {
          validated.education.splice(idx, 0, JSON.parse(JSON.stringify(baseEdu)));
        }
      });
    }
  }

  // ── ROLE SAFETY NET ───────────────────────────────────────────────────────
  if (Array.isArray(validated.experience) && Array.isArray(baseExperience)) {
    if (validated.experience.length < baseExperience.length) {
      console.warn(`[Agent:FinalPolish] ROLE GUARD: Restoring dropped roles. Expected ${baseExperience.length}, got ${validated.experience.length}`);
      baseExperience.forEach((baseRole: any, idx: number) => {
        const found = validated.experience.find((exp: any) => 
          exp.company && baseRole.company && exp.company.toLowerCase().trim() === baseRole.company.toLowerCase().trim()
        ) ?? validated.experience.find((exp: any) => 
          exp.company && baseRole.company && (exp.company.toLowerCase().includes(baseRole.company.toLowerCase()) || baseRole.company.toLowerCase().includes(exp.company.toLowerCase()))
        );
        if (!found) {
          validated.experience.splice(idx, 0, JSON.parse(JSON.stringify(baseRole)));
        }
      });
    }
  }

  // ── BULLET SAFETY NET ───────────────────────────────────────────
  // Defense in depth: if FinalPolish strips bullets from any role,
  // silently restore from the draft (ResumeForge output) or base resume.
  // Never throw here — throwing causes retries that also strip bullets.
  //
  // Per-role minimum matches buildBulletRequirements (prompts/resumeForge.ts):
  //   idx 0 → 6   idx 1 → 4   idx ≥2 → 3
  if (Array.isArray(validated.experience)) {
    const draftExperience: any[] = Array.isArray((draft as any)?.experience)
      ? (draft as any).experience
      : [];

    validated.experience.forEach((exp: any, i: number) => {
      const requiredMin = getMinBullets(i);
      const currentBullets: string[] = Array.isArray(exp.bullets) ? exp.bullets : [];
      if (currentBullets.length >= requiredMin) return; // already meets requirement

      let sourceBullets: string[] = [];

      // Step 1 — restore from the draft (ResumeForge output already has bullets)
      const draftMatch = findMatchingEntry(
        exp,
        i,
        validated.experience.length,
        draftExperience
      );
      if (draftMatch && Array.isArray(draftMatch.bullets) && draftMatch.bullets.length > 0) {
        sourceBullets = draftMatch.bullets
          .map(normaliseBullet)
          .filter((b: string | null): b is string => b !== null);

      }

      // Step 2 — fall back to base resume bullets if draft also had none
      if (sourceBullets.length === 0 && baseExperience.length > 0) {
        const baseMatch = findMatchingEntry(
          exp,
          i,
          validated.experience.length,
          baseExperience
        );
        if (baseMatch) {
          const rawBase: unknown[] = Array.isArray(baseMatch.bullets)
            ? baseMatch.bullets
            : Array.isArray(baseMatch.bulletPoints)
            ? baseMatch.bulletPoints
            : [];
          sourceBullets = rawBase
            .map(normaliseBullet)
            .filter((b): b is string => b !== null);
        }
      }

      if (sourceBullets.length > 0) {
        const merged = [...currentBullets];
        for (const sb of sourceBullets) {
          if (merged.length >= requiredMin) break;
          const isDupe = merged.some(
            (m) => m.toLowerCase().slice(0, 40) === sb.toLowerCase().slice(0, 40)
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
