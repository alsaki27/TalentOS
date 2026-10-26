// Retries jobs stuck at job_ceo_staging.stage = 'no_description' — across
// every ingest source (Adzuna, OpenJobData, Actalent, Broadstaff, Job
// Agent), not just one. See "Adzuna Job CEO Coverage and Description
// Recovery Plan" (2026-10-25) and its 2026-10-26 follow-up.
//
// Why this exists: confirmed live by directly re-fetching real stuck
// production rows (both Adzuna and OpenJobData) that the ORIGINAL failure
// was frequently transient, not permanent — the exact same URL, re-fetched
// later with the exact same tooling Deep Fetch already uses, returned a
// complete, usable description. Nothing previously ever tried again. This
// is deliberately NOT a new fetching mechanism — it reuses
// fetchJobPageText()'s existing 3-layer cascade and the existing AI
// extraction step verbatim; the only new thing is calling them again, later.
//
// Scope: only rows that HAVE a source_url. A row with no resolved link at
// all (adzuna_job_ceo_ingest.py's "no employer page found" case) has
// nothing to re-fetch — that category stays on the manual
// paste-a-description path (recovery-queue/[id]/resolve) until a
// link-resolution retry exists (a different, not-yet-built feature).

import { fetchJobPageText } from "@/lib/ai/job-agents/fetchJobPage";
import { runDeepFetch } from "@/lib/ai/job-agents/deepFetch";
import type { JobCeoAgentContext } from "@/lib/ai/job-agents/types";
import { JOB_CEO_CONFIG_DEFAULTS } from "@/lib/ai/job-agents/constants";
import type { AgentOptions } from "@/lib/ai/application-agents/types";
import { callAgent, getDescriptionMinimumForStagedRow } from "@/server/services/jobCeoService";
import {
  claimRecoveryRetryBatch,
  findStagedById,
  updateStaged,
  type StagedJobRow,
} from "@/server/repositories/jobCeoStagingRepository";
import { createRun, updateRunStatus } from "@/server/repositories/jobCeoRunRepository";
import { backgroundDispatch } from "@/server/lib/waitUntil";

// A job posting realistically doesn't outlive this on the employer's own
// site — retrying anything older is close to pure waste. Confirmed live:
// the existing backlog has tens of thousands of rows months old; without
// this bound a retry batch would burn fetch/AI budget on postings that are
// almost certainly long gone. Kept deliberately tight (2 days, not 7+) to
// bound real AI spend to the freshest, most-likely-to-still-be-live slice
// of the backlog — both retry attempts (12h, 24h) land well inside this
// window for every row, so nothing loses its real chance at a retry.
export const RECOVERY_RETRY_ELIGIBLE_WINDOW_DAYS = 2;
// Index 0 = wait before the 1st retry, index 1 = before the 2nd. Once
// recovery_retry_count reaches this length, the row is no longer
// auto-retried (it stays visible/exportable; a human can still use the
// manual Resolve or Retry-Now paths any time). Deliberately short (2
// attempts, not 3+): confirmed live that ~2,200 new rows/day become
// eligible for a 1st retry system-wide, so the real cost lever is batch
// throughput (RECOVERY_RETRY_BATCH_SIZE below), not attempt count — fewer
// attempts per row just means less total volume for the same backlog.
export const RECOVERY_RETRY_BACKOFF_HOURS = [12, 24] as const;
export const RECOVERY_RETRY_MAX_ATTEMPTS = RECOVERY_RETRY_BACKOFF_HOURS.length;
export const RECOVERY_RETRY_BATCH_SIZE = 10;
const RECOVERY_RETRY_CONCURRENCY = 3; // matches Deep Fetch's own DEEP_FETCH_CONCURRENCY — same Jina 429 risk applies

export interface RecoveryRetryOutcome {
  id: string;
  outcome: "recovered" | "still_failing" | "ineligible";
  runId?: string;
  reason?: string;
}

/**
 * Re-runs exactly the fetch + AI-extraction steps Deep Fetch itself would
 * run, against a row already at stage='no_description'. On success, the row
 * is attached to a fresh run at stage 'qa' (mirroring the manual resolve
 * endpoint) so the existing QA -> Matchmaker -> log flow picks it up
 * normally. On failure, bumps recovery_retry_count/recovery_last_retried_at
 * and the row stays exactly where it was.
 *
 * Used by both the scheduled batch (processRecoveryRetryBatch) and the
 * single-row manual "Retry Now" action — the manual path skips the backoff
 * eligibility check (a deliberate human click overrides the timer) but
 * still records the attempt the same way, so the UI stays honest about how
 * many times this row has actually been tried.
 */
export async function retryOneRow(row: StagedJobRow): Promise<RecoveryRetryOutcome> {
  if (row.stage !== "no_description") {
    return { id: row.id, outcome: "ineligible", reason: `Row is at stage "${row.stage}", not "no_description".` };
  }
  if (!row.source_url) {
    return { id: row.id, outcome: "ineligible", reason: "No source_url to retry — use Resolve instead." };
  }

  const minimumDescriptionLength = getDescriptionMinimumForStagedRow(row);
  const nextAttemptNumber = (row.recovery_retry_count ?? 0) + 1;

  try {
    const rawText = await fetchJobPageText(row.source_url);
    // callAgent forwards ctx.runId into ai_usage_events.workflow_id (a uuid
    // column) for usage-tracking attribution only — runDeepFetch itself never
    // reads it. It must be a real UUID or the insert throws a Postgres type
    // error; the staging row's own id satisfies that safely (this row may
    // have no live job_ceo_runs id at all — e.g. detached by deleteRun()).
    const ctx: JobCeoAgentContext = { runId: row.id, previousOutputs: { stagedJob: { ...row, description_text: rawText } } };

    let descriptionText = rawText;
    let requirements: Record<string, unknown> | null = null;
    if (rawText && rawText.length > 0) {
      try {
        const result = await callAgent("job_ceo_deep_fetch", ctx, async (provider) => {
          const opts: AgentOptions = {
            temperature: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.temperature,
            max_output_tokens: JOB_CEO_CONFIG_DEFAULTS.job_ceo_deep_fetch.maxOutputTokens,
            timeout_ms: 45000,
          };
          return runDeepFetch(opts, provider, ctx);
        });
        const fetchResult = result.result as { descriptionText: string; requirements: Record<string, unknown> };
        descriptionText = fetchResult.descriptionText || rawText;
        requirements = fetchResult.requirements ?? null;
      } catch (err) {
        console.warn(`[Recovery Retry] AI extraction failed for ${row.id}, using raw fetched text: ${(err as Error).message ?? err}`);
      }
    }

    if (descriptionText && descriptionText.length >= minimumDescriptionLength) {
      const newRun = await createRun({ source: sourceOf(row), triggerType: "recovery_retry" });
      await updateStaged(row.id, {
        run_id: newRun.id,
        description_text: descriptionText,
        requirements,
        stage: "researched",
        last_error: null,
        recovery_retry_count: nextAttemptNumber,
        recovery_last_retried_at: new Date().toISOString(),
        claimed_at: null,
        claim_expires_at: null,
      });
      await updateRunStatus(newRun.id, "qa");
      await triggerDispatch(newRun.id);
      return { id: row.id, outcome: "recovered", runId: newRun.id };
    }

    const reason = `Description too short (${(descriptionText ?? "").length} chars; need ${minimumDescriptionLength}) — retry ${nextAttemptNumber}`;
    await updateStaged(row.id, {
      last_error: reason,
      recovery_retry_count: nextAttemptNumber,
      recovery_last_retried_at: new Date().toISOString(),
      claimed_at: null,
      claim_expires_at: null,
    });
    return { id: row.id, outcome: "still_failing", reason };
  } catch (err) {
    const reason = (err as Error).message ?? String(err);
    await updateStaged(row.id, {
      last_error: `Retry ${nextAttemptNumber} failed: ${reason}`,
      recovery_retry_count: nextAttemptNumber,
      recovery_last_retried_at: new Date().toISOString(),
      claimed_at: null,
      claim_expires_at: null,
    }).catch(() => {});
    return { id: row.id, outcome: "still_failing", reason };
  }
}

export async function retryRecoveryQueueRowById(id: string): Promise<RecoveryRetryOutcome> {
  const row = await findStagedById(id);
  if (!row) return { id, outcome: "ineligible", reason: "Staging row not found." };
  return retryOneRow(row);
}

export async function processRecoveryRetryBatch(): Promise<{
  processed: number;
  recovered: number;
  stillFailing: number;
}> {
  const batch = await claimRecoveryRetryBatch(
    RECOVERY_RETRY_MAX_ATTEMPTS,
    RECOVERY_RETRY_ELIGIBLE_WINDOW_DAYS,
    RECOVERY_RETRY_BATCH_SIZE
  );
  if (batch.length === 0) return { processed: 0, recovered: 0, stillFailing: 0 };

  const results: RecoveryRetryOutcome[] = new Array(batch.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < batch.length) {
      const i = idx++;
      results[i] = await retryOneRow(batch[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(RECOVERY_RETRY_CONCURRENCY, batch.length) }, () => worker())
  );

  const recovered = results.filter((r) => r.outcome === "recovered").length;
  const stillFailing = results.filter((r) => r.outcome === "still_failing").length;
  return { processed: results.length, recovered, stillFailing };
}

function sourceOf(row: StagedJobRow): string | undefined {
  const raw = row.raw && typeof row.raw === "object" ? (row.raw as Record<string, unknown>) : null;
  const source = raw && typeof raw.source === "string" ? raw.source.trim() : "";
  return source || undefined;
}

async function triggerDispatch(runId: string): Promise<void> {
  const baseUrl =
    process.env.TALENTOS_BASE_URL ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://talent.skarion.com");
  const cronSecret = process.env.CRON_SECRET;
  const dispatchUrl = new URL(`${baseUrl}/api/job-ceo/dispatch`);
  dispatchUrl.searchParams.set("runId", runId);
  await backgroundDispatch(
    fetch(dispatchUrl.toString(), {
      method: "POST",
      headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : undefined,
    }).catch((err) => {
      console.error("[Recovery Retry] dispatch self-fetch failed:", err);
    })
  );
}
