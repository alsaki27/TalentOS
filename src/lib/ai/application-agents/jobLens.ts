// Job Lens agent — analyzes the JD and extracts requirements.
//
// Two-part pipeline: job-only extraction (title, skills, tools, ATS
// keywords, etc. - everything the job posting alone determines) is cached
// once per job in jobs.job_analysis (093_job_analysis_cache.sql) instead of
// being re-run by every application against that job. Per-candidate
// requirementAnalysis (classifying those requirements against THIS
// candidate's evidence) always runs fresh - it depends on who's applying
// and must never be cached. Callers of runJobLens see no difference: it
// still returns the same merged JobAnalysisV1 shape it always did.

import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext, AgentOptions } from "./types";
import { JobAnalysisSchema, type JobAnalysisV1, type JobOnlyAnalysisV1 } from "./schemas";
import { buildJobOnlyLensPrompt, buildRequirementAnalysisPrompt, resolveJobDescription } from "./prompts/jobLens";
import { textOf } from "@/lib/ai/provider";
import { SCHEMA_VERSIONS } from "./constants";
import { execute } from "@/server/db/neon";

/** Extracts everything from a validated JobAnalysisV1 except requirementAnalysis - the job-only subset that gets cached. */
function toJobOnly(validated: JobAnalysisV1): JobOnlyAnalysisV1 {
  const { requirementAnalysis, ...jobOnly } = validated;
  return jobOnly;
}

/** Robustly extracts a JSON object from provider text: strips markdown fences, then finds the outermost {...} to ignore any preamble/trailing commentary a fallback model adds. */
function extractJsonObject(raw: string): unknown {
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
function withCanonicalIdentity(parsed: unknown, job: any): unknown {
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

/**
 * Runs the job-only extraction call and validates it. Used both by the
 * cache-miss fallback below and would be used by jobCategorization.ts's own
 * cache-populating call if that code path needs the same validation -
 * kept as a plain exported function (not inlined) for that reuse.
 */
export async function extractJobOnlyAnalysis(provider: AiProvider, options: AgentOptions, job: any): Promise<JobOnlyAnalysisV1> {
  const response = await provider.send({
    system: options.system_prompt ?? "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
    messages: [{ role: "user", content: [{ type: "text", text: buildJobOnlyLensPrompt(job) }] }],
    tools: [],
    temperature: options.temperature,
    maxTokens: options.max_output_tokens,
    timeoutMs: options.timeout_ms,
  });
  const parsed = withCanonicalIdentity(extractJsonObject(textOf(response.content)), job);
  const validated = JobAnalysisSchema.parse(parsed);
  if ("error" in validated) throw new Error(`Job Lens job-only analysis validation failed: ${validated.error}`);
  return toJobOnly(validated);
}

export async function runJobLens(
  options: AgentOptions,
  provider: AiProvider,
  ctx: AgentContext
): Promise<JobAnalysisV1> {
  // ── DEBUG: Job Lens ─────────────────────────────────────────────
  console.log("[Agent:JobLens] ── INPUT ──────────────────────────────────────");
  console.log("[Agent:JobLens] job:", JSON.stringify(ctx.job, null, 2));
  console.log("[Agent:JobLens] ────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  // ROOT CAUSE #3 GUARD: if the job has no usable description, fail immediately
  // with a clear, actionable error rather than sending "No description available"
  // to the AI and burning an expensive call that returns empty/useless analysis.
  // That empty analysis then hard-fails the Hiring Panel quality gate (atsScore=0
  // against minimum_score=6.0) three stages later, wasting the full pipeline cost.
  // The error text is surfaced directly on the Application Queue page via
  // resume_generation_error so the operator knows exactly what to fix.
  const jobDescription = resolveJobDescription(ctx.job);
  if (!jobDescription || jobDescription === "No description available") {
    throw new Error(
      `Job Lens failed: no job description found for "${ctx.job?.title ?? ctx.job?.id ?? "this job"}". ` +
      `Add description text (description_text or notes) to the job posting and retry.`
    );
  }

  // ── JOB-ONLY ANALYSIS: cache hit, or extract-and-cache on a miss ────────
  const jobRow = ctx.job as any;
  const cachedAnalysis = jobRow?.job_analysis;
  const cachedVersion = jobRow?.job_analysis_schema_version;
  let jobOnly: JobOnlyAnalysisV1 | null = null;

  if (cachedAnalysis && cachedVersion === SCHEMA_VERSIONS.jobOnlyAnalysis) {
    const cacheParsed = JobAnalysisSchema.parse(cachedAnalysis);
    if (!("error" in cacheParsed)) {
      jobOnly = toJobOnly(cacheParsed);
      console.log(`[Agent:JobLens] job_analysis cache HIT for job ${jobRow?.id} - skipping job-only extraction call`);
    } else {
      console.warn(`[Agent:JobLens] job_analysis cache present but failed validation (${cacheParsed.error}) - treating as a miss`);
    }
  }

  if (!jobOnly) {
    console.log(`[Agent:JobLens] job_analysis cache MISS/stale for job ${jobRow?.id} - running job-only extraction inline`);
    jobOnly = await extractJobOnlyAnalysis(provider, options, ctx.job);

    // Best-effort cache write-back: awaited so it reliably happens before
    // this stage returns (a Cloudflare Workers request can be torn down
    // once its response is sent, so an un-awaited background write risks
    // never landing), but a failure here only logs - it must never fail
    // the pipeline stage. The next application against this same job simply
    // re-extracts on its own next miss; there is no separate retry budget
    // to track for this opportunistic path (unlike jobCategorization.ts's
    // dedicated background job, which does track attempts/errors).
    if (jobRow?.id) {
      try {
        await execute(
          `UPDATE jobs SET job_analysis = $1::jsonb, job_analysis_schema_version = $2, job_analysis_completed_at = NOW() WHERE id = $3`,
          [JSON.stringify(jobOnly), SCHEMA_VERSIONS.jobOnlyAnalysis, jobRow.id]
        );
        console.log(`[Agent:JobLens] cached job_analysis for job ${jobRow.id}`);
      } catch (err: any) {
        console.warn(`[Agent:JobLens] failed to cache job_analysis for job ${jobRow?.id} (non-fatal): ${err?.message ?? err}`);
      }
    }
  }

  // ── PER-CANDIDATE REQUIREMENT ANALYSIS: always runs fresh ───────────────
  const reqResponse = await provider.send({
    system: options.system_prompt ?? "You are Job Lens, an AI that analyzes job descriptions. Return only valid JSON.",
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
  const reqParsed = extractJsonObject(textOf(reqResponse.content)) as { requirementAnalysis?: unknown };

  // Merge the (cached-or-fresh) job-only analysis with the fresh per-candidate
  // classification into the exact same JobAnalysisV1 shape runJobLens has
  // always returned - every downstream consumer (resumeForge.ts,
  // hiringPanel.ts, finalPolish.ts, requirementCoverage.ts, disposition.ts)
  // needs zero changes.
  const merged = JobAnalysisSchema.parse({ ...jobOnly, requirementAnalysis: reqParsed?.requirementAnalysis });
  if ("error" in merged) throw new Error(`Job Lens output validation failed: ${merged.error}`);

  // ── DEBUG: Job Lens ─────────────────────────────────────────────
  console.log("[Agent:JobLens] ── OUTPUT ─────────────────────────────────────");
  console.log("[Agent:JobLens] validated output:", JSON.stringify(merged, null, 2));
  console.log("[Agent:JobLens] ────────────────────────────────────────────────");
  // ────────────────────────────────────────────────────────────────

  return merged;
}
