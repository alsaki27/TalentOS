// src/app/api/job-agent/openjobdata-ingest/route.ts
// POST -> ingest a batch of jobs already scanned/filtered from the openjobdata.com
// dataset (scripts/openjobdata_ingest.py) into the SAME job_agent staging pipeline
// the Apify path uses: dedupe (in-batch, cross-run, cross-jobs-table), classify via
// the shared AI classifier, insert into job_agent_staged_jobs, then the existing
// review UI / approve route promotes staged rows into the main jobs table exactly
// as it already does for Apify runs. openjobdata is the ingestion source here, not
// a parallel structure — see comparison_report.md's recommendation to give
// openjobdata the broad, scheduled "nightly ingestion" role.
//
// Not a session-cookie route (called by a GitHub Actions workflow, not a logged-in
// user) — authenticated via the same CRON_SECRET bearer pattern as the other cron
// endpoints. src/middleware.ts must allow this exact path through unauthenticated.

import { NextRequest, NextResponse } from "next/server";
import {
  createRun,
  updateRunStatus,
  insertStagedJobs,
  getDedupHashes,
  type JobAgentStagedJobRow,
} from "@/server/repositories/jobAgentRunRepository";
import { getDefaultConfig } from "@/server/repositories/jobAgentConfigRepository";
import { listAllJobsForFuzzyDedupe } from "@/server/repositories/jobsRepository";
import { dedupHash, normalizeForFuzzyMatch } from "@/server/services/jobAgentService";
import { classifyJob } from "@/lib/ai/jobAgentClassifier";
import { getGroupLabel } from "@/lib/jobAgentRoleLibrary";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Contract produced by scripts/openjobdata_common.py's run_keyword_ingest() —
// keep the two in sync. Every field here has a home either in job_agent_staged_jobs
// directly, or (via jobAgentImporter's stagedJobToJobRow) in the jobs table, so
// nothing openjobdata provides is silently dropped on the way in.
interface OpenJobDataIngestJob {
  title: string;
  company: string | null;
  company_website: string | null;
  industry: string | null;
  location: string | null;
  country: string | null;
  employment_type: string | null;
  is_remote: boolean | null;
  posted_at: string | null; // "YYYY-MM-DD"
  apply_url: string | null;
  external_job_id: string | null;
  description_text: string | null;
}

interface IngestRequestBody {
  roleGroup: string;
  roleGroupLabel?: string;
  useAi?: boolean;
  jobs: OpenJobDataIngestJob[];
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as IngestRequestBody;
  const roleGroup = String(body.roleGroup ?? "").trim();
  const roleGroupLabel = body.roleGroupLabel ?? getGroupLabel(roleGroup);
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  const useAi = body.useAi ?? true;

  if (!roleGroup) {
    return NextResponse.json({ error: "roleGroup is required" }, { status: 400 });
  }
  if (jobs.length === 0) {
    return NextResponse.json({ ok: true, message: "No jobs in payload — nothing to do." });
  }

  const config = await getDefaultConfig();
  const run = await createRun(config.id, [roleGroup], null);

  try {
    await updateRunStatus(run.id, { status: "running", raw_count: jobs.length });

    // In-batch dedup (same job can legitimately appear twice if it matched more
    // than one keyword variant upstream).
    const seenInBatch = new Set<string>();
    const deduped: { job: OpenJobDataIngestJob; hash: string }[] = [];
    let inBatchDupes = 0;
    for (const job of jobs) {
      const title = String(job.title ?? "").trim();
      if (!title) continue;
      const hash = dedupHash(title, job.company, job.location);
      if (seenInBatch.has(hash)) {
        inBatchDupes++;
        continue;
      }
      seenInBatch.add(hash);
      deduped.push({ job: { ...job, title }, hash });
    }

    // Cross-run dedup (same hash already staged from a previous run in the last 30 days).
    const existingStagedHashes = await getDedupHashes(deduped.map((d) => d.hash));

    // Cross-jobs-table fuzzy dedup (same title+company+location already imported).
    const existingJobs = await listAllJobsForFuzzyDedupe();
    const existingJobKeys = new Set(
      existingJobs.map(
        (e) => `${normalizeForFuzzyMatch(e.title)}|${normalizeForFuzzyMatch(e.company)}|${normalizeForFuzzyMatch(e.location)}`
      )
    );

    let crossDupes = 0;
    const unique: { job: OpenJobDataIngestJob; hash: string }[] = [];
    for (const entry of deduped) {
      if (existingStagedHashes.has(entry.hash)) {
        crossDupes++;
        continue;
      }
      const key = `${normalizeForFuzzyMatch(entry.job.title)}|${normalizeForFuzzyMatch(entry.job.company)}|${normalizeForFuzzyMatch(entry.job.location)}`;
      if (existingJobKeys.has(key)) {
        crossDupes++;
        continue;
      }
      unique.push(entry);
    }

    // Classify via the same AI classifier the Apify path uses, so both sources end
    // up with a consistent tier/relevance_score/seniority_guess in the review UI.
    const CONCURRENCY = 5;
    const CLASSIFICATION_DELAY_MS = 300;
    const stagedRows: Omit<JobAgentStagedJobRow, "id" | "created_at">[] = [];

    for (let i = 0; i < unique.length; i += CONCURRENCY) {
      const batch = unique.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ({ job, hash }) => {
          const c = await classifyJob(
            {
              title: job.title,
              company_name: job.company,
              search_query: job.title,
              role_group: roleGroup,
              role_group_label: roleGroupLabel,
            },
            { useAi }
          );
          const row: Omit<JobAgentStagedJobRow, "id" | "created_at"> = {
            run_id: run.id,
            job_title: job.title,
            company_name: job.company,
            location: job.location,
            salary_range: null,
            salary_min: null,
            salary_max: null,
            date_posted: job.posted_at,
            via_platform: "openjobdata",
            source_url: job.apply_url,
            apply_link: job.apply_url,
            is_remote: job.is_remote,
            employment_type: job.employment_type,
            search_query_used: job.title,
            role_group: roleGroup,
            role_group_label: roleGroupLabel,
            seniority_guess: c.seniority,
            tier: c.tier,
            tier_reason: c.tier_reason,
            ai_keywords: c.keywords,
            relevance_score: c.relevance_score,
            is_false_positive: c.is_false_positive,
            dedup_hash: hash,
            is_duplicate: false,
            import_status: "staged",
            imported_job_id: null,
            description_text: job.description_text,
            company_website: job.company_website,
            external_job_id: job.external_job_id,
            country: job.country,
            industry: job.industry,
          };
          return row;
        })
      );
      stagedRows.push(...results);
      if (i + CONCURRENCY < unique.length) {
        await new Promise((r) => setTimeout(r, CLASSIFICATION_DELAY_MS));
      }
    }

    await insertStagedJobs(run.id, stagedRows);

    await updateRunStatus(run.id, {
      status: "succeeded",
      deduped_count: deduped.length,
      skipped_count: inBatchDupes + crossDupes,
      classified_count: stagedRows.length,
      estimated_cost_usd: 0, // openjobdata is free — see comparison_report.md
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      ok: true,
      runId: run.id,
      rawCount: jobs.length,
      inBatchDuplicates: inBatchDupes,
      crossRunOrExistingDuplicates: crossDupes,
      stagedCount: stagedRows.length,
    });
  } catch (err: any) {
    const message = err?.message ?? "Ingest failed";
    await updateRunStatus(run.id, { status: "failed", error: message, completed_at: new Date().toISOString() });
    return NextResponse.json({ error: message, runId: run.id }, { status: 500 });
  }
}
