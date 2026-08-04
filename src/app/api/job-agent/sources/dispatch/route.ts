// src/app/api/job-agent/sources/dispatch/route.ts
// POST -> generic dispatcher for the 7 new job_sources (registry.ts). Loops
// over every enabled source, checks its budget, fetches, dedupes against
// the SAME job_agent_staged_jobs tables the Apify/openjobdata paths use,
// classifies, and stages — reusing the exact primitives jobAgentService.ts
// already relies on (dedupHash, getDedupHashes, getSourceUrlHashes,
// listAllJobsForFuzzyDedupe, classifyJob) rather than duplicating dedup logic.
//
// One cron entry replaces what would otherwise be a new GitHub Actions job
// block per source — see scheduled-jobs.yml for how to wire this in (a new
// `*/30 * * * *` entry calling this route, same CRON_SECRET bearer pattern
// every other /api/cron/* and /api/job-agent/* route already uses).
//
// NOT wired into scheduled-jobs.yml yet — calling this today is a no-op
// because every job_sources row is seeded is_enabled=false (043 migration).

import { NextRequest, NextResponse } from "next/server";
import { getDefaultConfig } from "@/server/repositories/jobAgentConfigRepository";
import {
  createRun,
  updateRunStatus,
  insertStagedJobs,
  getDedupHashes,
  getSourceUrlHashes,
  type JobAgentStagedJobRow,
} from "@/server/repositories/jobAgentRunRepository";
import { listAllJobsForFuzzyDedupe } from "@/server/repositories/jobsRepository";
import {
  listJobSources,
  checkSourceBudget,
  recordSourceUsage,
  type JobSourceRow,
} from "@/server/repositories/jobSourceRepository";
import { dedupHash, normalizeForFuzzyMatch } from "@/server/services/jobAgentService";
import { classifyJob } from "@/lib/ai/jobAgentClassifier";
import { getGroupForSearchQuery, getGroupLabel, getTitlesForGroups } from "@/lib/jobAgentRoleLibrary";
import { getJobSourceAdapter } from "@/lib/jobSources/registry";
import type { NormalizedJob } from "@/lib/jobSources/types";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const CLASSIFY_CONCURRENCY = 15;
const POSTED_WITHIN_DAYS = 14;

interface DispatchOneResult {
  sourceId: string;
  status: "success" | "failure" | "skipped_budget";
  fetched: number;
  staged: number;
  duplicates: number;
  error?: string;
}

async function dispatchOneSource(source: JobSourceRow, roleGroups: string[]): Promise<DispatchOneResult> {
  const adapter = getJobSourceAdapter(source.id);
  if (!adapter) {
    return { sourceId: source.id, status: "failure", fetched: 0, staged: 0, duplicates: 0, error: "No adapter registered" };
  }

  const budgetCheck = await checkSourceBudget(source);
  if (!budgetCheck.allowed) {
    await recordSourceUsage({
      sourceId: source.id, runId: null, recordsFetched: 0, recordsStaged: 0,
      estimatedCostUsd: 0, outcome: "skipped_budget", errorMessage: budgetCheck.reason ?? null,
    });
    return { sourceId: source.id, status: "skipped_budget", fetched: 0, staged: 0, duplicates: 0, error: budgetCheck.reason };
  }

  const credentials = source.credentials_ref ? process.env[source.credentials_ref] : undefined;
  if (!credentials) {
    return { sourceId: source.id, status: "failure", fetched: 0, staged: 0, duplicates: 0, error: `Missing credentials for env var ${source.credentials_ref}` };
  }

  const config = await getDefaultConfig();
  const effectiveGroups = source.role_groups.length > 0 ? source.role_groups : roleGroups;
  const queries = getTitlesForGroups(effectiveGroups);

  const start = Date.now();
  const run = await createRun(config.id, effectiveGroups, null, source.id);

  try {
    await updateRunStatus(run.id, { status: "running" });

    const { jobs, recordsFetched, estimatedCostUsd } = await adapter.fetchJobs(
      {
        queries,
        roleGroup: effectiveGroups[0] ?? "?",
        roleGroupLabel: effectiveGroups[0] ? getGroupLabel(effectiveGroups[0]) : "Unknown",
        maxResults: config.max_results,
        postedWithinDays: POSTED_WITHIN_DAYS,
      },
      credentials
    );

    // Layer 1: in-batch dedup (same title+company+location+url hash strategy
    // as jobAgentService.ts's dedupeInRun — kept local here since that
    // function isn't exported).
    const seenHashes = new Set<string>();
    const seenUrls = new Set<string>();
    const inBatchUnique: (NormalizedJob & { hash: string; urlHash: string })[] = [];
    for (const job of jobs) {
      if (!job.title) continue;
      const urlHash = job.sourceUrl ? Buffer.from(job.sourceUrl).toString("base64").slice(0, 32) : "";
      const hash = dedupHash(job.title, job.company, job.location, urlHash);
      if (urlHash && seenUrls.has(urlHash)) continue;
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
      if (urlHash) seenUrls.add(urlHash);
      inBatchUnique.push({ ...job, hash, urlHash });
    }

    // Layer 2/3: cross-run + cross-source dedup against the last 30 days of
    // staged jobs (catches the same posting arriving via a different source).
    const hashes = inBatchUnique.map((j) => j.hash);
    const urlHashes = inBatchUnique.map((j) => j.urlHash).filter(Boolean);
    const existingStagedHashes = await getDedupHashes(hashes);
    const existingStagedUrlHashes = urlHashes.length > 0 ? await getSourceUrlHashes(urlHashes) : new Set<string>();

    // Layer 4: fuzzy match against the live jobs table.
    const existingJobs = await listAllJobsForFuzzyDedupe();
    const nj = normalizeForFuzzyMatch;

    let duplicateCount = 0;
    const uniqueJobs = inBatchUnique.filter((job) => {
      if (existingStagedHashes.has(job.hash)) { duplicateCount++; return false; }
      if (job.urlHash && existingStagedUrlHashes.has(job.urlHash)) { duplicateCount++; return false; }
      const isDup = existingJobs.some(
        (e) => nj(job.title) === nj(e.title) && nj(job.company) === nj(e.company) && nj(job.location) === nj(e.location)
      );
      if (isDup) { duplicateCount++; return false; }
      return true;
    });

    // Classify in batches, same concurrency as jobAgentService.ts's classifyJobs.
    const stagedRows: Omit<JobAgentStagedJobRow, "id" | "created_at">[] = [];
    for (let i = 0; i < uniqueJobs.length; i += CLASSIFY_CONCURRENCY) {
      const batch = uniqueJobs.slice(i, i + CLASSIFY_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (job) => {
          const group = getGroupForSearchQuery(job.title);
          const gid = group?.id ?? effectiveGroups[0] ?? null;
          const gl = gid ? getGroupLabel(gid) : null;
          const c = await classifyJob(
            { title: job.title, company_name: job.company, search_query: job.title, role_group: gid ?? "?", role_group_label: gl ?? "Unknown" },
            { useAi: true }
          );
          const row: Omit<JobAgentStagedJobRow, "id" | "created_at"> = {
            run_id: run.id,
            job_title: job.title,
            company_name: job.company,
            location: job.location,
            salary_range: job.salaryRange,
            salary_min: job.salaryMin,
            salary_max: job.salaryMax,
            date_posted: job.postedAt,
            via_platform: source.id, // e.g. "theirstack" — same slot openjobdata/apify use
            source_url: job.sourceUrl,
            apply_link: job.applyUrl,
            is_remote: job.isRemote,
            employment_type: job.employmentType,
            search_query_used: job.title,
            role_group: gid,
            role_group_label: gl,
            seniority_guess: c.seniority,
            tier: c.tier,
            tier_reason: c.tier_reason,
            ai_keywords: c.keywords,
            relevance_score: c.relevance_score,
            is_false_positive: c.is_false_positive,
            dedup_hash: job.hash,
            source_url_hash: job.urlHash || null,
            is_duplicate: false,
            import_status: "staged",
            imported_job_id: null,
            description_text: job.descriptionText,
            company_website: job.companyWebsite,
            external_job_id: job.externalJobId,
            country: job.country,
            industry: job.industry,
          };
          return row;
        })
      );
      stagedRows.push(...results);
    }

    await insertStagedJobs(run.id, stagedRows);

    await updateRunStatus(run.id, {
      status: "succeeded",
      raw_count: recordsFetched,
      deduped_count: inBatchUnique.length,
      skipped_count: duplicateCount,
      classified_count: stagedRows.length,
      estimated_cost_usd: estimatedCostUsd,
      completed_at: new Date().toISOString(),
    });

    await recordSourceUsage({
      sourceId: source.id, runId: run.id, recordsFetched, recordsStaged: stagedRows.length,
      estimatedCostUsd, outcome: "success", latencyMs: Date.now() - start,
    });

    return { sourceId: source.id, status: "success", fetched: recordsFetched, staged: stagedRows.length, duplicates: duplicateCount };
  } catch (err: any) {
    const message = err.message ?? "Unknown error";
    await updateRunStatus(run.id, { status: "failed", error: message, completed_at: new Date().toISOString() });
    await recordSourceUsage({
      sourceId: source.id, runId: run.id, recordsFetched: 0, recordsStaged: 0,
      estimatedCostUsd: 0, outcome: "failure", errorMessage: message, latencyMs: Date.now() - start,
    });
    return { sourceId: source.id, status: "failure", fetched: 0, staged: 0, duplicates: 0, error: message };
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let roleGroups: string[] = [];
  try {
    const body = await req.json().catch(() => ({}));
    roleGroups = Array.isArray(body.roleGroups) ? body.roleGroups : [];
  } catch {
    // no body is fine — falls through to per-source role_groups
  }

  const sources = await listJobSources({ enabledOnly: true });
  if (sources.length === 0) {
    return NextResponse.json({ message: "No enabled job sources — nothing to dispatch.", results: [] });
  }

  const results: DispatchOneResult[] = [];
  for (const source of sources) {
    // Sequential, not parallel — different sources have different rate
    // limits (job_sources.rate_limit_per_second), and running them one at a
    // time keeps this simple. Revisit if dispatch latency becomes an issue.
    results.push(await dispatchOneSource(source, roleGroups));
  }

  return NextResponse.json({ results });
}
