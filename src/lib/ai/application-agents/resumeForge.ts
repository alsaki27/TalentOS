// Resume Forge agent — produces an evidence-supported tailored draft.
//
// Also runs the job-analysis work that used to be its own "Job Lens" stage
// (folded in so the pipeline has one fewer stage; see the removed
// jobLens.ts). Two sub-parts, same as before the merge:
//   - job-only extraction (title, skills, tools, ATS keywords - everything
//     the posting alone determines), cached once per job in
//     jobs.job_analysis (093_job_analysis_cache.sql) so it isn't re-run by
//     every application against the same job.
//   - per-candidate requirementAnalysis (classifying those requirements
//     against THIS candidate's evidence), always run fresh - never cached,
//     since it depends on who's applying.
// Both now run under Resume Forge's own AgentOptions/provider (temperature,
// timeout, routing) rather than Job Lens's separate ones - one merged
// pipeline stage, one tracked provider call.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { ResumeDraftSchema, type ResumeDraftV1, JobAnalysisSchema, type JobAnalysisV1, type JobOnlyAnalysisV1 } from "./schemas";
import { RESUME_DRAFT_JSON_SCHEMA } from "./jsonSchemas";
import {
  buildResumeForgePrompt,
  buildResumeForgeMissedRetryPrompt,
} from "./prompts/resumeForge";
import { buildJobOnlyLensPrompt, buildRequirementAnalysisPrompt, resolveJobDescription } from "./prompts/jobLens";
import { textOf } from "@/lib/ai/provider";
import {
  enforceEducationIntegrity,
  enforceExperienceIntegrity,
  normalizeResumeBullet,
  readBaseSummary,
} from "./resumeIntegrity";
import {
  buildRequirementCoverage,
  listMissedSupported,
} from "./requirementCoverage";
import { validateEvidenceCitations } from "./evidenceAudit";
import { SCHEMA_VERSIONS } from "./constants";
import { execute } from "@/server/db/neon";

export interface ResumeForgeResult {
  jobAnalysis: JobAnalysisV1;
  draft: ResumeDraftV1;
}

/** Strip markdown fences and parse raw model text into JSON. */
function parseRawJson(raw: string): unknown {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(stripped);
}

// ── Job-analysis sub-step (formerly jobLens.ts) ──────────────────────────

/** Extracts everything from a validated JobAnalysisV1 except requirementAnalysis - the job-only subset that gets cached. */
function toJobOnly(validated: JobAnalysisV1): JobOnlyAnalysisV1 {
  const { requirementAnalysis, ...jobOnly } = validated;
  return jobOnly;
}

/** Robustly extracts a JSON object from provider text: strips markdown fences, then finds the outermost {...} to ignore any preamble/trailing commentary a fallback model adds. */
function extractJsonObjectForJobAnalysis(raw: string): unknown {
  let stripped = raw.trim();
  stripped = stripped.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    stripped = stripped.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(stripped);
}

/** Fills in title/company from the canonical job record when the model omits them - identity fields are authoritative from the DB, never worth failing the whole stage over. */
function withCanonicalJobIdentity(parsed: unknown, job: any): unknown {
  const canonicalTitle = typeof job?.title === "string" && job.title.trim()
    ? job.title.trim()
    : (typeof job?.job_title === "string" ? job.job_title.trim() : "");
  const canonicalCompany = typeof job?.company === "string" && job.company.trim()
    ? job.company.trim()
    : (typeof job?.company_name === "string" ? job.company_name.trim() : "Unknown company");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const p = parsed as Record<string, unknown>;
  return {
    ...p,
    title: typeof p.title === "string" && p.title.trim() ? p.title : canonicalTitle,
    company: typeof p.company === "string" && p.company.trim() ? p.company : canonicalCompany,
  };
}

/** Job-only extraction call (cache-miss path) - title, skills, tools, ATS keywords, everything the posting alone determines. */
async function extractJobOnlyAnalysis(provider: AiProvider, options: AgentOptions, job: any): Promise<JobOnlyAnalysisV1> {
  const response = await provider.send({
    system: "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildJobOnlyLensPrompt(job) }] }],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });
  const parsed = withCanonicalJobIdentity(extractJsonObjectForJobAnalysis(textOf(response.content)), job);
  const validated = JobAnalysisSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Job analysis validation failed: ${validated.error}`);
  return toJobOnly(validated);
}

/**
 * Analyzes the job and classifies its requirements against this candidate.
 * Formerly the standalone Job Lens stage - now runs at the top of Resume
 * Forge, under the same provider/options as the rest of this stage.
 */
async function analyzeJob(options: AgentOptions, provider: AiProvider, ctx: AgentContext): Promise<JobAnalysisV1> {
  // ROOT CAUSE #3 GUARD: if the job has no usable description, fail immediately
  // with a clear, actionable error rather than sending "No description available"
  // to the AI and burning an expensive call that returns empty/useless analysis.
  // That empty analysis then hard-fails the Hiring Panel quality gate (atsScore=0
  // against minimum_score=6.0) two stages later, wasting the full pipeline cost.
  const jobDescription = resolveJobDescription(ctx.job);
  if (!jobDescription || jobDescription === "No description available") {
    throw new Error(
      `Resume Forge failed: no job description found for "${ctx.job?.title ?? ctx.job?.id ?? "this job"}". ` +
      `Add description text (description_text or notes) to the job posting and retry.`
    );
  }

  const jobRow = ctx.job as any;
  const cachedAnalysis = jobRow?.job_analysis;
  const cachedVersion = jobRow?.job_analysis_schema_version;
  let jobOnly: JobOnlyAnalysisV1 | null = null;

  if (cachedAnalysis && cachedVersion === SCHEMA_VERSIONS.jobOnlyAnalysis) {
    const cacheParsed = JobAnalysisSchema.parse(cachedAnalysis);
    if (!("error" in cacheParsed)) {
      jobOnly = toJobOnly(cacheParsed);
      console.log(`[Agent:ResumeForge] job_analysis cache HIT for job ${jobRow?.id} - skipping job-only extraction call`);
    } else {
      console.warn(`[Agent:ResumeForge] job_analysis cache present but failed validation (${cacheParsed.error}) - treating as a miss`);
    }
  }

  if (!jobOnly) {
    console.log(`[Agent:ResumeForge] job_analysis cache MISS/stale for job ${jobRow?.id} - running job-only extraction inline`);
    jobOnly = await extractJobOnlyAnalysis(provider, options, ctx.job);

    // Best-effort cache write-back: awaited so it reliably happens before
    // this stage returns (a Cloudflare Workers request can be torn down
    // once its response is sent), but a failure here only logs - it must
    // never fail the pipeline stage.
    if (jobRow?.id) {
      try {
        await execute(
          `UPDATE jobs SET job_analysis = $1::jsonb, job_analysis_schema_version = $2, job_analysis_completed_at = NOW() WHERE id = $3`,
          [JSON.stringify(jobOnly), SCHEMA_VERSIONS.jobOnlyAnalysis, jobRow.id]
        );
        console.log(`[Agent:ResumeForge] cached job_analysis for job ${jobRow.id}`);
      } catch (err: any) {
        console.warn(`[Agent:ResumeForge] failed to cache job_analysis for job ${jobRow?.id} (non-fatal): ${err?.message ?? err}`);
      }
    }
  }

  // Per-candidate requirement classification - always runs fresh.
  const reqResponse = await provider.send({
    system: "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: buildRequirementAnalysisPrompt(jobOnly, {
              baseResume: ctx.baseResume,
              evidence: ctx.evidence,
              sourceOfTruth: ctx.sourceOfTruth,
              verifiedSkills: ctx.verifiedSkills,
            }),
          },
        ],
      },
    ],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });
  const reqParsed = extractJsonObjectForJobAnalysis(textOf(reqResponse.content)) as { requirementAnalysis?: unknown };

  const merged = JobAnalysisSchema.parse({ ...jobOnly, requirementAnalysis: reqParsed?.requirementAnalysis });
  if ("error" in merged) throw new Error(`Job analysis output validation failed: ${merged.error}`);
  return merged;
}

/**
 * Every post-AI safety pass applied to a Forge draft: base-resume identity
 * restore, employment/education integrity, the per-role bullet safety net,
 * and the professional-summary guard. Applied identically to the first draft
 * and to the bounded "supported but missed" retry draft, so the retry can
 * never smuggle in an identity change while fixing a missing keyword.
 */
function applyForgeGuards(
  validated: ResumeDraftV1,
  baseContent: any,
  baseExperience: unknown[],
  baseEducation: unknown[]
): void {
  const basePersonalInfo = baseContent?.personalInfo;
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
}

export async function runResumeForge(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<ResumeForgeResult> {
  const jobAnalysis = await analyzeJob(options, provider, ctx);

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
    responseSchema: RESUME_DRAFT_JSON_SCHEMA,
    responseMimeType: "application/json",
  });

  const parsed = parseRawJson(textOf(response.content));
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

  applyForgeGuards(validated, baseContent, baseExperience, baseEducation);

  // ── REQUIREMENT COVERAGE ─────────────────────────────────────────────────
  // Deterministic check against the classified requirements computed above.
  // Only supported requirements that failed to surface trigger the bounded
  // retry; unsupported/hard_blocker gaps are never retried (nothing can
  // truthfully add them) and stay visible as candidate evidence gaps.
  let coverage = buildRequirementCoverage(jobAnalysis, validated);
  const missed = listMissedSupported(coverage);

  if (missed.length > 0) {
    const missedNames = missed.map((row) => row.requirement);
    console.warn(
      `[Agent:ResumeForge] COVERAGE RETRY: supported requirements missed in first draft: ${missedNames.join(", ")}`
    );
    try {
      const retryResponse = await provider.send({
        system: options.system_prompt ?? "You are Resume Forge, an AI that tailors resumes using only supported evidence. Return only valid JSON.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildResumeForgeMissedRetryPrompt(missedNames, validated),
              },
            ],
          },
        ],
        tools: [],
        temperature: options.temperature,
        maxTokens: options.max_output_tokens,
        timeoutMs: options.timeout_ms,
        responseSchema: RESUME_DRAFT_JSON_SCHEMA,
        responseMimeType: "application/json",
      });
      const retryParsed = parseRawJson(textOf(retryResponse.content));
      const retryValidated = ResumeDraftSchema.parse(retryParsed);
      if ("error" in retryValidated) {
        console.warn(
          `[Agent:ResumeForge] COVERAGE RETRY rejected (validation failed: ${retryValidated.error}); keeping first draft`
        );
      } else {
        applyForgeGuards(retryValidated, baseContent, baseExperience, baseEducation);
        Object.assign(validated, retryValidated);
        console.warn("[Agent:ResumeForge] COVERAGE RETRY applied - re-checking coverage");
      }
    } catch (err: any) {
      console.warn(`[Agent:ResumeForge] COVERAGE RETRY failed (${err?.message ?? err}); keeping first draft`);
    }

    coverage = buildRequirementCoverage(jobAnalysis, validated);
  }

  validated.requirementCoverage = coverage;
  const stillMissed = listMissedSupported(coverage);
  if (stillMissed.length > 0) {
    const existing = new Set(validated.missingRequirements ?? []);
    for (const row of stillMissed) existing.add(row.requirement);
    validated.missingRequirements = Array.from(existing);
    console.warn(
      `[Agent:ResumeForge] COVERAGE: still missing after retry (surfaced for Final Polish gate): ${stillMissed.map((r) => r.requirement).join(", ")}`
    );
  }

  // ── EVIDENCE-ID AUDIT ─────────────────────────────────────────────────────
  // Strips any evidenceId that doesn't match a real evidence-bank entry
  // (fabricated/hallucinated), run on the final validated draft so it covers
  // whichever of the first draft or the coverage-retry draft actually won.
  const evidenceAudit = validateEvidenceCitations(validated, ctx.evidence ?? []);
  if (evidenceAudit.danglingCount > 0) {
    console.warn(
      `[Agent:ResumeForge] EVIDENCE AUDIT: stripped ${evidenceAudit.danglingCount} dangling evidence citation(s), kept ${evidenceAudit.citedCount} real one(s)`
    );
  }

  // ── DEBUG: Resume Forge ──────────────────────────────────────────
  console.log("[Agent:ResumeForge] ── OUTPUT ───────────────────────────────────");
  console.log("[Agent:ResumeForge] validated draft:", JSON.stringify(validated, null, 2));
  console.log("[Agent:ResumeForge] experience roles (count):", (validated as any).experience?.length ?? "N/A");
  console.log("[Agent:ResumeForge] ───────────────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return { jobAnalysis, draft: validated };
}
