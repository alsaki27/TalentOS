// Background job-description backfill. Separate from jobCeoService.ts
// (which orchestrates the ingest pipeline over job_ceo_staging/job_ceo_runs)
// because this operates on the live `jobs` table directly, on a plain cron
// tick - no run/stage state machine needed, just "find candidates, try each,
// record the attempt."
import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking, type CallContext } from "@/lib/ai/routing";
import { runEnricher } from "@/lib/ai/job-agents/enricher";
import { JOB_CEO_CONFIG_DEFAULTS } from "@/lib/ai/job-agents/constants";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import {
  findJobsNeedingEnrichment,
  countJobsNeedingEnrichment,
  recordEnrichmentAttempt,
  type EnrichmentCandidate,
} from "@/server/repositories/jobsRepository";

const BATCH_SIZE = 5;

async function callEnricher(job: EnrichmentCandidate) {
  const agentConfig = await findAgentConfigByAutomationId("job_ceo_enricher");
  const defaults = JOB_CEO_CONFIG_DEFAULTS.job_ceo_enricher;
  const timeoutMs = agentConfig?.timeout_ms ?? defaults.timeoutMs;

  return Promise.race([
    callWithUsageTracking("job_ceo_enricher", {} as CallContext, (provider: AiProvider) =>
      runEnricher(
        {
          system_prompt: agentConfig?.system_prompt ?? undefined,
          temperature: agentConfig?.temperature ?? defaults.temperature,
          max_output_tokens: agentConfig?.max_output_tokens ?? defaults.maxOutputTokens,
          timeout_ms: timeoutMs,
        },
        provider,
        job
      )
    ),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Enricher call timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export interface EnrichmentBatchResult {
  processed: number;
  enriched: number;
  pendingAfter: number;
}

export async function processEnrichmentBatch(limit: number = BATCH_SIZE): Promise<EnrichmentBatchResult> {
  const batch = await findJobsNeedingEnrichment(limit);
  let enriched = 0;

  for (const job of batch) {
    try {
      const result = await callEnricher(job);
      const fetchResult = result.result as { descriptionText: string };
      if (fetchResult.descriptionText && fetchResult.descriptionText.length > (job.description_text?.length ?? 0)) {
        await recordEnrichmentAttempt(job.id, { description_text: fetchResult.descriptionText });
        enriched++;
      } else {
        await recordEnrichmentAttempt(job.id, {});
      }
    } catch (err) {
      console.error(`[Description Enricher] Failed for job ${job.id}:`, (err as Error).message ?? String(err));
      await recordEnrichmentAttempt(job.id, {});
    }
  }

  const pendingAfter = await countJobsNeedingEnrichment();
  return { processed: batch.length, enriched, pendingAfter };
}
