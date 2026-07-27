// Final Polish agent — applies reviewer feedback and runs final QA.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { FinalResumeSchema, type FinalResumeV1 } from "./schemas";
import { buildFinalPolishPrompt } from "./prompts/finalPolish";
import { textOf } from "@/lib/ai/provider";

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
    system: options.system_prompt ?? "You are Final Polish, an AI that applies reviewer feedback and produces a final resume. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildFinalPolishPrompt(ctx.job, ctx.baseResume, draft, review, jobAnalysis, ctx.sourceOfTruth),
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
  const validated = FinalResumeSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Final Polish output validation failed: ${validated.error}`);

  // ── DEBUG: Final Polish ─────────────────────────────────────────
  console.log("[Agent:FinalPolish] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:FinalPolish] validated final resume:", JSON.stringify(validated, null, 2));
  console.log("[Agent:FinalPolish] exportReady:", validated.exportReady);
  console.log("[Agent:FinalPolish] experience count:", validated.experience.length);
  console.log("[Agent:FinalPolish] experience roles with 0 bullets:", validated.experience.filter((e) => e.bullets.length === 0).map((e) => e.title));
  console.log("[Agent:FinalPolish] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  // -- Structural Protection: Forcefully restore dates and location from base resume --
  const baseContent = (ctx.baseResume as any)?.content ?? {};
  
  if (baseContent.personalInfo && (validated as any).personalInfo) {
    (validated as any).personalInfo = {
      ...(validated as any).personalInfo,
      fullName: baseContent.personalInfo.fullName ?? (validated as any).personalInfo.fullName,
      email: baseContent.personalInfo.email ?? (validated as any).personalInfo.email,
      phone: baseContent.personalInfo.phone ?? (validated as any).personalInfo.phone,
      location: baseContent.personalInfo.location ?? (validated as any).personalInfo.location,
      linkedin: baseContent.personalInfo.linkedin ?? (validated as any).personalInfo.linkedin,
      github: baseContent.personalInfo.github ?? (validated as any).personalInfo.github,
      website: baseContent.personalInfo.website ?? (validated as any).personalInfo.website,
    };
  }

  const baseExperience = baseContent.experience ?? [];
  if (Array.isArray(validated.experience) && Array.isArray(baseExperience)) {
    validated.experience.forEach((exp: any, i: number) => {
      // Try exact company match first
      let baseMatch = baseExperience.find((b: any) => 
        b.company && exp.company && b.company.toLowerCase().trim() === exp.company.toLowerCase().trim()
      );
      
      // If exact match fails, try fuzzy match
      if (!baseMatch) {
         baseMatch = baseExperience.find((b: any) => 
           b.company && exp.company && (b.company.toLowerCase().includes(exp.company.toLowerCase()) || exp.company.toLowerCase().includes(b.company.toLowerCase()))
         );
      }
      
      // If still no match, fallback to index matching if lengths are identical
      if (!baseMatch && validated.experience.length === baseExperience.length) {
         baseMatch = baseExperience[i];
      }

      if (baseMatch) {
        exp.startDate = baseMatch.startDate ?? null;
        exp.endDate = baseMatch.endDate ?? null;
        if (baseMatch.location !== undefined) {
          exp.location = baseMatch.location;
        }
      }
    });
  }

  if (Array.isArray(validated.education) && Array.isArray(baseContent.education)) {
    validated.education.forEach((edu: any) => {
      const baseMatch = baseContent.education.find((b: any) => 
        b.institution && edu.institution && b.institution.toLowerCase().trim() === edu.institution.toLowerCase().trim()
      );
      if (baseMatch) {
        edu.startDate = baseMatch.startDate ?? null;
        edu.endDate = baseMatch.endDate ?? null;
      }
    });
  }

  // ── BULLET SAFETY NET ───────────────────────────────────────────────────────
  // Defense in depth: if FinalPolish strips bullets from any role,
  // silently restore them from the draft (ResumeForge output) or base resume.
  // Never throw here — throwing causes a retry that also strips bullets.
  if (Array.isArray(validated.experience)) {
    const draftExperience: any[] = Array.isArray((draft as any)?.experience)
      ? (draft as any).experience
      : [];

    validated.experience.forEach((exp: any, i: number) => {
      const currentBullets: string[] = Array.isArray(exp.bullets) ? exp.bullets : [];
      if (currentBullets.length >= 3) return; // already fine

      // Step 1: try to restore from the draft (ResumeForge output) which had good bullets
      let sourceBullets: string[] = [];
      const draftMatch: any =
        draftExperience.find((d: any) =>
          d.company && exp.company &&
          d.company.toLowerCase().trim() === exp.company.toLowerCase().trim()
        ) ??
        draftExperience.find((d: any) =>
          d.company && exp.company &&
          (d.company.toLowerCase().includes(exp.company.toLowerCase()) ||
           exp.company.toLowerCase().includes(d.company.toLowerCase()))
        ) ??
        (validated.experience.length === draftExperience.length ? draftExperience[i] : undefined);

      if (draftMatch && Array.isArray(draftMatch.bullets) && draftMatch.bullets.length > 0) {
        sourceBullets = draftMatch.bullets.filter((b: unknown): b is string => typeof b === "string" && !!b.trim());
      }

      // Step 2: fall back to base resume bullets if draft also had none
      if (sourceBullets.length === 0) {
        const baseMatch: any =
          baseExperience.find((b: any) =>
            b.company && exp.company &&
            b.company.toLowerCase().trim() === exp.company.toLowerCase().trim()
          ) ??
          baseExperience.find((b: any) =>
            b.company && exp.company &&
            (b.company.toLowerCase().includes(exp.company.toLowerCase()) ||
             exp.company.toLowerCase().includes(b.company.toLowerCase()))
          ) ??
          (validated.experience.length === baseExperience.length ? baseExperience[i] : undefined);

        if (baseMatch) {
          const rawBase: unknown[] = Array.isArray(baseMatch.bullets)
            ? baseMatch.bullets
            : Array.isArray(baseMatch.bulletPoints)
            ? baseMatch.bulletPoints
            : [];
          sourceBullets = rawBase
            .map((b) => {
              if (typeof b === "string" && b.trim()) return b.trim();
              if (b && typeof b === "object" && !Array.isArray(b)) {
                const o = b as Record<string, unknown>;
                const t = o.text ?? o.content ?? o.description ?? "";
                if (typeof t === "string" && t.trim()) return t.trim();
              }
              return null;
            })
            .filter((b): b is string => b !== null);
        }
      }

      if (sourceBullets.length > 0) {
        const merged = [...currentBullets];
        for (const sb of sourceBullets) {
          if (merged.length >= Math.max(3, currentBullets.length)) break;
          const isDupe = merged.some(
            (m) => m.toLowerCase().slice(0, 40) === sb.toLowerCase().slice(0, 40)
          );
          if (!isDupe) merged.push(sb);
        }
        exp.bullets = merged;
        console.warn(
          `[Agent:FinalPolish] BULLET GUARD restored bullets for "${exp.title}" (was ${currentBullets.length}, now ${merged.length})`
        );
      }
    });
  }
  // ────────────────────────────────────────────────────────────────────────────

  return validated;
}
