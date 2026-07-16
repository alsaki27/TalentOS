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
  countByStage as countStagedByStage,
} from "@/server/repositories/jobCeoStagingRepository";
import { createProposal, supersedePendingFor } from "@/server/repositories/agentConfigProposalRepository";
import { logActivity } from "@/lib/activity";
import { backgroundDispatch } from "@/server/lib/waitUntil";

const BATCH_SIZE = 5;

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

async function callAgent(
  automationId: string,
  ctx: JobCeoAgentContext,
  fn: (provider: AiProvider) => Promise<unknown>
): Promise<{ result: unknown; providerName: string; aiKeyId: string | null; model: string | null }> {
  const agentConfig = await findAgentConfigByAutomationId(automationId);
  const defaults = JOB_CEO_CONFIG_DEFAULTS[automationId as keyof typeof JOB_CEO_CONFIG_DEFAULTS];
  const timeoutMs = agentConfig?.timeout_ms ?? defaults?.timeoutMs ?? 60000;

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
  const batch = await claimNextStagedBatch("ingested", BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, kept: 0 };

  let processed = 0;
  let kept = 0;

  for (const row of batch) {
    const ctx: JobCeoAgentContext = {
      runId,
      previousOutputs: { stagedJob: row },
    };

    try {
      const result = await callAgent("job_ceo_qa", ctx, (provider) => {
        const runner = getRunnerFor("qa");
        if (!runner) throw new Error("No runner for stage: qa");
        const options: AgentOptions = {
          temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_qa.temperature,
          max_output_tokens: JOB_CEO_CONFIG_DEFAULTS.job_ceo_qa.maxOutputTokens,
          timeout_ms: JOB_CEO_CONFIG_DEFAULTS.job_ceo_qa.timeoutMs,
        };
        return runner(options, provider, ctx);
      });

      const verdict = result.result as { keep: boolean; score: number; tier: string; reason: string };

      if (verdict.keep) {
        await updateStaged(row.id, { stage: "qa_passed", qa_score: verdict.score, qa_reason: verdict.reason });
        kept++;
      } else {
        await updateStaged(row.id, { stage: "qa_dropped", qa_score: verdict.score, qa_reason: verdict.reason });
      }
      processed++;
    } catch (err) {
      console.error(`[Job CEO] QA failed for staging row ${row.id}:`, (err as Error).message ?? String(err));
      await updateStaged(row.id, { stage: "error", last_error: (err as Error).message ?? "Unknown" });
    }
  }

  await bumpRunCounts(runId, { kept_count: kept });
  return { processed, kept };
}

export async function processDeepFetchBatch(runId: string): Promise<{ processed: number; researched: number }> {
  const batch = await claimNextStagedBatch("qa_passed", BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, researched: 0 };

  let processed = 0;
  let researched = 0;

  for (const row of batch) {
    const ctx: JobCeoAgentContext = {
      runId,
      previousOutputs: { stagedJob: row },
    };

    try {
      const result = await callAgent("job_ceo_deep_fetch", ctx, (provider) => {
        const options: AgentOptions = {
          temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.temperature,
          max_output_tokens: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.maxOutputTokens,
          timeout_ms: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.timeoutMs,
        };
        return runDeepFetch(options, provider, ctx);
      });

      const fetchResult = result.result as { descriptionText: string; requirements: Record<string, unknown> };
      await updateStaged(row.id, {
        stage: "researched",
        description_text: fetchResult.descriptionText || row.description_text,
        requirements: fetchResult.requirements,
      });
      researched++;
      processed++;
    } catch (err) {
      console.error(`[Job CEO] Deep Fetch failed for staging row ${row.id}:`, (err as Error).message ?? String(err));
      await updateStaged(row.id, { stage: "researched", description_text: row.description_text });
      researched++;
      processed++;
    }
  }

  await bumpRunCounts(runId, { researched_count: researched });
  return { processed, researched };
}

export async function processMatchmakerBatch(runId: string): Promise<{ processed: number; matched: number; logged: number }> {
  const batch = await claimNextStagedBatch("researched", BATCH_SIZE);
  if (batch.length === 0) return { processed: 0, matched: 0, logged: 0 };

  const existingJobs = await listAllJobsForFuzzyDedupe();
  const existingTitles = new Set<string>();
  const existingCompanies = new Set<string>();
  for (const j of existingJobs) {
    if (j.title) existingTitles.add(j.title.toLowerCase().trim());
    if (j.company) existingCompanies.add(j.company.toLowerCase().trim());
  }

  const candidates = await loadCandidateSummaries(50);

  let processed = 0;
  let matched = 0;
  let logged = 0;

  for (const row of batch) {
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

      const result = await callAgent("job_ceo_matchmaker", ctx, (provider) => {
        const options: AgentOptions = {
          temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_matchmaker.temperature,
          max_output_tokens: JOB_CEO_CONFIG_DEFAULTS.job_ceo_matchmaker.maxOutputTokens,
          timeout_ms: JOB_CEO_CONFIG_DEFAULTS.job_ceo_matchmaker.timeoutMs,
        };
        return runMatchmaker(options, provider, ctx);
      });

      const matchResult = result.result as { matches: { candidateId: string; score: number; reasons: string[]; outreachDraft: string }[] };
      const highMatches = matchResult.matches.filter((m) => m.score >= 90);

      if (highMatches.length > 0 && !isDuplicate) {
        const jobRow: Record<string, unknown> = {
          title: row.title,
          company: row.company,
          location: row.location,
          source: "openjobdata",
          source_url: row.source_url,
          description_text: row.description_text,
          raw_source_payload: row.raw ?? null,
          external_job_id: row.external_job_id,
          is_active: true,
        };

        const created = await createJob(jobRow);

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
          match_results: { matches: highMatches },
        });
        matched += highMatches.length;
        logged++;
      } else if (highMatches.length > 0 && isDuplicate) {
        await updateStaged(row.id, {
          stage: "logged",
          match_results: { matches: highMatches, duplicate: true },
        });
        matched += highMatches.length;
        logged++;
      } else {
        await updateStaged(row.id, {
          stage: "matched",
          match_results: matchResult,
        });
        matched += matchResult.matches.length;
        logged++;
      }
      processed++;
    } catch (err) {
      console.error(`[Job CEO] Matchmaker failed for staging row ${row.id}:`, (err as Error).message ?? String(err));
      await updateStaged(row.id, { stage: "error", last_error: (err as Error).message ?? "Unknown" });
    }
  }

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
    const result = await processQaBatch(run.id);
    const hasMore = (await countStagedByStage(run.id)).find((c) => c.stage === "ingested");

    if (!hasMore || Number(hasMore.count) <= 0) {
      await updateRunStatus(run.id, "qa", { last_error: undefined });
    }

    const needsMore = result.processed >= BATCH_SIZE;

    return {
      dispatched: result.processed > 0,
      runId: run.id,
      stage: "qa",
      count: result.processed,
      needsDispatch: needsMore,
    };
  }

  if (currentStatus === "qa") {
    const result = await processDeepFetchBatch(run.id);
    const hasMore = (await countStagedByStage(run.id)).find((c) => c.stage === "qa_passed");

    if (!hasMore || Number(hasMore.count) <= 0) {
      await updateRunStatus(run.id, "deep_fetch", { last_error: undefined });
    }

    const needsMore = result.processed >= BATCH_SIZE || ((hasMore && Number(hasMore.count) > 0) ? true : false);

    return {
      dispatched: result.processed > 0,
      runId: run.id,
      stage: "deep_fetch",
      count: result.processed,
      needsDispatch: needsMore,
    };
  }

  if (currentStatus === "deep_fetch") {
    const result = await processMatchmakerBatch(run.id);
    const hasMore = (await countStagedByStage(run.id)).find((c) => c.stage === "researched");

    if (!hasMore || Number(hasMore.count) <= 0) {
      await updateRunStatus(run.id, "matchmaking", { last_error: undefined });

      await logActivity({
        type: "job_ceo_run_completed",
        description: `Job CEO run completed: ${run.ingested_count} ingested, ${run.kept_count} kept, ${run.researched_count} researched, ${run.matched_count} matched, ${run.logged_count} logged`,
        entityType: "job_ceo_run",
        entityId: run.id,
      });
    }

    const needsMore = result.processed >= BATCH_SIZE || ((hasMore && Number(hasMore.count) > 0) ? true : false);

    return {
      dispatched: result.processed > 0,
      runId: run.id,
      stage: "matchmaking",
      count: result.processed,
      needsDispatch: needsMore,
    };
  }

  if (currentStatus === "matchmaking") {
    await updateRunStatus(run.id, "completed", { last_error: undefined });

    await logActivity({
      type: "job_ceo_run_completed",
      description: `Job CEO run completed: ${run.ingested_count} ingested, ${run.kept_count} kept, ${run.researched_count} researched, ${run.matched_count} matched, ${run.logged_count} logged`,
      entityType: "job_ceo_run",
      entityId: run.id,
    });

    return { dispatched: true, runId: run.id, stage: "completed", count: 1, needsDispatch: false };
  }

  return { dispatched: false, runId: null, stage: null, count: 0, needsDispatch: false };
}

export async function dispatchAndChain(): Promise<DispatchResult> {
  const result = await dispatchNextJobCeoWork();

  if (result.needsDispatch) {
    const baseUrl = process.env.TALENTOS_BASE_URL || "https://skarion-talent-os.skarion-talentos.workers.dev";
    await backgroundDispatch(
      fetch(`${baseUrl}/api/job-ceo/dispatch`, { method: "POST" }).catch((err) =>
        console.error("[Job CEO] Dispatch chain self-fetch failed:", err)
      )
    );
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
