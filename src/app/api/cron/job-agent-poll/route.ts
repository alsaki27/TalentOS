// src/app/api/cron/job-agent-poll/route.ts
// Polls Apify attempts, processes each dataset once, launches due retries, and
// advances the nightly batch barrier/finalization. GET and POST are equivalent.

import { NextRequest, NextResponse } from "next/server";
import {
  cleanupStuckRuns,
  listRunningRuns,
  transitionRunStatus,
  type JobAgentRunRow,
} from "@/server/repositories/jobAgentRunRepository";
import { getTokenById } from "@/server/repositories/jobAgentTokenRepository";
import {
  checkApifyRunStatus,
  processApifyRunData,
  type ProcessApifyRunOptions,
} from "@/server/services/jobAgentService";
import {
  advanceActiveNightlyBatches,
  markNightlyRunFailed,
  markNightlyRunProcessing,
  markNightlyRunSucceeded,
} from "@/server/services/jobAgentNightlyService";

export const dynamic = "force-dynamic";

const METADATA_GRACE_MS = 5 * 60 * 1000;
const PROCESSING_LEASE_MS = 30 * 60 * 1000;
const MAX_DATASETS_PER_POLL = 1;

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function runAgeMs(run: JobAgentRunRow): number {
  const timestamp = new Date(run.started_at ?? run.created_at ?? 0).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
}

async function failClaimedRun(run: JobAgentRunRow, message: string): Promise<boolean> {
  const won = await transitionRunStatus(run.id, run.status, {
    status: "failed",
    error: message,
    completed_at: new Date().toISOString(),
    processing_started_at: null,
  });
  if (won && run.batch_id) {
    await markNightlyRunFailed(run, message);
  }
  return won;
}

function processingOptions(run: JobAgentRunRow): ProcessApifyRunOptions {
  const base: ProcessApifyRunOptions & { batchId?: string } = {
    useAi: true,
    actorSource: (run.actor_source as ProcessApifyRunOptions["actorSource"]) ?? "indeed",
    roleGroups: run.role_groups_ran ?? undefined,
  };

  if (!run.batch_id) return base;
  if (!run.window_start || !run.window_end) {
    throw new Error("Nightly run is missing its immutable posting-date window");
  }

  base.windowStart = run.window_start;
  base.windowEnd = run.window_end;
  // Relative labels (for example "1 hour ago") are relative to when this
  // actor attempt actually scraped, which can be later than midnight if cron
  // was delayed. The immutable window still rejects anything after windowEnd.
  base.dateReferenceStartTime = run.started_at;
  base.dateReferenceTime = new Date().toISOString();
  // The service uses this to exclude historical jobs while preserving candidates
  // produced by other shards in this same batch until deterministic finalization.
  base.batchId = run.batch_id;
  return base;
}

async function handlePoll(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Repository cleanup intentionally covers only legacy/manual attempts. Batch
  // attempt recovery is coordinated through shard retries below.
  const cleanedUp = await cleanupStuckRuns(180).catch((error) => {
    console.error("[job-agent-poll] cleanupStuckRuns error:", error);
    return 0;
  });

  const runningRuns = await listRunningRuns();
  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let datasetsClaimed = 0;

  for (const run of runningRuns) {
    // A request can die after claiming processing. Fail that attempt after a
    // conservative lease and let the logical shard retry. Reopening the same
    // dataset would risk two processors running concurrently.
    if (run.status === "processing") {
      try {
        const processingStartedAt = run.processing_started_at;
        const processingAge = processingStartedAt
          ? Date.now() - new Date(processingStartedAt).getTime()
          : 0;
        if (processingStartedAt && Number.isFinite(processingAge) && processingAge >= PROCESSING_LEASE_MS) {
          const message = "Dataset processing lease expired after 30 minutes";
          const recovered = await transitionRunStatus(run.id, "processing", {
            status: "failed",
            error: message,
            completed_at: new Date().toISOString(),
            processing_started_at: null,
          });
          if (recovered && run.batch_id) {
            await markNightlyRunFailed(run, message);
          }
          results.push({ runId: run.id, status: recovered ? "processing_lease_failed" : "already_recovered" });
        } else {
          results.push({ runId: run.id, status: "already_processing" });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ runId: run.id, status: "recovery_error", error: message });
        console.error(`[job-agent-poll] Processing lease recovery failed for ${run.id}:`, error);
      }
      continue;
    }

    if (datasetsClaimed >= MAX_DATASETS_PER_POLL) {
      results.push({ runId: run.id, status: "deferred_to_next_poll" });
      continue;
    }

    if (!run.apify_run_id || !run.apify_dataset_id || !run.token_id) {
      const ageMs = runAgeMs(run);
      if (ageMs < METADATA_GRACE_MS) {
        results.push({ runId: run.id, status: "awaiting_metadata", ageSeconds: Math.round(ageMs / 1000) });
        continue;
      }

      const message = "Missing Apify metadata (stuck for more than 5 minutes)";
      try {
        const won = await failClaimedRun(run, message);
        results.push({ runId: run.id, status: won ? "failed_missing_metadata" : "already_claimed" });
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        results.push({ runId: run.id, status: "failure_transition_error", error: failure });
        console.error(`[job-agent-poll] Could not fail metadata-less run ${run.id}:`, error);
      }
      continue;
    }

    try {
      const token = await getTokenById(run.token_id);
      if (!token) {
        const message = "Apify token not found";
        const won = await failClaimedRun(run, message);
        results.push({ runId: run.id, status: won ? "failed_missing_token" : "already_claimed" });
        continue;
      }

      const apifyStatus = await checkApifyRunStatus(run.apify_run_id, token);

      if (apifyStatus === "SUCCEEDED") {
        const claimed = await transitionRunStatus(run.id, "running", {
          status: "processing",
          processing_started_at: new Date().toISOString(),
        });
        if (!claimed) {
          results.push({ runId: run.id, status: "already_claimed" });
          continue;
        }
        datasetsClaimed++;

        if (run.batch_id) {
          const shardClaimed = await markNightlyRunProcessing(run);
          if (!shardClaimed) {
            const message = "Nightly shard could not enter processing state";
            await transitionRunStatus(run.id, "processing", {
              status: "failed",
              error: message,
              completed_at: new Date().toISOString(),
              processing_started_at: null,
            });
            await markNightlyRunFailed(run, message);
            results.push({ runId: run.id, status: "failed_shard_claim", error: message });
            continue;
          }
        }

        try {
          const outcome = await processApifyRunData(
            run.id,
            run.apify_dataset_id,
            token,
            processingOptions(run)
          );
          if (run.batch_id) await markNightlyRunSucceeded(run, outcome);
          results.push({ runId: run.id, status: "processed", outcome });
          processed++;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await transitionRunStatus(run.id, "processing", {
            status: "failed",
            error: message,
            completed_at: new Date().toISOString(),
            processing_started_at: null,
          }).catch(() => false);
          if (run.batch_id) await markNightlyRunFailed(run, message);
          results.push({ runId: run.id, status: "processing_failed", error: message });
          console.error(`[job-agent-poll] Processing run ${run.id} failed:`, error);
        }
      } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus)) {
        const message = `Apify run ended with status ${apifyStatus}`;
        const won = await failClaimedRun(run, message);
        results.push({ runId: run.id, status: won ? "failed_on_apify" : "already_claimed", apifyStatus });
      } else {
        results.push({ runId: run.id, status: "still_running", apifyStatus });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ runId: run.id, status: "poll_error", error: message });
      console.error(`[job-agent-poll] Error polling run ${run.id}:`, error);
    }
  }

  let advanceError: string | null = null;
  try {
    // This runs even when there are no active attempts: due retries and a ready
    // all-terminal batch still need to be launched/finalized.
    await advanceActiveNightlyBatches();
  } catch (error) {
    advanceError = error instanceof Error ? error.message : String(error);
    console.error("[job-agent-poll] Nightly batch recovery failed:", error);
  }

  return NextResponse.json({
    ok: advanceError === null,
    cleanedUp,
    polled: runningRuns.length,
    processed,
    results,
    advanceError,
  }, { status: advanceError === null ? 200 : 500 });
}

export async function GET(req: NextRequest) {
  return handlePoll(req);
}

export async function POST(req: NextRequest) {
  return handlePoll(req);
}
