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

  // -- Structural Protection: Forcefully restore dates, location, and personal info from base resume --
  const baseEducation = baseContent.education ?? [];
  const basePersonalInfo = baseContent.personalInfo ?? {};
  
  if (basePersonalInfo && (validated as any).personalInfo) {
    (validated as any).personalInfo = {
      ...(validated as any).personalInfo,
      fullName: basePersonalInfo.fullName ?? (validated as any).personalInfo.fullName,
      email: basePersonalInfo.email ?? (validated as any).personalInfo.email,
      phone: basePersonalInfo.phone ?? (validated as any).personalInfo.phone,
      location: basePersonalInfo.location ?? (validated as any).personalInfo.location,
      linkedin: basePersonalInfo.linkedin ?? (validated as any).personalInfo.linkedin,
      github: basePersonalInfo.github ?? (validated as any).personalInfo.github,
      website: basePersonalInfo.website ?? (validated as any).personalInfo.website,
    };
  }

  if (Array.isArray(validated.experience) && Array.isArray(baseExperience)) {
    validated.experience.forEach((exp: any, i: number) => {
      // Try exact company match first
      let baseMatch = baseExperience.find((b: any) => 
        b.company && exp.company && b.company.toLowerCase().trim() === exp.company.toLowerCase().trim()
      );
      
      // If exact match fails, try fuzzy match (e.g. includes)
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

      // Find the matching base entry (exact → fuzzy → index fallback)
      let baseMatch: any =
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
        // Normalise base bullets from { text } objects or plain strings
        const rawBase: unknown[] = Array.isArray(baseMatch.bullets)
          ? baseMatch.bullets
          : Array.isArray(baseMatch.bulletPoints)
          ? baseMatch.bulletPoints
          : [];
        const baseBullets: string[] = rawBase
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

        if (baseBullets.length > 0) {
          // Keep AI-generated bullets, then append base bullets until requiredMin is met
          const merged = [...currentBullets];
          for (const bb of baseBullets) {
            if (merged.length >= requiredMin) break;
            const isDupe = merged.some(
              (m) => m.toLowerCase().slice(0, 40) === bb.toLowerCase().slice(0, 40)
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
  // Education entries (both the base resume's EducationBlock in
  // src/lib/falood/types.ts and this schema's output) key on `school` and
  // `graduationDate` - there is no startDate/endDate on education at all.
  // The previous version matched on `institution` (undefined on both sides,
  // so it never matched) and then restored startDate/endDate (fields that
  // don't exist on education), so this block was a complete no-op.
  if (Array.isArray(validated.education) && Array.isArray(baseEducation)) {
    validated.education.forEach((edu: any) => {
      const baseMatch = baseEducation.find((b: any) =>
        b.school && edu.school && b.school.toLowerCase().trim() === edu.school.toLowerCase().trim()
      );
      if (baseMatch) {
        edu.graduationDate = baseMatch.graduationDate ?? edu.graduationDate ?? null;
      }
    });
  }

  // ── EDUCATION SAFETY NET ────────────────────────────────────────────────
  // The schema accepts an empty education
  // array as valid, so nothing previously stopped the AI from silently
  // dropping education entirely. Restore any base entries the draft is
  // missing, matched by school name.
  if (Array.isArray(validated.education) && Array.isArray(baseEducation)) {
    if (validated.education.length < baseEducation.length) {
      console.warn(`[Agent:ResumeForge] EDUCATION GUARD: Restoring dropped education. Expected ${baseEducation.length}, got ${validated.education.length}`);
      baseEducation.forEach((baseEdu: any, idx: number) => {
        const found = validated.education.find((edu: any) =>
          edu.school && baseEdu.school && edu.school.toLowerCase().trim() === baseEdu.school.toLowerCase().trim()
        );
        if (!found) {
          validated.education.splice(idx, 0, JSON.parse(JSON.stringify(baseEdu)));
        }
      });
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // ── DEBUG: Resume Forge ──────────────────────────────────────────
  console.log("[Agent:ResumeForge] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:ResumeForge] validated draft:", JSON.stringify(validated, null, 2));
  console.log("[Agent:ResumeForge] experience roles (count):", (validated as any).experience?.length ?? "N/A");
  console.log("[Agent:ResumeForge] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return validated;
}
