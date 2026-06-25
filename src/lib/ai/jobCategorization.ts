// src/lib/ai/jobCategorization.ts
// AI-driven replacement for the old full-text keyword categorizer
// (src/lib/jobCategorizer.ts), which scored every job against the entire
// description and mis-categorized almost everything that wasn't a clean keyword
// match. Single-shot generation (no tool-calling), same pattern as src/lib/ai/digest.ts
// and for the same reason: avoids the documented NVIDIA/Kimi multi-turn degeneration
// bug (see README/ROADMAP) since there's no second turn for the model to break on.
//
// One AI call per job does three things at once: picks the best-fit category from the
// active job_categories list (or proposes a new one), cleans salary_range into
// structured min/max/currency/period, and classifies work authorization. Jobs are
// processed strictly sequentially (processPendingCategorization), never in parallel —
// gentle on provider rate limits and keeps import fast since categorization always
// happens after the insert, not as part of it.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { updateJob } from "@/server/repositories/jobsRepository";
import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

export interface PendingJob {
  id: string;
  title: string;
  description_text: string | null;
  job_function: string | null;
  industries: string | null;
  company_description: string | null;
  salary_range: string | null;
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

function buildPrompt(job: PendingJob): string {
  const jobText = [
    `Title: ${job.title}`,
    job.job_function ? `Job function (source-supplied, often generic): ${job.job_function}` : null,
    job.industries ? `Industries (source-supplied, employer industry, not the role): ${job.industries}` : null,
    job.company_description ? `Company description: ${job.company_description}` : null,
    job.salary_range ? `Salary field (often blank — real number, if any, is usually in the description): ${job.salary_range}` : null,
    job.description_text ? `Full description:\n${job.description_text}` : null,
  ].filter(Boolean).join("\n\n");

  return [
    "Analyze this job posting. Generate a list of MAXIMUM 3-4 highly relevant, precise, and narrow keywords/tags (e.g., \"OSP\", \"Drafting\", \"Fiber Optics\", \"AutoCAD\", \"Outside Plant\") based strictly on the specific hard skills and sub-fields the role actually requires.",
    "CRITICAL: Do NOT output broad or generic industry tags like \"Mechanical Engineering\", \"Civil Engineering\", \"Software Engineering\", or \"Construction\". Output ONLY precise, granular terms.",
    "",
    "Also extract:",
    "- A structured salary range if one is stated anywhere (often buried at the end of the full description, not in the salary field) — null fields if no number is stated.",
    "- Work authorization signal: \"us_citizen_required\" (explicit US citizen requirement, often paired with a security clearance), \"no_sponsorship\" (explicitly will not sponsor / no sponsorship available), \"sponsorship_available\" (explicitly states sponsorship is available), or \"unspecified\" (the posting says nothing either way — this is the correct answer for most postings, don't guess).",
    "",
    "Job posting:",
    jobText,
    "",
    "Respond with ONLY this JSON object, no markdown fences, no other text:",
    '{"tags": string[], "confidence": number (0-100), "salary_min": number|null, "salary_max": number|null, "salary_currency": string|null, "salary_period": "year"|"hour"|"month"|null, "work_authorization": "us_citizen_required"|"no_sponsorship"|"sponsorship_available"|"unspecified", "work_authorization_evidence": string|null}',
  ].join("\n");
}

function parseAiJson(raw: string): AiCategorizationResult {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  return {
    tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null,
    salary_min: typeof parsed.salary_min === "number" ? parsed.salary_min : null,
    salary_max: typeof parsed.salary_max === "number" ? parsed.salary_max : null,
    salary_currency: typeof parsed.salary_currency === "string" ? parsed.salary_currency.trim() : null,
    salary_period: VALID_SALARY_PERIOD.has(parsed.salary_period) ? parsed.salary_period : null,
    work_authorization: VALID_WORK_AUTH.has(parsed.work_authorization) ? parsed.work_authorization : "unspecified",
    work_authorization_evidence: typeof parsed.work_authorization_evidence === "string" ? parsed.work_authorization_evidence.trim() : null,
  };
}

async function markFailed(jobId: string, message: string, model?: string) {
  await updateJob(jobId, {
    category_status: "failed",
    category_error: message,
    categorized_at: new Date().toISOString(),
    category_model: model ?? null,
  });
}

export async function categorizeOneJob(job: PendingJob): Promise<{ ok: boolean; status: string; result?: AiCategorizationResult }> {
  const active = await getProviderForCategory("parsing_extraction");
  if (!active) {
    await markFailed(job.id, "No AI provider configured (set ANTHROPIC_API_KEY, NVIDIA_API_KEY, or GOOGLE_API_KEY).");
    return { ok: false, status: "failed" };
  }

  let result: AiCategorizationResult;
  try {
    const response = await active.provider.send({
      system: "You are a strict, literal job-posting classifier. Respond with raw JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(job) }] }],
      tools: [],
    });
    result = parseAiJson(textOf(response.content));
  } catch (err: any) {
    await markFailed(job.id, err.message ?? "AI categorization request failed", active.name);
    return { ok: false, status: "failed" };
  }

  const status = "done";

  await updateJob(job.id, {
    job_category: result.tags.length > 0 ? result.tags[0] : null,
    category_tags: result.tags,
    category_relevance_score: result.confidence,
    category_status: status,
    ai_suggested_category: null,
    category_error: null,
    categorized_at: new Date().toISOString(),
    category_model: active.name,
    salary_min: result.salary_min,
    salary_max: result.salary_max,
    salary_currency: result.salary_currency,
    salary_period: result.salary_period,
    work_authorization: result.work_authorization,
    work_authorization_evidence: result.work_authorization_evidence,
  });

  return { ok: true, status, result };
}

export async function processPendingCategorization(
  opts: { limit?: number; triggeredBy?: string } = {}
): Promise<{ processed: number; failed: number; remainingPending: number; updatedJobs?: any[] }> {
  const limit = Math.min(opts.limit ?? 200, 200);

  let runRow: { id: string } | null = null;
  if (isNeon()) {
    runRow = await queryOne<{ id: string }>(
      "INSERT INTO categorization_runs (triggered_by) VALUES ($1) RETURNING id",
      [opts.triggeredBy ?? "manual"]
    );
  } else {
    const { data } = await supabase
      .from("categorization_runs")
      .insert({ triggered_by: opts.triggeredBy ?? "manual" })
      .select("id")
      .single();
    runRow = data ?? null;
  }

  let pending: any[] = [];
  let pendingError: any = null;
  if (isNeon()) {
    try {
      pending = await query<PendingJob>(
        "SELECT id, title, description_text, job_function, industries, company_description, salary_range FROM jobs WHERE category_status = 'pending' OR category_status IS NULL ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
    } catch (err: any) {
      pendingError = err;
    }
  } else {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title, description_text, job_function, industries, company_description, salary_range")
      .or('category_status.eq.pending,category_status.is.null')
      .order("created_at", { ascending: false })
      .limit(limit);
    pending = data ?? [];
    pendingError = error;
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
    if (isNeon()) {
      await execute(
        "UPDATE categorization_runs SET finished_at = $1, jobs_processed = $2, jobs_failed = $3, error = $4 WHERE id = $5",
        [new Date().toISOString(), processed, failed, runError, runRow.id]
      );
    } else {
      await supabase.from("categorization_runs").update({
        finished_at: new Date().toISOString(),
        jobs_processed: processed,
        jobs_failed: failed,
        error: runError,
      }).eq("id", runRow.id);
    }
  }

  let remainingCount = 0;
  if (isNeon()) {
    const row = await queryOne<{ count: number }>(
      "SELECT COUNT(*)::int as count FROM jobs WHERE category_status = 'pending' OR category_status IS NULL"
    );
    remainingCount = row?.count ?? 0;
  } else {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .or('category_status.eq.pending,category_status.is.null');
    remainingCount = count ?? 0;
  }

  return { processed, failed, remainingPending: remainingCount, updatedJobs };
}
