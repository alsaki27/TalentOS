// src/server/services/jobAgentService.ts
// Multi-actor Apify orchestration service.
// Supports: Indeed (familiar_universality/indeed), Google Jobs (johnvc/google-jobs-scraper), LinkedIn (cheap_scraper/linkedin-job-scraper)
// Token rotation, 4-layer deduplication, and actor-aware field normalization.

import { getDefaultConfig, type JobAgentConfigRow } from "@/server/repositories/jobAgentConfigRepository";
import { createRun, updateRunStatus, transitionRunStatus, insertStagedJobs, getDedupHashes, getSourceUrlHashes, type JobAgentStagedJobRow } from "@/server/repositories/jobAgentRunRepository";
import { rotateToken, markTokenError, deactivateToken } from "@/server/repositories/jobAgentTokenRepository";
import { listAllJobsForFuzzyDedupe } from "@/server/repositories/jobsRepository";
import { getTitlesForGroups, getGroupForSearchQuery, getGroupById, getGroupLabel, inferRoleGroupForTitle, validateRoleGroups } from "@/lib/jobAgentRoleLibrary";
import { classifyJob } from "@/lib/ai/jobAgentClassifier";
import {
  buildActorInput as buildActorContractInput,
  normalizeActorItem as normalizeActorContractItem,
} from "@/lib/jobAgentActorContracts";
import {
  filterItemsToDateWindow,
  type DateExclusionReason,
  type ExcludedDateWindowItem,
} from "@/lib/jobAgentDateWindow";

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

// ─── Actor Input Builders ──────────────────────────────────────────────────────

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
  /** Per-shard ceiling supplied by the nightly batch matrix. */
  maxResults?: number;
  /** Required for precise one-role-group Google shards; otherwise built from queries. */
  explicitGoogleQuery?: string;
  /** Immutable title-query snapshot for durable nightly retries. */
  explicitQueries?: string[];
  /** Nightly shards reserve token budget up front and must not rotate outside that reservation. */
  allowTokenRotation?: boolean;
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

      const searchQueries = options.explicitQueries?.length
        ? [...options.explicitQueries]
        : getSearchQueries(roleGroups, options.testMode ?? false, options.customKeywords ?? []);
      const requestedMax = options.maxResults ?? (options.testMode ? 50 : 500);
      // A durable batch stores its own immutable per-shard allocation. Generic
      // manual runs still respect the editable dashboard configuration.
      const maxResults = Math.max(
        1,
        options.maxResults === undefined
          ? Math.min(requestedMax, config.max_results)
          : requestedMax,
      );

      const actorId = ACTOR_IDS[actorSource];

      const apifyInput = buildActorContractInput({
        actorSource,
        queries: searchQueries,
        dateInterval: options.dateInterval,
        maxResults,
        explicitGoogleQuery: options.explicitGoogleQuery,
      });

      // Google shards are small enough for 30 minutes; Indeed/LinkedIn get 1 hour.
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

        if (options.allowTokenRotation === false) {
          await updateRunStatus(runId, {
            status: "failed",
            error: message,
            completed_at: new Date().toISOString(),
          });
          throw err;
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
export interface ProcessApifyRunOptions {
  useAi?: boolean;
  actorSource?: ActorSource;
  roleGroups?: string[];
  windowStart?: string;
  windowEnd?: string;
  dateReferenceStartTime?: string;
  dateReferenceTime?: string;
  /** Preserve candidates from sibling shards until deterministic batch finalization. */
  batchId?: string;
}

export interface ProcessApifyRunResult {
  rawCount: number;
  dateIncludedCount: number;
  dateExcludedCount: number;
  dateExclusionReasons: Record<DateExclusionReason, number>;
  duplicateCount: number;
  classifiedCount: number;
}

export async function processApifyRunData(
  runId: string,
  datasetId: string,
  token: string,
  options: ProcessApifyRunOptions = {}
): Promise<ProcessApifyRunResult> {
  const actorSource = options.actorSource ?? "indeed";
  try {
    const rawItems = await fetchApifyDataset(datasetId, token);
    const normalizedItems = rawItems.map((item) =>
      normalizeActorContractItem(actorSource, item as Record<string, unknown>),
    );
    const rawCount = normalizedItems.length;
    await updateRunStatus(runId, { raw_count: rawCount });

    if ((options.windowStart && !options.windowEnd) || (!options.windowStart && options.windowEnd)) {
      throw new Error("Both windowStart and windowEnd are required for date-window filtering.");
    }

    let items = normalizedItems;
    let dateExcludedItems: Array<ExcludedDateWindowItem<ApifyDatasetItem>> = [];
    let dateExcludedCount = 0;
    let dateExclusionReasons: Record<DateExclusionReason, number> = {
      missing_date: 0,
      unparseable_date: 0,
      ambiguous_date: 0,
      before_window: 0,
      after_window: 0,
    };
    if (options.windowStart && options.windowEnd) {
      const dateFilter = filterItemsToDateWindow(normalizedItems, {
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        referenceStartTime: options.dateReferenceStartTime,
        referenceTime: options.dateReferenceTime ?? options.windowEnd,
      });
      items = dateFilter.included;
      dateExcludedItems = dateFilter.excluded;
      dateExcludedCount = dateFilter.excluded.length;
      dateExclusionReasons = dateFilter.reasonCounts;
      console.info("[jobAgentService] Posting-date window audit", {
        runId,
        actorSource,
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        included: items.length,
        excluded: dateExcludedCount,
        reasons: dateExclusionReasons,
      });
    }

    const { deduped, duplicateCount: inRunDups } = dedupeInRun(items);
    const { uniqueJobs, duplicateCount: crossRunDups } = await dedupeAcrossRunsAndJobs(
      deduped,
      options.batchId,
    );
    const totalDupes = inRunDups + crossRunDups;

    // Vercel serverless functions time out after 10-60s. AI classification takes ~1-2s per batch of 15.
    // For massive datasets (> 250 unique jobs), force regex fallback to guarantee completion and prevent hanging.
    const requestedAi = options.useAi ?? true;
    const safeUseAi = requestedAi && (uniqueJobs.length <= 250);
    
    if (requestedAi && !safeUseAi) {
      console.warn(`[jobAgentService] Dataset too large (${uniqueJobs.length} unique jobs). Falling back to regex classification to prevent serverless timeout.`);
    }

    const classifiedJobs = await classifyJobs(uniqueJobs, safeUseAi, options.roleGroups);
    const dateCheckedAt = options.windowStart && options.windowEnd ? new Date().toISOString() : null;
    const stagedRows = classifiedJobs.map((j) => {
      const canonicalSignature = canonicalStagedSignature(j);
      return {
        ...toStagedJobRow(runId, j),
        canonical_signature: canonicalSignature,
        parsed_posted_at: dateCheckedAt ? j.date_posted : null,
        date_window_status: dateCheckedAt ? "in_window" as const : "not_checked" as const,
        date_exclusion_reason: null,
        date_checked_at: dateCheckedAt,
      };
    });
    const excludedAuditRows = dateCheckedAt
      ? dateExcludedItems
        .map(({ item, rawDate, reason }) => toDateExcludedStagedJob(
          runId,
          normalizeItem(item),
          rawDate,
          reason,
          dateCheckedAt,
          options.roleGroups,
        ))
        .filter((row): row is Omit<JobAgentStagedJobRow, "id" | "created_at"> => Boolean(row))
      : [];
    await insertStagedJobs(runId, [...stagedRows, ...excludedAuditRows]);

    const classifiedCount = stagedRows.filter((j) => !j.is_duplicate).length;
    const estimatedCostUsd = rawCount * COST_PER_RESULT_USD;

    const completed = await transitionRunStatus(runId, "processing", {
      status: "succeeded",
      date_excluded_count: dateExcludedCount,
      date_exclusion_reasons: dateExclusionReasons,
      processing_started_at: null,
      deduped_count: deduped.length,
      skipped_count: totalDupes + dateExcludedCount,
      classified_count: classifiedCount,
      estimated_cost_usd: estimatedCostUsd,
      completed_at: new Date().toISOString(),
    });
    if (!completed) {
      throw new Error("Run processing lease was lost before completion");
    }
    return {
      rawCount,
      dateIncludedCount: items.length,
      dateExcludedCount,
      dateExclusionReasons,
      duplicateCount: totalDupes,
      classifiedCount,
    };
  } catch (err: any) {
    const message = err.message ?? "Processing failed";
    await transitionRunStatus(runId, "processing", {
      status: "failed",
      error: message,
      processing_started_at: null,
      completed_at: new Date().toISOString(),
    }).catch(() => false);
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

async function dedupeAcrossRunsAndJobs(
  jobs: NormalizedJob[],
  excludeBatchId?: string,
): Promise<{ uniqueJobs: NormalizedJob[]; duplicateCount: number }> {
  const hashes   = jobs.map((j) => j.hash);
  const urlHashes = jobs.map((j) => j.urlHash).filter(Boolean) as string[];

  // Check existing staged-job hashes (30-day window)
  const existingStagedHashes  = await getDedupHashes(hashes, excludeBatchId);
  // Check existing staged-job URL hashes (catches cross-actor duplicates in the same 30-day window)
  const existingStagedUrlHashes = urlHashes.length > 0
    ? await getSourceUrlHashes(urlHashes, excludeBatchId)
    : new Set<string>();
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

async function classifyJobs(
  jobs: NormalizedJob[],
  useAi: boolean,
  fallbackRoleGroups: string[] = [],
): Promise<ClassifiedJob[]> {
  if (jobs.length === 0) return [];

  const CONCURRENCY = 15;
  const classified: ClassifiedJob[] = [];

  for (let batchStart = 0; batchStart < jobs.length; batchStart += CONCURRENCY) {
    const batch = jobs.slice(batchStart, batchStart + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        const group =
          (job.search_query_used ? getGroupForSearchQuery(job.search_query_used) : undefined) ??
          getGroupForSearchQuery(job.job_title) ??
          inferRoleGroupForTitle(job.job_title, fallbackRoleGroups) ??
          (fallbackRoleGroups.length === 1
            ? getGroupById(fallbackRoleGroups[0])
            : undefined);
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

function canonicalStagedSignature(job: Pick<NormalizedJob, "job_title" | "company_name" | "location" | "urlHash" | "hash">): string {
  const title = job.job_title.trim().toLowerCase().replace(/\s+/g, " ");
  const company = (job.company_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const location = (job.location ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (title && company) return `${title}|${company}|${location || "unknown-location"}`;
  if (job.urlHash) return `url|${job.urlHash}`;
  return job.hash;
}

function toDateExcludedStagedJob(
  runId: string,
  job: NormalizedJob,
  rawDate: string | null,
  reason: DateExclusionReason,
  checkedAt: string,
  roleGroups: string[] | undefined,
): Omit<JobAgentStagedJobRow, "id" | "created_at"> | null {
  if (!job.job_title) return null;
  const queryGroup = job.search_query_used
    ? getGroupForSearchQuery(job.search_query_used)
    : undefined;
  const soleGroup = roleGroups?.length === 1 ? getGroupById(roleGroups[0]) : undefined;
  const group = queryGroup ?? soleGroup;
  return {
    run_id: runId,
    job_title: job.job_title,
    company_name: job.company_name,
    location: job.location,
    salary_range: job.salary_range,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    date_posted: rawDate,
    via_platform: job.via_platform,
    source_url: job.source_url,
    apply_link: job.apply_link,
    is_remote: job.is_remote,
    employment_type: job.employment_type,
    search_query_used: job.search_query_used,
    role_group: group?.id ?? null,
    role_group_label: group?.label ?? null,
    seniority_guess: "unknown",
    tier: "skip",
    tier_reason: `Posting date excluded: ${reason}`,
    ai_keywords: [],
    relevance_score: 0,
    is_false_positive: false,
    dedup_hash: job.hash,
    source_url_hash: job.urlHash || null,
    canonical_signature: `excluded|${reason}|${canonicalStagedSignature(job)}|${job.hash}`,
    parsed_posted_at: null,
    date_window_status: "excluded",
    date_exclusion_reason: reason,
    import_exclusion_reason: `date_${reason}`,
    date_checked_at: checkedAt,
    batch_dedup_score: null,
    batch_dedup_winner: false,
    is_duplicate: false,
    import_status: "rejected",
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
