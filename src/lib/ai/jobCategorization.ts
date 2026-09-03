// src/lib/ai/jobCategorization.ts
// AI-driven replacement for the old full-text keyword categorizer
// (src/lib/jobCategorizer.ts), which scored every job against the entire
// description and mis-categorized almost everything that wasn't a clean keyword
// match. Single-shot generation (no tool-calling), same pattern as src/lib/ai/digest.ts
// and for the same reason: avoids the documented NVIDIA/Kimi multi-turn degeneration
// bug (see README/ROADMAP) since there's no second turn for the model to break on.
//
// One AI call per job now does FOUR things at once: picks 3-4 precise
// categorization tags, cleans salary_range into structured min/max/currency/
// period, classifies work authorization, AND extracts the job-only Job Lens
// analysis (093_job_analysis_cache.sql) that runJobLens would otherwise have
// to re-extract on every single application against this job. The job-only
// extraction instructions are shared verbatim with prompts/jobLens.ts's
// buildJobOnlyLensPrompt() so the two never drift on what "job-only" means.
// Jobs are processed strictly sequentially (processPendingCategorization),
// never in parallel — gentle on provider rate limits and keeps import fast
// since categorization always happens after the insert, not as part of it.
//
// The job-only-analysis half of this call is independent of the
// categorization half: a malformed/missing job-only response is recorded via
// job_analysis_error/job_analysis_attempts and simply leaves the cache cold
// (runJobLens's own inline fallback will fill it on the first real
// application), but never blocks or fails categorization itself, matching
// this codebase's existing pattern of independent, gracefully-degrading
// gates (see description_enrich_attempts for the precedent this mirrors).

import { query, queryOne, execute } from "@/server/db/neon";
import { updateJob } from "@/server/repositories/jobsRepository";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";
import { buildJobOnlyLensPrompt } from "@/lib/ai/application-agents/prompts/jobLens";
import { JobAnalysisSchema, type JobOnlyAnalysisV1 } from "@/lib/ai/application-agents/schemas";
import { SCHEMA_VERSIONS } from "@/lib/ai/application-agents/constants";

export interface PendingJob {
  id: string;
  title: string;
  description_text: string | null;
  job_function: string | null;
  industries: string | null;
  company_description: string | null;
  salary_range: string | null;
  // Additional resolveJobDescription() fallback sources - description_text
  // alone silently gave up on jobs imported via a path that only populated
  // notes/raw_source_payload.description (confirmed live: mis-categorized
  // on title/salary alone because the real JD text was never even sent).
  notes: string | null;
  raw_source_payload: unknown;
  description_html: string | null;
}

interface AiCategorizationResult {
  tags: string[];
  confidence: number | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  work_authorization: string | null;
  work_authorization_evidence: string | null;
}

const VALID_WORK_AUTH = new Set(["us_citizen_required", "no_sponsorship", "sponsorship_available", "unspecified"]);
const VALID_SALARY_PERIOD = new Set(["year", "hour", "month"]);
const BATCH_DELAY_MS = 300;

// The exact trailing instruction buildJobOnlyLensPrompt() ends with - sliced
// off so this file can append its own categorization fields before a single
// combined "Return ONLY valid JSON" closer, without hand-copying the rest of
// that prompt's wording. Defensive: if that shared prompt's ending ever
// changes, the slice silently no-ops and the categorization instructions
// just get appended after it instead of in place of it - never a crash,
// worst case is a slightly redundant prompt.
const JOB_ONLY_PROMPT_CLOSER = "\n\nReturn ONLY valid JSON. No markdown fences, no explanation.";

function buildPrompt(job: PendingJob): string {
  const jobOnlyPrompt = buildJobOnlyLensPrompt(job);
  const jobOnlyBody = jobOnlyPrompt.endsWith(JOB_ONLY_PROMPT_CLOSER)
    ? jobOnlyPrompt.slice(0, -JOB_ONLY_PROMPT_CLOSER.length)
    : jobOnlyPrompt;

  return `${jobOnlyBody}

ALSO extract, for this same job posting, for internal categorization purposes:
- tags: MAXIMUM 3-4 highly relevant, precise, narrow keywords/tags (e.g., "OSP", "Drafting", "Fiber Optics", "AutoCAD", "Outside Plant") based strictly on the specific hard skills and sub-fields the role actually requires.
  CRITICAL: Do NOT output broad or generic industry tags like "Mechanical Engineering", "Civil Engineering", "Software Engineering", or "Construction". Output ONLY precise, granular terms.
- confidence: 0-100, how confident you are in the tags above.
- A structured salary range if one is stated anywhere (often buried at the end of the full description, not in the salary field) — null fields if no number is stated.
- Work authorization signal: "us_citizen_required" (explicit US citizen requirement, often paired with a security clearance), "no_sponsorship" (explicitly will not sponsor / no sponsorship available), "sponsorship_available" (explicitly states sponsorship is available), or "unspecified" (the posting says nothing either way — this is the correct answer for most postings, don't guess).

Respond with ONE JSON object combining the job-analysis fields requested above AND these categorization fields:
{"title": string, "company": string, "location": string|null, "requiredSkills": string[], "preferredSkills": string[], "tools": string[], "methodologies": string[], "certifications": string[], "seniority": string|null, "domain": string|null, "atsKeywords": string[], "responsibilities": string[], "evidenceRequirements": string[], "prohibitedUnsupportedClaims": string[], "ambiguities": string[], "rawSummary": string,
"tags": string[], "confidence": number (0-100), "salary_min": number|null, "salary_max": number|null, "salary_currency": string|null, "salary_period": "year"|"hour"|"month"|null, "work_authorization": "us_citizen_required"|"no_sponsorship"|"sponsorship_available"|"unspecified", "work_authorization_evidence": string|null}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}

function parseAiJson(raw: string): { categorization: AiCategorizationResult; jobOnlyRaw: unknown } {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  const categorization: AiCategorizationResult = {
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null,
    salary_min: typeof parsed.salary_min === "number" ? parsed.salary_min : null,
    salary_max: typeof parsed.salary_max === "number" ? parsed.salary_max : null,
    salary_currency: typeof parsed.salary_currency === "string" ? parsed.salary_currency.trim() : null,
    salary_period: VALID_SALARY_PERIOD.has(parsed.salary_period) ? parsed.salary_period : null,
    work_authorization: VALID_WORK_AUTH.has(parsed.work_authorization) ? parsed.work_authorization : "unspecified",
    work_authorization_evidence: typeof parsed.work_authorization_evidence === "string" ? parsed.work_authorization_evidence.trim() : null,
  };
  return { categorization, jobOnlyRaw: parsed };
}

async function markFailed(jobId: string, message: string, model?: string) {
  await updateJob(jobId, {
    category_status: "failed",
    category_error: message,
    categorized_at: new Date().toISOString(),
    category_model: model ?? null,
  });
}

/**
 * Validates the job-only-analysis half of the combined response and caches
 * it, independently of whatever happens with the categorization half. Never
 * throws - a bad/missing job-only shape records job_analysis_error and
 * increments job_analysis_attempts, but categorizeOneJob's own success is
 * decided entirely by the categorization half, not this.
 */
async function cacheJobOnlyAnalysis(jobId: string, jobOnlyRaw: unknown, model: string): Promise<void> {
  try {
    const validated = JobAnalysisSchema.parse(jobOnlyRaw);
    if ("error" in validated) throw new Error(validated.error);
    const { requirementAnalysis: _unused, ...jobOnly } = validated;
    const jobOnlyTyped: JobOnlyAnalysisV1 = jobOnly;
    await execute(
      `UPDATE jobs SET job_analysis = $1::jsonb, job_analysis_schema_version = $2, job_analysis_completed_at = NOW(), job_analysis_model = $3, job_analysis_error = NULL WHERE id = $4`,
      [JSON.stringify(jobOnlyTyped), SCHEMA_VERSIONS.jobOnlyAnalysis, model, jobId]
    );
  } catch (err: any) {
    console.warn(`[jobCategorization] job-only analysis extraction failed for job ${jobId} (categorization unaffected): ${err?.message ?? err}`);
    await execute(
      `UPDATE jobs SET job_analysis_error = $1, job_analysis_attempts = job_analysis_attempts + 1 WHERE id = $2`,
      [String(err?.message ?? err).slice(0, 2000), jobId]
    );
  }
}

export async function categorizeOneJob(job: PendingJob): Promise<{ ok: boolean; status: string; result?: AiCategorizationResult }> {
  try {
    const { result: parsed, providerName } = await callWithUsageTracking("job_categorization", undefined, async (provider) => {
      const response = await provider.send({
        system: "You are a strict, literal job-posting classifier and analyst. Respond with raw JSON only.",
        messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(job) }] }],
        tools: [],
      });
      return parseAiJson(textOf(response.content));
    });

    const catResult = parsed.categorization;
    const status = "done";

    await updateJob(job.id, {
      job_category: catResult.tags.length > 0 ? catResult.tags[0] : null,
      category_tags: catResult.tags,
      category_relevance_score: catResult.confidence,
      category_status: status,
      ai_suggested_category: null,
      category_error: null,
      categorized_at: new Date().toISOString(),
      category_model: providerName,
      salary_min: catResult.salary_min,
      salary_max: catResult.salary_max,
      salary_currency: catResult.salary_currency,
      salary_period: catResult.salary_period,
      work_authorization: catResult.work_authorization,
      work_authorization_evidence: catResult.work_authorization_evidence,
    });

    // Independent of the categorization result above - never allowed to
    // turn a successful categorization into a failed one.
    await cacheJobOnlyAnalysis(job.id, parsed.jobOnlyRaw, providerName);

    return { ok: true, status, result: catResult };
  } catch (err: any) {
    await markFailed(job.id, err.message ?? "AI categorization request failed");
    return { ok: false, status: "failed" };
  }
}

export async function processPendingCategorization(
  opts: { limit?: number; triggeredBy?: string } = {}
): Promise<{ processed: number; failed: number; remainingPending: number; updatedJobs?: any[] }> {
  const limit = Math.min(opts.limit ?? 200, 200);

  let runRow: { id: string } | null = null;
  runRow = await queryOne<{ id: string }>(
    "INSERT INTO categorization_runs (triggered_by) VALUES ($1) RETURNING id",
    [opts.triggeredBy ?? "manual"]
  );

  let pending: any[] = [];
  let pendingError: any = null;
  try {
    pending = await query<PendingJob>(
      "SELECT id, title, description_text, job_function, industries, company_description, salary_range, notes, raw_source_payload, description_html FROM jobs WHERE category_status = 'pending' OR category_status IS NULL ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
  } catch (err: any) {
    pendingError = err;
  }

  let processed = 0;
  let failed = 0;
  let runError: string | null = null;
  let updatedJobs: any[] = [];

  if (pendingError) {
    runError = pendingError.message;
  } else {
    const jobs = pending ?? [];
    for (let i = 0; i < jobs.length; i++) {
      const { ok, result, status } = await categorizeOneJob(jobs[i] as PendingJob);
      if (ok) {
        processed++;
        if (result) {
          updatedJobs.push({
            id: jobs[i].id,
            category_tags: result.tags,
            job_category: result.tags.length > 0 ? result.tags[0] : null,
            category_relevance_score: result.confidence,
            category_status: status,
            salary_min: result.salary_min,
            salary_max: result.salary_max,
            salary_currency: result.salary_currency,
            salary_period: result.salary_period,
            work_authorization: result.work_authorization,
            work_authorization_evidence: result.work_authorization_evidence,
          });
        }
      } else {
        failed++;
        updatedJobs.push({ id: jobs[i].id, category_status: "failed" });
      }
      if (i < jobs.length - 1) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  if (runRow) {
    await execute(
      "UPDATE categorization_runs SET finished_at = $1, jobs_processed = $2, jobs_failed = $3, error = $4 WHERE id = $5",
      [new Date().toISOString(), processed, failed, runError, runRow.id]
    );
  }

  let remainingCount = 0;
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM jobs WHERE category_status = 'pending' OR category_status IS NULL"
  );
  remainingCount = row?.count ?? 0;

  return { processed, failed, remainingPending: remainingCount, updatedJobs };
}
