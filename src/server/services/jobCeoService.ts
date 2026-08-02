// Orchestrates the multi-agent JOB CEO job-ingestion pipeline.
// Each stage runs in a single invocation, then the dispatcher picks up the next.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking, type CallContext } from "@/lib/ai/routing";
import type { JobCeoAgentId, JobCeoAgentContext, JobCeoRunStatus } from "@/lib/ai/job-agents/types";
import { JOB_CEO_CONFIG_DEFAULTS } from "@/lib/ai/job-agents/constants";
import { runQueryScout } from "@/lib/ai/job-agents/queryScout";
import { runQaBouncer } from "@/lib/ai/job-agents/qaBouncer";
import { runDeepFetch } from "@/lib/ai/job-agents/deepFetch";
import { runMatchmaker } from "@/lib/ai/job-agents/matchmaker";
import { runCeoOrchestrator } from "@/lib/ai/job-agents/ceoOrchestrator";
import { loadCandidateSummaries } from "@/lib/ai/job-agents/loadCandidateSummaries";
import type { AgentOptions } from "@/lib/ai/application-agents/types";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { listAllJobsForFuzzyDedupe, createJob } from "@/server/repositories/jobsRepository";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import {
  createRun,
  findRunById,
  updateRunStatus,
  bumpRunCounts,
  findEarliestActiveRun,
  type JobCeoRunRow,
} from "@/server/repositories/jobCeoRunRepository";
import {
  insertStaged,
  claimNextStagedBatch,
  updateStaged,
  removeDedupSignature,
  countByStage as countStagedByStage,
} from "@/server/repositories/jobCeoStagingRepository";
import { createProposal, supersedePendingFor } from "@/server/repositories/agentConfigProposalRepository";
import { logActivity } from "@/lib/activity";
import { backgroundDispatch } from "@/server/lib/waitUntil";

// Items per dispatch call for fast stages (QA, matchmaking).
const BATCH_SIZE = 20;

// Deep fetch processes fewer per batch — each can take up to ~145s with 3-layer retry.
// With DEEP_FETCH_CONCURRENCY=3 and 5 items: ceil(5/3)=2 rounds × 145s = 290s < 5min claim.
const DEEP_FETCH_BATCH_SIZE = 5;

const STAGE_CONCURRENCY = 6;
// Deep fetch uses lower concurrency — Jina has a global 429 risk above this
const DEEP_FETCH_CONCURRENCY = 3;

const MIN_DESCRIPTION_LENGTH = 100;

/**
 * Concurrency-limited parallel executor.
 * Runs tasks in rolling windows of `concurrency` so we never issue more than
 * `concurrency` simultaneous calls while still finishing a batch faster than
 * a pure sequential approach.
 */
async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function getRunnerFor(stage: string) {
  switch (stage) {
    case "qa": return runQaBouncer;
    case "deep_fetch": return runDeepFetch;
    case "matchmaking": return runMatchmaker;
    default: return null;
  }
}

function getAutomationIdFor(stage: string): JobCeoAgentId | null {
  switch (stage) {
    case "qa": return "job_ceo_qa";
    case "deep_fetch": return "job_ceo_deep_fetch";
    case "matchmaking": return "job_ceo_matchmaker";
    default: return null;
  }
}

function getSourceStageFor(runStatus: JobCeoRunStatus): string | null {
  switch (runStatus) {
    case "ingesting": return "ingested";
    case "qa": return "qa_passed";
    case "deep_fetch": return "researched";
    case "matchmaking": return "matched";
    default: return null;
  }
}

export async function callAgent(
  automationId: string,
  ctx: JobCeoAgentContext,
  fn: (provider: AiProvider) => Promise<unknown>
): Promise<{ result: unknown; providerName: string; aiKeyId: string | null; model: string | null }> {
  const agentConfig = await findAgentConfigByAutomationId(automationId);
  const defaults = JOB_CEO_CONFIG_DEFAULTS[automationId as keyof typeof JOB_CEO_CONFIG_DEFAULTS];
  const timeoutMs = agentConfig?.timeout_ms ?? defaults?.timeoutMs ?? 10000;

  return Promise.race([
    callWithUsageTracking(automationId, { workflowId: ctx.runId } as CallContext, fn),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent call timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export interface StartRunInput {
  source?: string;
  triggerType?: string;
  startedBy?: string;
  scoutTerms?: unknown;
}

export async function startRun(input: StartRunInput): Promise<JobCeoRunRow> {
  const run = await createRun({
    source: input.source,
    triggerType: input.triggerType,
    startedBy: input.startedBy,
    scoutTerms: input.scoutTerms,
  });

  await logActivity({
    type: "job_ceo_run_started",
    description: `Job CEO run started (${input.triggerType ?? "manual"})`,
    entityType: "job_ceo_run",
    entityId: run.id,
  });

  return run;
}

export async function processQaBatch(runId: string): Promise<{ processed: number; kept: number }> {
  const batch = await claimNextStagedBatch(runId, "researched", BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, kept: 0 };

  // Process items in parallel chunks. STAGE_CONCURRENCY caps concurrent AI calls.
  const results = await runConcurrent(batch, STAGE_CONCURRENCY, async (row) => {
    const ctx: JobCeoAgentContext = {
      runId,
      previousOutputs: { stagedJob: row },
    };

    try {
      const result = await callAgent("job_ceo_qa", ctx, async (provider) => {
        var opts: AgentOptions = {
          temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_qa.temperature,
          max_output_tokens: JOB_CEO_CONFIG_DEFAULTS.job_ceo_qa.maxOutputTokens,
          timeout_ms: 15000, // 15s — was 5s which caused too many AI timeout errors
        };
        return runQaBouncer(opts, provider, ctx);
      });
      var verdict = result.result as { keep: boolean; score: number; tier: string; reason: string };

      if (verdict.keep) {
        await updateStaged(row.id, { stage: "qa_passed", qa_score: verdict.score, qa_reason: verdict.reason, claimed_at: null as any, claim_expires_at: null as any });
        return { processed: 1, kept: 1 };
      } else {
        await updateStaged(row.id, { stage: "qa_dropped", qa_score: verdict.score, qa_reason: verdict.reason, claimed_at: null as any, claim_expires_at: null as any });
        return { processed: 1, kept: 0 };
      }
    } catch (err) {
      console.error(`[Job CEO] QA failed for staging row ${row.id}:`, (err as Error).message ?? String(err));
      await updateStaged(row.id, { stage: "error", last_error: (err as Error).message ?? "Unknown", claimed_at: null as any, claim_expires_at: null as any });
      return { processed: 0, kept: 0 };
    }
  });

  const processed = results.reduce((s, r) => s + r.processed, 0);
  const kept = results.reduce((s, r) => s + r.kept, 0);

  await bumpRunCounts(runId, { kept_count: kept });
  return { processed, kept };
}

export async function processDeepFetchBatch(runId: string): Promise<{ processed: number; researched: number; skipped: number }> {
  const batch = await claimNextStagedBatch(runId, "ingested", DEEP_FETCH_BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, researched: 0, skipped: 0 };

  const results = await runConcurrent(batch, DEEP_FETCH_CONCURRENCY, async (row) => {
    const ctx: JobCeoAgentContext = {
      runId,
      previousOutputs: { stagedJob: row },
    };

    try {
      const result = await callAgent("job_ceo_deep_fetch", ctx, async (provider) => {
        var opts: AgentOptions = {
          temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.temperature,
          max_output_tokens: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.maxOutputTokens,
          timeout_ms: 150000, // 150s — accommodates 3-layer fetch: Jina(50s) + Jina-no-cache(50s) + direct(45s) + AI parsing
        };
        return runDeepFetch(opts, provider, ctx);
      });
      var fetchResult = result.result as { descriptionText: string; requirements: Record<string, unknown> };
      var finalDesc = fetchResult.descriptionText || row.description_text || "";
      if (String(finalDesc).length < MIN_DESCRIPTION_LENGTH) {
        console.warn(`[Job CEO] Deep Fetch — description too short (${String(finalDesc).length} chars) for "${row.title ?? "?"}" @ "${row.company ?? "?"}" — skipping`);
        await updateStaged(row.id, { stage: "no_description", description_text: finalDesc, last_error: "Description too short (" + String(finalDesc).length + " chars)", claimed_at: null as any, claim_expires_at: null as any });
        if (row.dedup_signature) await removeDedupSignature(row.dedup_signature).catch(function () {});
        return { processed: 1, researched: 0, skipped: 1 };
      }
      await updateStaged(row.id, {
        stage: "researched",
        description_text: finalDesc,
        requirements: fetchResult.requirements,
        claimed_at: null as any,
        claim_expires_at: null as any,
      });
      return { processed: 1, researched: 1, skipped: 0 };
    } catch (err) {
      var errMsg = (err as Error).message ?? String(err);
      console.error(`[Job CEO] Deep Fetch FAILED for "${row.title ?? "?"}" @ "${row.company ?? "?"}" (row=${row.id}): ${errMsg}`);
      console.error(`[Job CEO] Deep Fetch diagnostics — source_url=${row.source_url ?? "null"}, existing_desc_len=${String(row.description_text ?? "").length}, has_raw=${String(row.raw != null)}`);
      if (String(row.description_text ?? "").length < MIN_DESCRIPTION_LENGTH) {
        console.warn(`[Job CEO] Deep Fetch — no usable description for "${row.title ?? "?"}" @ "${row.company ?? "?"}" — marking as no_description`);
        await updateStaged(row.id, { stage: "no_description", description_text: row.description_text, last_error: errMsg, claimed_at: null as any, claim_expires_at: null as any });
        if (row.dedup_signature) await removeDedupSignature(row.dedup_signature).catch(function () {});
        return { processed: 1, researched: 0, skipped: 1 };
      }
      await updateStaged(row.id, { stage: "researched", description_text: row.description_text, claimed_at: null as any, claim_expires_at: null as any });
      return { processed: 1, researched: 1, skipped: 0 };
    }
  });

  const processed = results.reduce((s, r) => s + r.processed, 0);
  const researched = results.reduce((s, r) => s + r.researched, 0);
  const skipped = results.reduce((s, r) => s + (r.skipped ?? 0), 0);

  await bumpRunCounts(runId, { researched_count: researched, skipped_count: skipped });
  return { processed, researched, skipped };
}

export async function processMatchmakerBatch(runId: string): Promise<{ processed: number; matched: number; logged: number }> {
  const batch = await claimNextStagedBatch(runId, "qa_passed", BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, matched: 0, logged: 0 };

  // Hoist all shared reads to the top so they execute ONCE before parallelising the batch.
  // Previously listAllJobsForFuzzyDedupe was inside the inner loop; now it runs once.
  const [existingJobs, candidates] = await Promise.all([
    listAllJobsForFuzzyDedupe(),
    loadCandidateSummaries(50),
  ]);

  const existingTitles = new Set<string>();
  const existingCompanies = new Set<string>();
  for (const j of existingJobs) {
    if (j.title) existingTitles.add(j.title.toLowerCase().trim());
    if (j.company) existingCompanies.add(j.company.toLowerCase().trim());
  }

  // Run matchmaking in parallel — each item is an independent AI call.
  const results = await runConcurrent(batch, STAGE_CONCURRENCY, async (row) => {
    const ctx: JobCeoAgentContext = {
      runId,
      previousOutputs: {
        stagedJob: row,
        candidateSummaries: candidates,
        deepFetchResult: row.requirements ? { requirements: row.requirements } : null,
      },
    };

    try {
      const title = row.title ?? "";
      const company = row.company ?? "";
      const titleKey = title.toLowerCase().trim();
      const companyKey = company.toLowerCase().trim();
      const isDuplicate = existingTitles.has(titleKey) && existingCompanies.has(companyKey);

      var result = await callAgent("job_ceo_matchmaker", ctx, async (provider) => {
        var opts: AgentOptions = {
          temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_matchmaker.temperature,
          max_output_tokens: 4096,
          timeout_ms: 8000,
        };
        return runMatchmaker(opts, provider, ctx);
      });
      const matchResult = result.result as { matches: { candidateId: string; score: number; reasons: string[]; outreachDraft: string }[] };
      const highMatches = matchResult.matches.filter((m) => m.score >= 90);

      if (!isDuplicate) {
        let parsedRaw: Record<string, any> = {};
        if (row.raw && typeof row.raw === "object") parsedRaw = row.raw;
        if (typeof row.raw === "string") { try { parsedRaw = JSON.parse(row.raw); } catch (e) {} }

        const jobRow: Record<string, unknown> = {
          title: row.title,
          company: row.company,
          location: row.location,
          source: parsedRaw.source ?? "openjobdata",
          source_url: row.source_url,
          description_text: row.description_text,
          raw_source_payload: row.raw ?? null,
          external_job_id: row.external_job_id,
          is_active: true,
          salary_min: parsedRaw.salary_min ?? null,
          salary_max: parsedRaw.salary_max ?? null,
          salary_range: parsedRaw.salary_range ?? null,
          employment_type: parsedRaw.employment_type ?? null,
          seniority_level: parsedRaw.seniority_level ?? null,
          posted_at: parsedRaw.posted_at ?? null,
          apply_url: parsedRaw.apply_url ?? null,
          company_website: parsedRaw.company_website ?? null,
          notes: parsedRaw.notes ?? null,
        };

        const created = await createJob(jobRow);
        await syncCompanyDirectoryFromJobs([created]);

        for (const m of highMatches) {
          await logActivity({
            type: "job_ceo_match",
            description: `CEO Matchmaker: ${title} at ${company} matched candidate ${m.candidateId} (score ${m.score}). Outreach draft stored.`,
            entityType: "job_ceo_staging",
            entityId: row.id,
            metadata: {
              jobId: created.id,
              candidateId: m.candidateId,
              score: m.score,
              outreachDraft: m.outreachDraft,
            },
          });
        }

        await updateStaged(row.id, {
          stage: "logged",
          logged_job_id: created.id,
          match_results: matchResult,
          claimed_at: null as any,
          claim_expires_at: null as any,
        });
        return { processed: 1, matched: matchResult.matches.length, logged: 1 };
      } else {
        await updateStaged(row.id, {
          stage: "logged",
          match_results: { ...matchResult, duplicate: true },
          claimed_at: null as any,
          claim_expires_at: null as any,
        });
        return { processed: 1, matched: matchResult.matches.length, logged: 1 };
      }
    } catch (err) {
      console.error(`[Job CEO] Matchmaker failed for staging row ${row.id}:`, (err as Error).message ?? String(err));
      await updateStaged(row.id, { stage: "error", last_error: (err as Error).message ?? "Unknown", claimed_at: null as any, claim_expires_at: null as any });
      return { processed: 0, matched: 0, logged: 0 };
    }
  });

  const processed = results.reduce((s, r) => s + r.processed, 0);
  const matched = results.reduce((s, r) => s + r.matched, 0);
  const logged = results.reduce((s, r) => s + r.logged, 0);

  await bumpRunCounts(runId, { matched_count: matched, logged_count: logged });
  return { processed, matched, logged };
}

export interface DispatchResult {
  dispatched: boolean;
  runId: string | null;
  stage: string | null;
  count: number;
  needsDispatch: boolean;
  message?: string;
}

export async function dispatchNextJobCeoWork(): Promise<DispatchResult> {
  const run = await findEarliestActiveRun();
  if (!run) {
    return { dispatched: false, runId: null, stage: null, count: 0, needsDispatch: false };
  }

  const currentStatus = run.status;
  const stage = getSourceStageFor(currentStatus);
  const nextStatus = currentStatus === "ingesting" ? "qa" :
                     currentStatus === "qa" ? "deep_fetch" :
                     currentStatus === "deep_fetch" ? "matchmaking" : "completed";

  if (currentStatus === "ingesting") {
    var tsStart = Date.now();
    const result = await processDeepFetchBatch(run.id);
    var tsMs = Date.now() - tsStart;
    if (result.processed > 0) console.log(`[Job CEO] Deep Fetch batch: ${result.processed} processed, ${result.researched} researched, ${(result as any).skipped ?? 0} skipped in ${tsMs}ms`);
    const hasMore = (await countStagedByStage(run.id)).find((c) => c.stage === "ingested");
    const rowsExist = hasMore && Number(hasMore.count) > 0;

    let transitioned = false;
    if (!rowsExist) {
      await updateRunStatus(run.id, "qa", { last_error: undefined });
      transitioned = true;
    }

    // Only signal more work if we actually did something or transitioned.
    // If rows exist but processed === 0, another concurrent worker holds the
    // claim locks — returning needsDispatch: true here causes an infinite loop.
    const needsMore = result.processed > 0 || transitioned;

    return {
      dispatched: result.processed > 0 || transitioned,
      runId: run.id,
      stage: "qa",
      count: result.processed,
      needsDispatch: needsMore,
    };
  }

  if (currentStatus === "qa") {
    var tsStart = Date.now();
    const result = await processQaBatch(run.id);
    var tsMs = Date.now() - tsStart;
    if (result.processed > 0) console.log(`[Job CEO] QA batch: ${result.processed} processed, ${result.kept} kept in ${tsMs}ms`);
    const hasMore = (await countStagedByStage(run.id)).find((c) => c.stage === "researched");
    const rowsExist = hasMore && Number(hasMore.count) > 0;

    let transitioned = false;
    if (!rowsExist) {
      await updateRunStatus(run.id, "deep_fetch", { last_error: undefined });
      transitioned = true;
    }

    // Only signal more work if we actually did something or transitioned.
    const needsMore = result.processed > 0 || transitioned;

    return {
      dispatched: result.processed > 0 || transitioned,
      runId: run.id,
      stage: "deep_fetch",
      count: result.processed,
      needsDispatch: needsMore,
    };
  }

  if (currentStatus === "deep_fetch") {
    var tsStart = Date.now();
    const result = await processMatchmakerBatch(run.id);
    var tsMs = Date.now() - tsStart;
    if (result.processed > 0) console.log(`[Job CEO] Matchmaker batch: ${result.processed} processed, ${result.matched} matched, ${result.logged} logged in ${tsMs}ms`);
    const hasMore = (await countStagedByStage(run.id)).find((c) => c.stage === "qa_passed");
    const rowsExist = hasMore && Number(hasMore.count) > 0;

    let transitioned = false;
    if (!rowsExist) {
      await updateRunStatus(run.id, "matchmaking", { last_error: undefined });
      transitioned = true;
    }

    // Only signal more work if we actually did something or transitioned.
    const needsMore = result.processed > 0 || transitioned;

    return {
      dispatched: result.processed > 0 || transitioned,
      runId: run.id,
      stage: "matchmaking",
      count: result.processed,
      needsDispatch: needsMore,
    };
  }

  if (currentStatus === "matchmaking") {
    // --- CEO Orchestrator Phase ---
    // If enough jobs were processed, let the Orchestrator analyze the drop rates and propose config changes.
    if (run.ingested_count >= 10) {
      const qaDropRate = run.ingested_count > 0 ? (run.ingested_count - run.kept_count) / run.ingested_count : 0;
      const deepFetchFailureRate = run.kept_count > 0 ? (run.kept_count - run.researched_count) / run.kept_count : 0;

      // Ensure we have a high enough failure rate to bother the AI (e.g., > 60% QA drop or > 30% deep fetch failure)
      if (qaDropRate > 0.6 || deepFetchFailureRate > 0.3) {
        try {
          const qaConfig = await findAgentConfigByAutomationId("job_ceo_qa");
          const fetchConfig = await findAgentConfigByAutomationId("job_ceo_deep_fetch");

          const ctx: JobCeoAgentContext = {
            runId: run.id,
            previousOutputs: {
              runContext: {
                ingestedCount: run.ingested_count,
                keptCount: run.kept_count,
                researchedCount: run.researched_count,
                qaDropRate,
                deepFetchFailureRate,
              },
              agentConfigsSnapshot: {
                job_ceo_qa: qaConfig?.system_prompt ?? "Default Bouncer prompt",
                job_ceo_deep_fetch: "Default Deep Fetch config"
              }
            }
          };

          const config = await findAgentConfigByAutomationId("job_ceo_orchestrator");
          const { result } = await callAgent("job_ceo_orchestrator", ctx, async (provider) => {
            return runCeoOrchestrator(
              { system_prompt: config?.system_prompt ?? undefined, max_output_tokens: config?.max_output_tokens ?? 500 },
              provider,
              ctx
            );
          });
          
          const plan = result as any;
          if (plan.proposals && plan.proposals.length > 0) {
            await persistCeoProposals(run.id, plan.proposals.map((p: any) => ({
              targetAutomationId: p.target_automation_id,
              proposedChanges: p.proposed_changes,
              rationale: p.rationale,
            })));
          }
        } catch (err) {
          console.error("[Job CEO] Orchestrator failed:", err);
        }
      }
    }
    // -----------------------------

    await updateRunStatus(run.id, "completed", { last_error: undefined });

    await logActivity({
      type: "job_ceo_run_completed",
      description: `Job CEO run completed: ${run.ingested_count} ingested, ${run.kept_count} kept, ${run.researched_count} researched, ${run.matched_count} matched, ${run.logged_count} logged`,
      entityType: "job_ceo_run",
      entityId: run.id,
    });

    // needsDispatch: false — no more work to do; run is fully complete.
    return { dispatched: true, runId: run.id, stage: "completed", count: 1, needsDispatch: false };
  }

  return { dispatched: false, runId: null, stage: null, count: 0, needsDispatch: false };
}

export async function dispatchAndChain(): Promise<DispatchResult> {
  const result = await dispatchNextJobCeoWork();
  var totalProcessed = result.count;

  if (result.needsDispatch) {
    if (process.env.NODE_ENV === "development") {
      var r = result;
      var iteration = 0;
      var chainStart = Date.now();
      var lastStage = r.stage;
      var lastLog = Date.now();
      const MAX_ITERATIONS = 10000;

      console.log(`[Job CEO] Dev chain started — stage=${r.stage}, runId=${r.runId}`);
      while (r.needsDispatch && iteration < MAX_ITERATIONS) {
        iteration++;
        var stageStart = Date.now();
        r = await dispatchNextJobCeoWork();
        totalProcessed += r.count;
        var stageMs = Date.now() - stageStart;

        if (r.stage !== lastStage) {
          console.log(`[Job CEO] Stage ${lastStage} → ${r.stage} completed in ${((Date.now() - lastLog) / 1000).toFixed(1)}s (${totalProcessed} items processed, ${iteration} iterations)`);
          lastStage = r.stage;
          lastLog = Date.now();
        } else if (r.count > 0 && stageMs > 5000) {
          console.log(`[Job CEO] Slow batch at ${r.stage}: ${stageMs}ms, ${r.count} items (iteration ${iteration})`);
        }
      }

      if (iteration >= MAX_ITERATIONS) {
        console.error(`[Job CEO] CRITICAL: Dev chain reached ${MAX_ITERATIONS} iterations — forcing exit. This indicates a dispatch loop bug.`);
      }

      var totalSec = ((Date.now() - chainStart) / 1000).toFixed(1);
      console.log(`[Job CEO] Dev chain DONE — ${totalSec}s, ${totalProcessed} items, ${iteration} iterations, final stage=${r.stage}`);
    } else {
      const baseUrl = process.env.TALENTOS_BASE_URL || "https://skarion-talent-os.skarion-talentos.workers.dev";
      const cronSecret = process.env.CRON_SECRET;
      await backgroundDispatch(
        fetch(`${baseUrl}/api/job-ceo/dispatch`, {
          method: "POST",
          headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined
        }).catch((err) =>
          console.error("[Job CEO] Dispatch chain self-fetch failed:", err)
        )
      );
    }
  }

  return result;
}

export async function persistCeoProposals(runId: string, proposals: { targetAutomationId: string; proposedChanges: Record<string, unknown>; rationale: string }[]): Promise<void> {
  for (const p of proposals) {
    await supersedePendingFor(p.targetAutomationId);
    await createProposal({
      targetAutomationId: p.targetAutomationId,
      proposedChanges: p.proposedChanges,
      rationale: p.rationale,
      createdBy: "job_ceo",
    });

    await logActivity({
      type: "job_ceo_proposal",
      description: `CEO proposed config change for ${p.targetAutomationId}: ${p.rationale}`,
      entityType: "agent_config_proposal",
      metadata: { targetAutomationId: p.targetAutomationId, proposedChanges: p.proposedChanges },
    });
  }

  if (proposals.length > 0) {
    await updateRunStatus(runId, runId ? (await findRunById(runId))?.status ?? "ingesting" : "ingesting", {
      plan_notes: `Proposed ${proposals.length} agent config changes. See agent_config_proposals.`,
    });
  }
}
