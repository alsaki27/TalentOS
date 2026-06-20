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
import { getActiveProvider } from "@/lib/ai";
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

interface ActiveCategory {
  label: string;
  description: string | null;
}

interface AiCategorizationResult {
  category: string | null;
  confidence: number | null;
  suggested_new_category: string | null;
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

async function getActiveCategories(): Promise<ActiveCategory[]> {
  if (isNeon()) {
    return query<ActiveCategory>(
      "SELECT label, description FROM job_categories WHERE is_active = true ORDER BY label ASC"
    );
  }
  const { data, error } = await supabase
    .from("job_categories")
    .select("label, description")
    .eq("is_active", true)
    .order("label", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function buildPrompt(job: PendingJob, categories: ActiveCategory[]): string {
  const categoryList = categories.map((c) => `- ${c.label}${c.description ? `: ${c.description}` : ""}`).join("\n");
  const jobText = [
    `Title: ${job.title}`,
    job.job_function ? `Job function (source-supplied, often generic): ${job.job_function}` : null,
    job.industries ? `Industries (source-supplied, employer industry, not the role): ${job.industries}` : null,
    job.company_description ? `Company description: ${job.company_description}` : null,
    job.salary_range ? `Salary field (often blank — real number, if any, is usually in the description): ${job.salary_range}` : null,
    job.description_text ? `Full description:\n${job.description_text}` : null,
  ].filter(Boolean).join("\n\n");

  return [
    "Classify this job posting. Pick the SINGLE best-fit category from the list below, based on what the role actually does — not on generic words that appear in most postings (e.g. \"plans\", \"power\", \"electric\", \"coordination\" appear in nearly every engineering job and should NOT drive the category on their own).",
    "",
    "Active categories:",
    categoryList,
    "",
    "If the role genuinely does not fit any category above with reasonable confidence, set category to null and suggested_new_category to a short, specific label for what it actually is (e.g. \"Software Engineering\") — never force a wrong category just to pick something.",
    "",
    "Also extract:",
    "- A structured salary range if one is stated anywhere (often buried at the end of the full description, not in the salary field) — null fields if no number is stated.",
    "- Work authorization signal: \"us_citizen_required\" (explicit US citizen requirement, often paired with a security clearance), \"no_sponsorship\" (explicitly will not sponsor / no sponsorship available), \"sponsorship_available\" (explicitly states sponsorship is available), or \"unspecified\" (the posting says nothing either way — this is the correct answer for most postings, don't guess).",
    "",
    "Job posting:",
    jobText,
    "",
    "Respond with ONLY this JSON object, no markdown fences, no other text:",
    '{"category": string|null, "confidence": number (0-100), "suggested_new_category": string|null, "salary_min": number|null, "salary_max": number|null, "salary_currency": string|null, "salary_period": "year"|"hour"|"month"|null, "work_authorization": "us_citizen_required"|"no_sponsorship"|"sponsorship_available"|"unspecified", "work_authorization_evidence": string|null}',
  ].join("\n");
}

function parseAiJson(raw: string): AiCategorizationResult {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(stripped);
  return {
    category: typeof parsed.category === "string" ? parsed.category.trim() : null,
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null,
    suggested_new_category: typeof parsed.suggested_new_category === "string" ? parsed.suggested_new_category.trim() : null,
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

export async function categorizeOneJob(job: PendingJob): Promise<{ ok: boolean; status: string }> {
  const active = getActiveProvider();
  if (!active) {
    await markFailed(job.id, "No AI provider configured (set ANTHROPIC_API_KEY or NVIDIA_API_KEY).");
    return { ok: false, status: "failed" };
  }

  let categories: ActiveCategory[];
  try {
    categories = await getActiveCategories();
  } catch (err: any) {
    await markFailed(job.id, `Failed to load category list: ${err.message ?? err}`, active.name);
    return { ok: false, status: "failed" };
  }

  const validLabels = new Set(categories.map((c) => c.label));

  let result: AiCategorizationResult;
  try {
    const response = await active.provider.send({
      system: "You are a strict, literal job-posting classifier. Respond with raw JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(job, categories) }] }],
      tools: [],
    });
    result = parseAiJson(textOf(response.content));
  } catch (err: any) {
    await markFailed(job.id, err.message ?? "AI categorization request failed", active.name);
    return { ok: false, status: "failed" };
  }

  // The model can only choose a category we actually offered it — anything else falls
  // back to needs_review with its own label as the suggestion, rather than silently
  // accepting an invented category name into job_category.
  const matchedCategory = result.category && validLabels.has(result.category) ? result.category : null;
  const suggestedCategory = matchedCategory ? null : (result.suggested_new_category ?? result.category ?? null);
  const status = matchedCategory ? "done" : "needs_review";

  await updateJob(job.id, {
    job_category: matchedCategory,
    category_tags: matchedCategory ? [matchedCategory] : [],
    category_relevance_score: result.confidence,
    category_status: status,
    ai_suggested_category: suggestedCategory,
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

  return { ok: true, status };
}

export async function processPendingCategorization(
  opts: { limit?: number; triggeredBy?: string } = {}
): Promise<{ processed: number; failed: number; remainingPending: number }> {
  const limit = opts.limit ?? 5;

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
        "SELECT id, title, description_text, job_function, industries, company_description, salary_range FROM jobs WHERE category_status = 'pending' ORDER BY created_at ASC LIMIT $1",
        [limit]
      );
    } catch (err: any) {
      pendingError = err;
    }
  } else {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, title, description_text, job_function, industries, company_description, salary_range")
      .eq("category_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    pending = data ?? [];
    pendingError = error;
  }

  let processed = 0;
  let failed = 0;
  let runError: string | null = null;

  if (pendingError) {
    runError = pendingError.message;
  } else {
    const jobs = pending ?? [];
    for (let i = 0; i < jobs.length; i++) {
      const { ok } = await categorizeOneJob(jobs[i] as PendingJob);
      if (ok) processed++; else failed++;
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
      "SELECT COUNT(*)::int as count FROM jobs WHERE category_status = 'pending'"
    );
    remainingCount = row?.count ?? 0;
  } else {
    const { count } = await supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("category_status", "pending");
    remainingCount = count ?? 0;
  }

  return { processed, failed, remainingPending: remainingCount };
}
