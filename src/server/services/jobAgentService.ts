// src/server/services/jobAgentService.ts
// Multi-actor Apify orchestration service.
// Supports: Indeed (familiar_universality/indeed), Google Jobs (johnvc/google-jobs-scraper), LinkedIn (harvestapi/linkedin-job-search)
// Token rotation, 4-layer deduplication, and actor-aware field normalization.

import { getDefaultConfig, type JobAgentConfigRow } from "@/server/repositories/jobAgentConfigRepository";
import { createRun, updateRunStatus, insertStagedJobs, getDedupHashes, getSourceUrlHashes, type JobAgentStagedJobRow } from "@/server/repositories/jobAgentRunRepository";
import { rotateToken, markTokenError, deactivateToken } from "@/server/repositories/jobAgentTokenRepository";
import { listAllJobsForFuzzyDedupe } from "@/server/repositories/jobsRepository";
import { getTitlesForGroups, getGroupForSearchQuery, getGroupLabel, validateRoleGroups } from "@/lib/jobAgentRoleLibrary";
import { classifyJob } from "@/lib/ai/jobAgentClassifier";

// ─── Actor Registry ────────────────────────────────────────────────────────────

const APIFY_BASE_URL = "https://api.apify.com/v2";

export type ActorSource = "indeed" | "google" | "linkedin";

const ACTOR_IDS: Record<ActorSource, string> = {
  indeed:  "familiar_universality/indeed",
  google:  "johnvc/google-jobs-scraper",
  linkedin: "cheap_scraper/linkedin-job-scraper",
};

const COST_PER_RESULT_USD = 0.001; // conservative average across actors
const CLASSIFICATION_DELAY_MS = 300;

// ─── Date Interval Mappers ─────────────────────────────────────────────────────

/**
 * Map UI date interval to Indeed's hoursOld param.
 * Note: hoursOld cannot be combined with jobType or isRemote in Indeed actor.
 */
function toIndeedHoursOld(interval: string | undefined | null): number | undefined {
  const map: Record<string, number> = {
    today:    24,
    "2 days": 48,
    "3days":  72,
    "3 days": 72,
    "7 days": 168,
    week:     168,
    "30 days": 720,
    month:    720,
  };
  const normalized = (interval ?? "today").toLowerCase().trim();
  return map[normalized] ?? 24;
}

/**
 * Map UI date interval to LinkedIn's postedLimit param (cheap_scraper).
 * r86400 = Past 24 hours
 * r604800 = Past Week
 * r2592000 = Past Month
 */
function toLinkedInPostedLimit(interval: string | undefined | null): string {
  const map: Record<string, string> = {
    today:    "r86400",
    "2 days": "r86400",
    "3days":  "r604800",
    "3 days": "r604800",
    "7 days": "r604800",
    week:     "r604800",
    "30 days": "r2592000",
    month:    "r2592000",
    any:      "r2592000",
  };
  const normalized = (interval ?? "today").toLowerCase().trim();
  return map[normalized] ?? "r86400";
}

// ─── Actor Input Builders ──────────────────────────────────────────────────────

function buildIndeedInput(queries: string[], dateInterval: string | undefined, maxResults: number): Record<string, unknown> {
  const hoursOld = toIndeedHoursOld(dateInterval);
  const maxItems = Math.max(5, Math.min(500, Math.ceil(maxResults / Math.max(1, queries.length))));
  return {
    queries,
    location: "United States",
    countryIndeed: "USA",
    resultsPerQuery: maxItems,
    hoursOld,
    enforceAnnual: true,
  };
}

function buildGoogleInput(query: string, _dateInterval: string | undefined, maxResults: number): Record<string, unknown> {
  // johnvc/google-jobs-scraper recognises: query, location, gl, hl, maxItems, numJobs.
  // Sending unknown or conflicting params (pagesToFetch, max_results, maxPages, …) causes
  // the actor to run indefinitely and never return results.  Cap at 100 — Google Jobs is
  // significantly slower to scrape than Indeed, and 100 jobs per query is more than enough
  // to fill the funnel before AI classification filters them down.
  const numJobs = Math.min(100, Math.max(10, maxResults));
  return {
    query,
    location: "United States",
    gl: "us",
    hl: "en",
    maxItems: numJobs,
    numJobs:  numJobs,
  };
}

function buildLinkedInInput(queries: string[], dateInterval: string | undefined, maxResults: number): Record<string, unknown> {
  const maxItems = Math.max(5, Math.min(500, Math.ceil(maxResults / Math.max(1, queries.length))));
  return {
    keyword: queries,
    locations: ["United States"],
    maxRows: maxItems,
    publishedAt: toLinkedInPostedLimit(dateInterval),
    saveOnlyUniqueItems: true,
  };
}

// ─── Output Normalizer ─────────────────────────────────────────────────────────

export interface ApifyDatasetItem {
  // Canonical fields — populated by normalizeActorItem
  job_title?: string; title?: string;
  company_name?: string; company?: string;
  location?: string;
  salary_range?: string; salary?: string;
  date_posted?: string; posted_at?: string;
  via_platform?: string; platform?: string;
  source_url?: string; url?: string;
  apply_link?: string; apply_url?: string;
  is_remote?: boolean; remote?: boolean;
  employment_type?: string;
  search_query?: string; searchQueryUsed?: string; query?: string;
  description?: string; description_text?: string;
  _duplicate?: boolean;
  _actor_source?: ActorSource;
  // Raw source-specific fields
  [key: string]: unknown;
}

/**
 * Normalize actor-specific output to the canonical ApifyDatasetItem shape.
 * This is the "translation layer" for each actor's unique field names.
 */
function normalizeActorItem(source: ActorSource, raw: Record<string, unknown>): ApifyDatasetItem {
  if (source === "indeed") {
    // Indeed fields: title, company, location, job_url, description, date_posted, job_type, is_remote, min_amount, max_amount, currency
    const minAmt = raw.min_amount as number | undefined;
    const maxAmt = raw.max_amount as number | undefined;
    const currency = (raw.currency as string | undefined) ?? "USD";
    const salaryRange = (minAmt && maxAmt)
      ? `$${minAmt.toLocaleString()} - $${maxAmt.toLocaleString()} ${currency}/yr`
      : undefined;
    return {
      ...raw,
      _actor_source: "indeed",
      job_title:       String(raw.title ?? "").trim(),
      company_name:    String(raw.company ?? "").trim(),
      location:        String(raw.location ?? "").trim(),
      source_url:      String(raw.job_url ?? "").trim(),
      apply_link:      String(raw.job_url ?? "").trim(),
      description:     String(raw.description ?? "").trim(),
      date_posted:     raw.date_posted ? String(raw.date_posted) : undefined,
      employment_type: raw.job_type ? String(raw.job_type) : undefined,
      is_remote:       raw.is_remote === true,
      salary_range:    salaryRange,
      via_platform:    "Indeed",
      search_query:    String(raw.query ?? raw.search_query ?? "").trim(),
    };
  }

  if (source === "google") {
    // Google actor fields: title, company_name, location, via, description, detected_extensions, apply_options, job_id, query
    const applyOptions = Array.isArray(raw.apply_options) ? raw.apply_options as Array<{ title: string; link: string }> : [];
    const applyLink = applyOptions[0]?.link ?? "";
    const detectedExt = (raw.detected_extensions ?? {}) as Record<string, unknown>;
    const scheduleType = detectedExt.schedule_type as string | undefined;
    return {
      ...raw,
      _actor_source: "google",
      job_title:       String(raw.title ?? "").trim(),
      company_name:    String(raw.company_name ?? "").trim(),
      location:        String(raw.location ?? "").trim(),
      source_url:      applyLink,
      apply_link:      applyLink,
      description:     String(raw.description ?? "").trim(),
      date_posted:     detectedExt.posted_at ? String(detectedExt.posted_at) : undefined,
      employment_type: scheduleType ?? undefined,
      is_remote:       String(raw.location ?? "").toLowerCase().includes("remote"),
      salary_range:    undefined,
      via_platform:    raw.via ? String(raw.via) : "Google Jobs",
      search_query:    String(raw.query ?? "").trim(),
    };
  }

  if (source === "linkedin") {
    // cheap_scraper/linkedin-job-scraper fields: jobTitle, companyName, location, jobUrl, jobDescription, publishedAt, salaryInfo
    const applyLink = String(raw.applyUrl ?? raw.jobUrl ?? "").trim();
    const salaryArr = Array.isArray(raw.salaryInfo) ? raw.salaryInfo : [];
    const salaryRange = salaryArr.length > 0 ? salaryArr.join(" - ") : undefined;
    return {
      ...raw,
      _actor_source: "linkedin",
      job_title:       String(raw.jobTitle ?? raw.title ?? "").trim(),
      company_name:    String(raw.companyName ?? "").trim(),
      location:        String(raw.location ?? "").trim(),
      source_url:      String(raw.jobUrl ?? "").trim(),
      apply_link:      applyLink,
      description:     String(raw.jobDescription ?? raw.description ?? "").trim(),
      date_posted:     raw.publishedAt ? String(raw.publishedAt) : (raw.postedTime ? String(raw.postedTime) : undefined),
      employment_type: String(raw.contractType ?? "").trim() || undefined,
      is_remote:       String(raw.location ?? "").toLowerCase().includes("remote"),
      salary_range:    salaryRange,
      via_platform:    "LinkedIn",
      search_query:    String(raw.searchString ?? raw.query ?? "").trim(),
    };
  }

  // Fallback (should never reach here)
  return { ...raw, _actor_source: source };
}

// ─── URL Fingerprint Helper ───────────────────────────────────────────────────

/**
 * Normalize a URL into a stable fingerprint for cross-actor dedup.
 * Strips query params, lowercases, removes trailing slash.
 * Example: https://www.linkedin.com/jobs/view/123/ → linkedin.com/jobs/view/123
 */
export function normalizeUrlFingerprint(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";
  try {
    const u = new URL(url.trim());
    // Strip common tracking query params but keep the rest (like jk= for Indeed)
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    u.searchParams.delete("ref");
    u.hash = "";
    
    const cleaned = (u.hostname + u.pathname + u.search)
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .replace(/[^a-z0-9/.-=?&]/g, "");
    return cleaned;
  } catch {
    // Not a valid URL — use a normalized version of the raw string
    return url.toLowerCase().replace(/[^a-z0-9/.-=?&]/g, "").substring(0, 200);
  }
}

// ─── Options & Result Types ────────────────────────────────────────────────────

export interface ExecuteRunOptions {
  testMode?: boolean;
  useAi?: boolean;
  roleGroups?: string[];
  customKeywords?: string[];
  dateInterval?: string;
  actorSource?: ActorSource;
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

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a pending run record (fast, no Apify call).
 * Call executeRunFromRecord afterward in background to do the work.
 */
export async function createPendingRun(
  options: ExecuteRunOptions = {}
): Promise<{ runId: string; config: JobAgentConfigRow; roleGroups: string[]; token: { id: string; token: string; label: string | null } }> {
  const config = await getDefaultConfig();
  if (!config.is_active) throw new Error("Job Agent config is inactive.");

  const token = await rotateToken();
  if (!token) throw new Error("No Apify tokens available — all exhausted or errored.");

  const roleGroups = validateRoleGroups(options.roleGroups ?? []);
  const customKw = options.customKeywords ?? [];

  if (roleGroups.length === 0 && customKw.length === 0) {
    throw new Error("Select at least one role group or custom keyword group to run.");
  }

  const searchQueries = getSearchQueries(roleGroups, options.testMode ?? false, customKw);
  if (searchQueries.length === 0) throw new Error("No search queries built.");

  const actorSource: ActorSource = options.actorSource ?? "indeed";
  const run = await createRun(config.id, roleGroups, token.id, actorSource);
  return { runId: run.id, config, roleGroups, token };
}

/**
 * Starts the Apify run for a pending run record. Call this in the background.
 * Because Cloudflare limits execution time to 30s, this function only STARTS the run on Apify.
 * A separate polling mechanism (cron) must check status and call processApifyRunData().
 */
export async function executeRunFromRecord(
  runId: string,
  config: JobAgentConfigRow,
  roleGroups: string[],
  initialToken: { id: string; token: string; label: string | null },
  options: ExecuteRunOptions = {}
): Promise<ExecuteRunResult> {
  let currentToken = initialToken;
  const actorSource: ActorSource = options.actorSource ?? "indeed";

  while (true) {
    try {
      await updateRunStatus(runId, { status: "running" });

      const searchQueries = getSearchQueries(roleGroups, options.testMode ?? false, options.customKeywords ?? []);
      const maxResults = options.testMode
        ? Math.min(50, config.max_results)
        : Math.min(500, config.max_results);

      const actorId = ACTOR_IDS[actorSource];

      // Google actor takes one query at a time; use the full list joined or first query in test mode.
      // For proper multi-query Google runs, the UI should dispatch multiple runs.
      // Here we batch them into a single comma-joined query to keep the API simple.
      let apifyInput: Record<string, unknown>;
      if (actorSource === "google") {
        // For Google, passing too many OR clauses severely limits results. 
        // We use the first (most generic) query to cast a wide net, and let our AI filter them down.
        const combinedQuery = searchQueries[0] || "Solar Engineer";
        apifyInput = buildGoogleInput(combinedQuery, options.dateInterval, maxResults);
      } else if (actorSource === "linkedin") {
        apifyInput = buildLinkedInInput(searchQueries, options.dateInterval, maxResults);
      } else {
        apifyInput = buildIndeedInput(searchQueries, options.dateInterval, maxResults);
      }

      // Google is capped at 100 items so 30 min is ample; Indeed/LinkedIn get 1 hour.
      const apifyTimeout = actorSource === "google" ? 1800 : 3600;
      const { runId: apifyRunId, datasetId } = await startApifyRun(actorId, currentToken.token, apifyInput, apifyTimeout);
      await updateRunStatus(runId, { apify_run_id: apifyRunId, apify_dataset_id: datasetId, token_id: currentToken.id });

      // Run successfully started! Exit now — cron will poll and call processApifyRunData.
      return { runId, status: "running", rawCount: 0, dedupedCount: 0, classifiedCount: 0, duplicateCount: 0, estimatedCostUsd: 0, tokenLabel: currentToken.label };
    } catch (err: any) {
      const message = err.message ?? "Run failed";
      const msgLower = message.toLowerCase();
      const isQuotaError = msgLower.includes("rate limit") || msgLower.includes("quota") || msgLower.includes("hard limit") || msgLower.includes("exceeded") || msgLower.includes("platform-feature-disabled");
      const isInvalidToken = msgLower.includes("401") || msgLower.includes("user-or-token-not-found") || msgLower.includes("unauthorized");

      if (isQuotaError || isInvalidToken) {
        if (isInvalidToken) {
          await deactivateToken(currentToken.id);
        } else {
          await markTokenError(currentToken.id, message);
        }

        const next = await rotateToken();
        if (!next) {
          await updateRunStatus(runId, { status: "failed", error: "All tokens exhausted — no working Apify accounts available.", completed_at: new Date().toISOString() });
          throw new Error("All tokens exhausted.");
        }
        currentToken = next;
        continue; // retry with next token
      }

      await updateRunStatus(runId, { status: "failed", error: message, completed_at: new Date().toISOString() });
      throw err;
    }
  }
}

/**
 * Called by a cron job when an Apify run finishes successfully.
 * Downloads the dataset, normalizes by actor source, dedupes, classifies, and inserts into staged jobs.
 */
export async function processApifyRunData(
  runId: string,
  datasetId: string,
  token: string,
  options: { useAi?: boolean; actorSource?: ActorSource } = {}
): Promise<void> {
  const actorSource = options.actorSource ?? "indeed";
  try {
    const rawItems = await fetchApifyDataset(datasetId, token);
    const items = rawItems.map((item) => normalizeActorItem(actorSource, item as Record<string, unknown>));
    const rawCount = items.length;
    await updateRunStatus(runId, { raw_count: rawCount });

    const { deduped, duplicateCount: inRunDups } = dedupeInRun(items);
    const { uniqueJobs, duplicateCount: crossRunDups } = await dedupeAcrossRunsAndJobs(deduped);
    const totalDupes = inRunDups + crossRunDups;

    // Vercel serverless functions time out after 10-60s. AI classification takes ~1-2s per batch of 15.
    // For massive datasets (> 250 unique jobs), force regex fallback to guarantee completion and prevent hanging.
    const requestedAi = options.useAi ?? true;
    const safeUseAi = requestedAi && (uniqueJobs.length <= 250);
    
    if (requestedAi && !safeUseAi) {
      console.warn(`[jobAgentService] Dataset too large (${uniqueJobs.length} unique jobs). Falling back to regex classification to prevent serverless timeout.`);
    }

    const classifiedJobs = await classifyJobs(uniqueJobs, safeUseAi);
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

/** Convenience: create + execute synchronously (for cron). */
export async function executeRun(options: ExecuteRunOptions = {}): Promise<ExecuteRunResult> {
  const { runId, config, roleGroups, token } = await createPendingRun(options);
  return executeRunFromRecord(runId, config, roleGroups, token, options);
}

// ─── Internal Helpers ──────────────────────────────────────────────────────────

function getSearchQueries(roleGroups: string[], testMode: boolean, customKeywords: string[]): string[] {
  const titles = getTitlesForGroups(roleGroups);
  const merged = [...new Set([...titles, ...customKeywords.map((k) => k.trim()).filter(Boolean)])];
  if (testMode) {
    const testSet = ["OSP Design Engineer", "Fiber Design Engineer", "AutoCAD Drafter", "GIS Analyst", "GIS Technician"];
    return testSet.filter((t) => merged.includes(t));
  }
  return merged;
}

async function startApifyRun(
  actorId: string,
  token: string,
  input: Record<string, unknown>,
  timeoutSeconds = 3600
): Promise<{ runId: string; datasetId: string }> {
  // Per-actor timeout: Google is capped at 100 results so 30 min is ample;
  // Indeed/LinkedIn can have larger datasets so they get 1 hour.
  const url = `${APIFY_BASE_URL}/acts/${encodeURIComponent(actorId)}/runs?token=${encodeURIComponent(token)}&timeout=${timeoutSeconds}`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) { const text = await res.text().catch(() => ""); throw new Error(`Apify start run failed (${res.status}): ${text}`); }
  const data = await res.json();
  const runId = data?.data?.id; const datasetId = data?.data?.defaultDatasetId;
  if (!runId || !datasetId) throw new Error("Apify response missing runId/datasetId");
  return { runId, datasetId };
}

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

// ─── Normalized Job Shape ──────────────────────────────────────────────────────

interface NormalizedJob {
  hash: string;
  urlHash: string;          // URL fingerprint for cross-actor dedup
  job_title: string;
  company_name: string | null;
  location: string | null;
  salary_range: string | null;
  salary_min: number | null;
  salary_max: number | null;
  date_posted: string | null;
  via_platform: string | null;
  source_url: string | null;
  apply_link: string | null;
  is_remote: boolean | null;
  employment_type: string | null;
  search_query_used: string | null;
  description_text: string | null;
  raw: ApifyDatasetItem;
}

function normalizeItem(item: ApifyDatasetItem): NormalizedJob {
  const jobTitle  = String(item.job_title ?? item.title ?? "").trim();
  const companyName = String(item.company_name ?? item.company ?? "").trim() || null;
  const location  = String(item.location ?? "").trim() || null;
  const applyLink = String(item.apply_link ?? item.apply_url ?? item.source_url ?? item.url ?? "").trim() || null;
  const sourceUrl = String(item.source_url ?? item.url ?? applyLink ?? "").trim() || null;
  const salaryRange = String(item.salary_range ?? item.salary ?? "").trim() || null;
  const { salaryMin, salaryMax } = parseSalary(salaryRange);
  const desc = String(item.description ?? item.description_text ?? "").trim();
  const urlHash = normalizeUrlFingerprint(applyLink ?? sourceUrl);

  return {
    hash: dedupHash(jobTitle, companyName, location, urlHash),
    urlHash,
    job_title: jobTitle,
    company_name: companyName,
    location,
    salary_range: salaryRange,
    salary_min: salaryMin,
    salary_max: salaryMax,
    date_posted: String(item.date_posted ?? item.posted_at ?? "").trim() || null,
    via_platform: String(item.via_platform ?? item.platform ?? "").trim() || null,
    source_url: sourceUrl,
    apply_link: applyLink,
    is_remote: typeof item.is_remote === "boolean" ? item.is_remote : typeof item.remote === "boolean" ? item.remote : null,
    employment_type: String(item.employment_type ?? "").trim() || null,
    search_query_used: String(item.search_query ?? item.searchQueryUsed ?? item.query ?? "").trim() || null,
    description_text: desc || null,
    raw: item,
  };
}

function parseSalary(s: string | null) {
  if (!s) return { salaryMin: null as number | null, salaryMax: null as number | null };
  const m = s.match(/\$?([\d,]+(?:\.\d+)?)\s*[-–]\s*\$?([\d,]+(?:\.\d+)?)/);
  if (!m) return { salaryMin: null, salaryMax: null };
  const min = parseFloat(m[1].replace(/,/g, ""));
  const max = parseFloat(m[2].replace(/,/g, ""));
  return { salaryMin: Number.isFinite(min) ? min : null, salaryMax: Number.isFinite(max) ? max : null };
}

/**
 * Enhanced dedup hash: title + company + location + URL fingerprint.
 * The URL fingerprint catches cross-actor duplicates where the same job is
 * posted on both Indeed and LinkedIn (same apply link, different field names).
 */
export function dedupHash(title: string, company: string | null, location: string | null, urlHash = ""): string {
  const base = `${title}|${company ?? ""}|${location ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Append url hash separately so a missing URL doesn't break existing hashes
  if (urlHash) return `${base}|${urlHash}`;
  return base;
}

export function normalizeForFuzzyMatch(s: string | null): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isNonUSLocation(loc: string | null): boolean {
  if (!loc) return false;
  const l = loc.toLowerCase();
  const nonUs = ["uk", "united kingdom", "canada", "australia", "india", "europe", "germany", "france", "philippines", "mexico", "brazil", "spain", "ireland", "south africa", "netherlands", "sweden", "poland"];
  for (const c of nonUs) {
    if (l === c || l.endsWith(", " + c)) return true;
  }
  if (l.includes("london, eng") || l.includes("london, uk") || l.includes("toronto, on")) return true;
  return false;
}

function dedupeInRun(items: ApifyDatasetItem[]): { deduped: NormalizedJob[]; duplicateCount: number } {
  const seenHashes = new Set<string>();
  const seenUrls   = new Set<string>();
  const deduped: NormalizedJob[] = [];
  let dc = 0;

  for (const item of items) {
    const n = normalizeItem(item);
    if (!n.job_title) continue;
    if (isNonUSLocation(n.location)) { dc++; continue; }

    // User requested: Dedupe strongly by apply link if available
    if (n.urlHash && seenUrls.has(n.urlHash)) {
      dc++;
      continue;
    }
    // Fallback to title/company hash if no reliable URL
    if (seenHashes.has(n.hash)) {
      dc++;
      continue;
    }
    seenHashes.add(n.hash);
    if (n.urlHash) seenUrls.add(n.urlHash);
    deduped.push(n);
  }

  return { deduped, duplicateCount: dc };
}

async function dedupeAcrossRunsAndJobs(jobs: NormalizedJob[]): Promise<{ uniqueJobs: NormalizedJob[]; duplicateCount: number }> {
  const hashes   = jobs.map((j) => j.hash);
  const urlHashes = jobs.map((j) => j.urlHash).filter(Boolean) as string[];

  // Check existing staged-job hashes (30-day window)
  const existingStagedHashes  = await getDedupHashes(hashes);
  // Check existing staged-job URL hashes (catches cross-actor duplicates in the same 30-day window)
  const existingStagedUrlHashes = urlHashes.length > 0 ? await getSourceUrlHashes(urlHashes) : new Set<string>();
  // Check final jobs table via fuzzy match
  const existingJobs = await listAllJobsForFuzzyDedupe();

  const uniqueJobs: NormalizedJob[] = [];
  let dc = 0;

  for (const job of jobs) {
    // Layer 3a: hash match
    if (existingStagedHashes.has(job.hash)) {
      job.raw._duplicate = true; dc++; continue;
    }
    // Layer 3b: URL fingerprint match (cross-actor dedup)
    if (job.urlHash && existingStagedUrlHashes.has(job.urlHash)) {
      job.raw._duplicate = true; dc++; continue;
    }
    // Layer 4: final jobs table fuzzy match
    const nj = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (existingJobs.some((e) =>
      nj(job.job_title) === nj(e.title) &&
      nj(job.company_name) === nj(e.company) &&
      nj(job.location) === nj(e.location)
    )) {
      job.raw._duplicate = true; dc++; continue;
    }
    uniqueJobs.push(job);
  }

  return { uniqueJobs, duplicateCount: dc };
}

// ─── Classification ────────────────────────────────────────────────────────────

interface ClassifiedJob extends NormalizedJob {
  role_group: string | null;
  role_group_label: string | null;
  seniority_guess: string;
  tier: string;
  tier_reason: string;
  ai_keywords: string[];
  relevance_score: number;
  is_false_positive: boolean;
}

async function classifyJobs(jobs: NormalizedJob[], useAi: boolean): Promise<ClassifiedJob[]> {
  if (jobs.length === 0) return [];

  const CONCURRENCY = 15;
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

    if (batchStart + CONCURRENCY < jobs.length) {
      await new Promise((r) => setTimeout(r, CLASSIFICATION_DELAY_MS));
    }
  }

  return classified;
}

function toStagedJobRow(runId: string, job: ClassifiedJob): Omit<JobAgentStagedJobRow, "id" | "created_at"> {
  return {
    run_id: runId,
    job_title: job.job_title,
    company_name: job.company_name,
    location: job.location,
    salary_range: job.salary_range,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    date_posted: job.date_posted,
    via_platform: job.via_platform,
    source_url: job.source_url,
    apply_link: job.apply_link,
    is_remote: job.is_remote,
    employment_type: job.employment_type,
    search_query_used: job.search_query_used,
    role_group: job.role_group,
    role_group_label: job.role_group_label,
    seniority_guess: job.seniority_guess,
    tier: job.tier,
    tier_reason: job.tier_reason,
    ai_keywords: job.ai_keywords,
    relevance_score: job.relevance_score,
    is_false_positive: job.is_false_positive,
    dedup_hash: job.hash,
    source_url_hash: job.urlHash || null,
    is_duplicate: job.raw._duplicate === true,
    import_status: "staged",
    imported_job_id: null,
    description_text: job.description_text,
    company_website: null,
    external_job_id: null,
    country: null,
    industry: null,
  };
}

export async function testApifyToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${APIFY_BASE_URL}/user/me?token=${encodeURIComponent(token)}`);
    if (!res.ok) { const text = await res.text().catch(() => ""); return { ok: false, error: `Apify returned ${res.status}` }; }
    return { ok: true };
  } catch (err: any) { return { ok: false, error: err.message ?? "Request failed" }; }
}
