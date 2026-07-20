// src/server/services/jobAgentService.ts
// Orchestration service with auto token rotation.
// No manual config inputs ΓÇö tokens, budget limits, and actor params are automatic.

import { getDefaultConfig, type JobAgentConfigRow } from "@/server/repositories/jobAgentConfigRepository";
import { createRun, updateRunStatus, insertStagedJobs, getDedupHashes, type JobAgentStagedJobRow } from "@/server/repositories/jobAgentRunRepository";
import { rotateToken, markTokenError, deactivateToken } from "@/server/repositories/jobAgentTokenRepository";
import { listAllJobsForFuzzyDedupe } from "@/server/repositories/jobsRepository";
import { getTitlesForGroups, getGroupForSearchQuery, getGroupLabel, validateRoleGroups } from "@/lib/jobAgentRoleLibrary";
import { classifyJob } from "@/lib/ai/jobAgentClassifier";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const ACTOR_ID = "khadinakbar~google-jobs-scraper";
const COST_PER_RESULT_USD = 0.003;
const POLL_INTERVAL_MS = 15_000;
const POLL_TIMEOUT_MS = 15 * 60_000;
const CLASSIFICATION_DELAY_MS = 300;

/**
 * Map UI-friendly date intervals to the exact enum values the Apify actor expects.
 * The actor's datePosted enum is: ["any", "today", "3days", "week", "month"].
 * Passing anything else (e.g. "7 days") silently breaks filtering.
 */
const VALID_DATE_POSTED_VALUES = new Set(["any", "today", "3days", "week", "month"]);

function toApifyDatePosted(input: string | undefined | null): string {
  if (!input) return "today";
  const normalized = input.toLowerCase().trim();
  const map: Record<string, string> = {
    today: "today",
    "2 days": "3days",
    "3days": "3days",
    "3 days": "3days",
    "7 days": "week",
    week: "week",
    "30 days": "month",
    month: "month",
    any: "any",
  };
  const mapped = map[normalized];
  if (mapped && VALID_DATE_POSTED_VALUES.has(mapped)) return mapped;
  // Defensive fallback: if the input already matches the actor's enum, pass it through.
  if (VALID_DATE_POSTED_VALUES.has(normalized)) return normalized;
  console.warn(`[jobAgentService] Unrecognized datePosted "${input}", defaulting to "today"`);
  return "today";
}

export interface ExecuteRunOptions {
  testMode?: boolean;
  useAi?: boolean;
  roleGroups?: string[];
  customKeywords?: string[];
  dateInterval?: string;
}

export interface ExecuteRunResult {
  runId: string;
  status: string;
  rawCount: number;
  dedupedCount: number;
  classifiedCount: number;
  duplicateCount: number;
  estimatedCostUsd: number;
  tokenLabel: string | null;
  error?: string;
}

export interface ApifyDatasetItem {
  job_title?: string; title?: string; company_name?: string; company?: string;
  location?: string; salary_range?: string; salary?: string; date_posted?: string;
  posted_at?: string; via_platform?: string; platform?: string;
  source_url?: string; url?: string; apply_link?: string; apply_url?: string;
  is_remote?: boolean; remote?: boolean; employment_type?: string;
  search_query?: string; searchQueryUsed?: string; query?: string;
  [key: string]: unknown;
}

/**
 * Create a pending run record (fast, no Apify call). Call
 * executeRunFromRecord afterward in background to do the work.
 */
export async function createPendingRun(
  options: ExecuteRunOptions = {}
): Promise<{ runId: string; config: JobAgentConfigRow; roleGroups: string[]; token: { id: string; token: string; label: string | null } }> {
  const config = await getDefaultConfig();
  if (!config.is_active) throw new Error("Job Agent config is inactive.");

  const token = await rotateToken();
  if (!token) throw new Error("No Apify tokens available ΓÇö all exhausted or errored.");

  const roleGroups = validateRoleGroups(options.roleGroups ?? []);
  const customKw = options.customKeywords ?? [];

  if (roleGroups.length === 0 && customKw.length === 0) {
    throw new Error("Select at least one role group or custom keyword group to run.");
  }

  const searchQueries = getSearchQueries(roleGroups, options.testMode ?? false, customKw);
  if (searchQueries.length === 0) throw new Error("No search queries built.");

  const run = await createRun(config.id, roleGroups, token.id);
  return { runId: run.id, config, roleGroups, token };
}

/**
 * Starts the Apify run for a pending run record. Call this in the background.
 * Because Cloudflare limits execution time to 30s, this function only STARTS the run on Apify.
 * A separate polling mechanism (e.g. cron) must check status and call processApifyRunData().
 */
export async function executeRunFromRecord(
  runId: string,
  config: JobAgentConfigRow,
  roleGroups: string[],
  initialToken: { id: string; token: string; label: string | null },
  options: ExecuteRunOptions = {}
): Promise<ExecuteRunResult> {

  let currentToken = initialToken;

  while (true) {
    try {
      await updateRunStatus(runId, { status: "running" });

      const searchQueries = getSearchQueries(roleGroups, options.testMode ?? false, options.customKeywords ?? []);
      const maxResults = options.testMode
        ? Math.min(50, config.max_results)
        : Math.min(500, config.max_results);

      const apifyInput = {
        searchQueries,
        maxResults,
        datePosted: toApifyDatePosted(options.dateInterval),
        employmentType: "any",
        proxyCountry: "US",
      };

      const { runId: apifyRunId, datasetId } = await startApifyRun(ACTOR_ID, currentToken.token, apifyInput);
      await updateRunStatus(runId, { apify_run_id: apifyRunId, apify_dataset_id: datasetId, token_id: currentToken.id });

      // Run successfully started! We exit now so Cloudflare doesn't kill us.
      // Cron will poll Apify and call processApifyRunData.
      return { runId, status: "running", rawCount: 0, dedupedCount: 0, classifiedCount: 0, duplicateCount: 0, estimatedCostUsd: 0, tokenLabel: currentToken.label };
    } catch (err: any) {
      const message = err.message ?? "Run failed";
      const msgLower = message.toLowerCase();
      const isQuotaError = msgLower.includes("rate limit") || msgLower.includes("quota") || msgLower.includes("hard limit") || msgLower.includes("exceeded") || msgLower.includes("platform-feature-disabled");

      if (isQuotaError) {
        await markTokenError(currentToken.id, message);
        const next = await rotateToken();
        if (!next) {
          await updateRunStatus(runId, { status: "failed", error: "All tokens exhausted ΓÇö no working Apify accounts available.", completed_at: new Date().toISOString() });
          throw new Error("All tokens exhausted.");
        }
        currentToken = next;
        continue; // retry with the next token
      }

      await updateRunStatus(runId, { status: "failed", error: message, completed_at: new Date().toISOString() });
      throw err;
    }
  }
}

/**
 * Called by a cron job or webhook when an Apify run finishes successfully.
 * Downloads the dataset, dedupes, classifies, and inserts into staged jobs.
 */
export async function processApifyRunData(
  runId: string,
  datasetId: string,
  token: string,
  options: { useAi?: boolean } = {}
): Promise<void> {
  try {
    const items = await fetchApifyDataset(datasetId, token);
    const rawCount = items.length;
    await updateRunStatus(runId, { raw_count: rawCount });

    const { deduped, duplicateCount: inRunDups } = dedupeInRun(items);
    const { uniqueJobs, duplicateCount: crossRunDups } = await dedupeAcrossRunsAndJobs(deduped);
    const totalDupes = inRunDups + crossRunDups;

    const classifiedJobs = await classifyJobs(uniqueJobs, options.useAi ?? true);
    const stagedRows = classifiedJobs.map((j) => toStagedJobRow(runId, j));
    await insertStagedJobs(runId, stagedRows);

    const classifiedCount = stagedRows.filter((j) => !j.is_duplicate).length;
    const estimatedCostUsd = rawCount * COST_PER_RESULT_USD;

    await updateRunStatus(runId, {
      status: "succeeded",
      deduped_count: deduped.length,
      skipped_count: totalDupes,
      classified_count: classifiedCount,
      estimated_cost_usd: estimatedCostUsd,
      completed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    const message = err.message ?? "Processing failed";
    await updateRunStatus(runId, { status: "failed", error: message, completed_at: new Date().toISOString() });
    throw err;
  }
}

export async function checkApifyRunStatus(apifyRunId: string, token: string): Promise<string> {
  const url = `${APIFY_BASE_URL}/actor-runs/${apifyRunId}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`Status check failed (${res.status}): ${text}`); }
  const data = await res.json();
  return data?.data?.status;
}

/** Convenience: create + execute synchronously (for cron). Note: Cron must now poll later! */
export async function executeRun(options: ExecuteRunOptions = {}): Promise<ExecuteRunResult> {
  const { runId, config, roleGroups, token } = await createPendingRun(options);
  return executeRunFromRecord(runId, config, roleGroups, token, options);
}

// ΓöÇΓöÇ helpers ΓöÇΓöÇ

function getSearchQueries(roleGroups: string[], testMode: boolean, customKeywords: string[]): string[] {
  const titles = getTitlesForGroups(roleGroups);
  const merged = [...new Set([...titles, ...customKeywords.map((k) => k.trim()).filter(Boolean)])];
  if (testMode) {
    const testSet = ["OSP Design Engineer", "Fiber Design Engineer", "AutoCAD Drafter", "GIS Analyst", "GIS Technician"];
    return testSet.filter((t) => merged.includes(t));
  }
  return merged;
}

async function startApifyRun(actorId: string, token: string, input: Record<string, unknown>): Promise<{ runId: string; datasetId: string }> {
  const url = `${APIFY_BASE_URL}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`Apify start run failed (${res.status}): ${text}`); }
  const data = await res.json();
  const runId = data?.data?.id; const datasetId = data?.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error("Apify response missing runId/datasetId");
  return { runId, datasetId };
}

// (Removed pollApifyRun)

async function fetchApifyDataset(datasetId: string, token: string): Promise<ApifyDatasetItem[]> {
  const url = `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json&clean=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Dataset fetch failed (${res.status})`);
  return (await res.json()) as ApifyDatasetItem[];
}

export async function fetchLiveApifyDatasetItems(datasetId: string, token: string, limit: number = 50): Promise<ApifyDatasetItem[]> {
  const url = `${APIFY_BASE_URL}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json&clean=true&limit=${limit}&desc=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Live dataset fetch failed (${res.status})`);
  return (await res.json()) as ApifyDatasetItem[];
}

interface NormalizedJob { hash: string; job_title: string; company_name: string | null; location: string | null; salary_range: string | null; salary_min: number | null; salary_max: number | null; date_posted: string | null; via_platform: string | null; source_url: string | null; apply_link: string | null; is_remote: boolean | null; employment_type: string | null; search_query_used: string | null; raw: ApifyDatasetItem; }

function normalizeItem(item: ApifyDatasetItem): NormalizedJob {
  const jobTitle = String(item.job_title ?? item.title ?? "").trim();
  const companyName = String(item.company_name ?? item.company ?? "").trim() || null;
  const location = String(item.location ?? "").trim() || null;
  const salaryRange = String(item.salary_range ?? item.salary ?? "").trim() || null;
  const { salaryMin, salaryMax } = parseSalary(salaryRange);
  return { hash: dedupHash(jobTitle, companyName, location), job_title: jobTitle, company_name: companyName, location, salary_range: salaryRange, salary_min: salaryMin, salary_max: salaryMax, date_posted: String(item.date_posted ?? item.posted_at ?? "").trim() || null, via_platform: String(item.via_platform ?? item.platform ?? "").trim() || null, source_url: String(item.source_url ?? item.url ?? "").trim() || null, apply_link: String(item.apply_link ?? item.apply_url ?? "").trim() || null, is_remote: typeof item.is_remote === "boolean" ? item.is_remote : typeof item.remote === "boolean" ? item.remote : null, employment_type: String(item.employment_type ?? "").trim() || null, search_query_used: String(item.search_query ?? item.searchQueryUsed ?? item.query ?? "").trim() || null, raw: item };
}

function parseSalary(s: string | null) { if (!s) return { salaryMin: null as number | null, salaryMax: null as number | null }; const m = s.match(/\$?([\d,]+(?:\.\d+)?)\s*[ΓÇô\-]\s*\$?([\d,]+(?:\.\d+)?)/); if (!m) return { salaryMin: null, salaryMax: null }; const min = parseFloat(m[1].replace(/,/g, "")); const max = parseFloat(m[2].replace(/,/g, "")); return { salaryMin: Number.isFinite(min) ? min : null, salaryMax: Number.isFinite(max) ? max : null }; }

export function dedupHash(title: string, company: string | null, location: string | null): string { return `${title}|${company ?? ""}|${location ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

export function normalizeForFuzzyMatch(s: string | null): string { return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

function dedupeInRun(items: ApifyDatasetItem[]): { deduped: NormalizedJob[]; duplicateCount: number } { const seen = new Set<string>(); const deduped: NormalizedJob[] = []; let dc = 0; for (const item of items) { const n = normalizeItem(item); if (!n.job_title) continue; if (seen.has(n.hash)) { dc++; continue; } seen.add(n.hash); deduped.push(n); } return { deduped, duplicateCount: dc }; }

async function dedupeAcrossRunsAndJobs(jobs: NormalizedJob[]): Promise<{ uniqueJobs: NormalizedJob[]; duplicateCount: number }> {
  const hashes = jobs.map((j) => j.hash);
  const existingStagedHashes = await getDedupHashes(hashes);
  const existingJobs = await listAllJobsForFuzzyDedupe();
  const uniqueJobs: NormalizedJob[] = []; let dc = 0;
  for (const job of jobs) {
    if (existingStagedHashes.has(job.hash)) { job.raw._duplicate = true; dc++; continue; }
    const nj = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (existingJobs.some((e) => nj(job.job_title) === nj(e.title) && nj(job.company_name) === nj(e.company) && nj(job.location) === nj(e.location))) { job.raw._duplicate = true; dc++; continue; }
    uniqueJobs.push(job);
  }
  return { uniqueJobs, duplicateCount: dc };
}

interface ClassifiedJob extends NormalizedJob { role_group: string | null; role_group_label: string | null; seniority_guess: string; tier: string; tier_reason: string; ai_keywords: string[]; relevance_score: number; is_false_positive: boolean; }

async function classifyJobs(jobs: NormalizedJob[], useAi: boolean): Promise<ClassifiedJob[]> {
  if (jobs.length === 0) return [];

  // Process in parallel batches of CONCURRENCY to keep total time reasonable.
  // 500 jobs @ 5s AI call + batch overhead Γëê 100 seconds with 5 concurrent.
  const CONCURRENCY = 5;
  const classified: ClassifiedJob[] = [];

  for (let batchStart = 0; batchStart < jobs.length; batchStart += CONCURRENCY) {
    const batch = jobs.slice(batchStart, batchStart + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        const group = job.search_query_used ? getGroupForSearchQuery(job.search_query_used) : undefined;
        const gid = group?.id ?? null;
        const gl = group ? getGroupLabel(group.id) : null;
        const c = await classifyJob(
          {
            title: job.job_title,
            company_name: job.company_name,
            search_query: job.search_query_used ?? job.job_title,
            role_group: gid ?? "?",
            role_group_label: gl ?? "Unknown",
          },
          { useAi }
        );
        return {
          ...job,
          role_group: gid,
          role_group_label: gl,
          seniority_guess: c.seniority,
          tier: c.tier,
          tier_reason: c.tier_reason,
          ai_keywords: c.keywords,
          relevance_score: c.relevance_score,
          is_false_positive: c.is_false_positive,
        };
      })
    );
    classified.push(...batchResults);

    // Small inter-batch pause to avoid hammering the AI provider,
    // but not the 300ms-per-job delay that made large runs take hours.
    if (batchStart + CONCURRENCY < jobs.length) {
      await new Promise((r) => setTimeout(r, CLASSIFICATION_DELAY_MS));
    }
  }

  return classified;
}

function toStagedJobRow(runId: string, job: ClassifiedJob): Omit<JobAgentStagedJobRow, "id" | "created_at"> {
  return { run_id: runId, job_title: job.job_title, company_name: job.company_name, location: job.location, salary_range: job.salary_range, salary_min: job.salary_min, salary_max: job.salary_max, date_posted: job.date_posted, via_platform: job.via_platform, source_url: job.source_url, apply_link: job.apply_link, is_remote: job.is_remote, employment_type: job.employment_type, search_query_used: job.search_query_used, role_group: job.role_group, role_group_label: job.role_group_label, seniority_guess: job.seniority_guess, tier: job.tier, tier_reason: job.tier_reason, ai_keywords: job.ai_keywords, relevance_score: job.relevance_score, is_false_positive: job.is_false_positive, dedup_hash: job.hash, is_duplicate: job.raw._duplicate === true, import_status: "staged", imported_job_id: null, description_text: null, company_website: null, external_job_id: null, country: null, industry: null };
}

export async function testApifyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${APIFY_BASE_URL}/user/me?token=${encodeURIComponent(token)}`);
    if (!res.ok) { const text = await res.text().catch(() => ""); return { ok: false, error: `Apify returned ${res.status}` }; }
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message ?? "Request failed" }; }
}
