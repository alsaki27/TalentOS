import { buildNightlyShardMatrix } from "@/lib/jobAgentNightlyPlan";
import { getNightlyDefaultGroups } from "@/lib/jobAgentRoleLibrary";
import { importApprovedBatch } from "@/lib/jobAgentImporter";
import { getBatchBridgeStats } from "@/server/repositories/jobAgentBridgeRepository";
import {
  claimBatchFinalization,
  claimLaunchableShards,
  completeBatchFinalization,
  createOrGetBatch,
  failBatchFinalization,
  getBatchById,
  getBatchByKey,
  getBatchProgress,
  listBatchShards,
  listActiveBatches,
  materializeBatchShards,
  recordBatchError,
  recoverStaleShardLaunches,
  refreshBatchAggregates,
  scheduleShardRetry,
  attachRunToClaimedShard,
  transitionBatchStatus,
  transitionShardStatus,
  type JobAgentBatchProgress,
  type JobAgentBatchRow,
  type JobAgentBatchShardRow,
} from "@/server/repositories/jobAgentBatchRepository";
import { getDefaultConfig } from "@/server/repositories/jobAgentConfigRepository";
import {
  createRun,
  listDivergedTerminalBatchRuns,
  updateRunStatus,
  type JobAgentRunRow,
} from "@/server/repositories/jobAgentRunRepository";
import {
  consumeTokenReservation,
  expireStaleTokenReservations,
  releaseTokenReservation,
  reserveTokenAtomically,
  settleTokenReservation,
} from "@/server/repositories/jobAgentTokenRepository";
import {
  executeRunFromRecord,
  type ProcessApifyRunResult,
} from "@/server/services/jobAgentService";

export const NIGHTLY_TIMEZONE = "Asia/Dhaka";
export const NIGHTLY_UTC_OFFSET_HOURS = 6;
const NIGHTLY_WINDOW_HOURS = 48;
const NIGHTLY_LAUNCH_CONCURRENCY = 5;

export interface NightlyWindow {
  businessDate: string;
  windowStart: string;
  windowEnd: string;
}

export interface StartNightlyBatchOptions {
  businessDate?: string;
  invocationType?: "scheduled" | "manual" | "recovery";
  requestId?: string;
  now?: Date;
}

export interface StartNightlyBatchResult extends JobAgentBatchProgress {
  created: boolean;
  launchResults: NightlyShardLaunchResult[];
}

export interface NightlyShardLaunchResult {
  shardId: string;
  shardKey: string;
  runId?: string;
  status: "running" | "retry_wait" | "failed" | "skipped";
  error?: string;
}

function assertBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("businessDate must use YYYY-MM-DD format");
  }
  const parsed = new Date(`${value}T00:00:00+06:00`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid businessDate");

  // Reject values normalized by Date (for example 2026-02-31).
  const local = new Date(parsed.getTime() + NIGHTLY_UTC_OFFSET_HOURS * 3_600_000)
    .toISOString()
    .slice(0, 10);
  if (local !== value) throw new Error("Invalid businessDate");
  return value;
}

/** Return the canonical midnight-to-midnight Dhaka window, independent of cron delay. */
export function getDhakaNightlyWindow(now = new Date(), requestedBusinessDate?: string): NightlyWindow {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid schedule reference time");
  const businessDate = requestedBusinessDate
    ? assertBusinessDate(requestedBusinessDate)
    : new Date(now.getTime() + NIGHTLY_UTC_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
  const windowEnd = new Date(`${businessDate}T00:00:00+06:00`);
  const windowStart = new Date(windowEnd.getTime() - NIGHTLY_WINDOW_HOURS * 3_600_000);
  return {
    businessDate,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

function projectedShardCost(maxResults: number): number {
  const configured = Number(process.env.JOB_AGENT_PROJECTED_COST_PER_RESULT_USD ?? "0.001");
  const perResult = Number.isFinite(configured) && configured >= 0 ? configured : 0.001;
  return Number((maxResults * perResult).toFixed(4));
}

async function reserveNightlyToken(input: Parameters<typeof reserveTokenAtomically>[0]) {
  // Concurrent shard launchers intentionally use SKIP LOCKED in the repository
  // to prevent overspend. Brief retries let them serialize on a small token
  // pool without converting that safe contention into a five-minute shard retry.
  for (let attempt = 0; attempt < 6; attempt++) {
    const reservation = await reserveTokenAtomically(input);
    if (reservation) return reservation;
    if (attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  return null;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function consume(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => consume())
  );
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
  return results;
}

async function launchClaimedShard(
  batch: JobAgentBatchRow,
  shard: JobAgentBatchShardRow
): Promise<NightlyShardLaunchResult> {
  const claimToken = shard.launch_claim_token;
  if (!claimToken) {
    return { shardId: shard.id, shardKey: shard.shard_key, status: "skipped", error: "Missing launch claim" };
  }

  const reservation = await reserveNightlyToken({
    reservationKey: `${batch.batch_key}:${shard.shard_key}:attempt-${shard.attempt_count}`,
    businessDate: String(batch.business_date).slice(0, 10),
    amountUsd: projectedShardCost(shard.allocated_result_limit),
    batchShardId: shard.id,
    timezone: batch.timezone,
    ttlMinutes: 180,
  });

  if (!reservation) {
    const retry = await scheduleShardRetry({
      shardId: shard.id,
      error: "No Apify token has sufficient reserved daily budget",
      fromStatuses: ["launching"],
    });
    return {
      shardId: shard.id,
      shardKey: shard.shard_key,
      status: retry?.status === "failed" ? "failed" : "retry_wait",
      error: "No Apify token has sufficient reserved daily budget",
    };
  }

  let runId: string | undefined;
  try {
    const config = await getDefaultConfig();
    if (!config.is_active) throw new Error("Job Agent config is inactive");

    const run = await createRun(
      config.id,
      shard.role_groups,
      reservation.id,
      shard.actor_source,
      {
        batchId: batch.id,
        batchShardId: shard.id,
        attemptNumber: shard.attempt_count,
        triggerType: "nightly",
        windowStart: batch.window_start,
        windowEnd: batch.window_end,
        allocatedResultLimit: shard.allocated_result_limit,
        autoImport: batch.auto_import,
        tokenReservationId: reservation.reservation.id,
        searchQueries: shard.search_queries,
      }
    );
    runId = run.id;

    const attached = await attachRunToClaimedShard({
      shardId: shard.id,
      claimToken,
      runId: run.id,
      attemptNumber: shard.attempt_count,
    });
    if (!attached) {
      await updateRunStatus(run.id, {
        status: "failed",
        error: "Nightly shard launch claim was lost before actor start",
        completed_at: new Date().toISOString(),
      });
      await releaseTokenReservation(reservation.reservation.id, "launch_claim_lost");
      return {
        shardId: shard.id,
        shardKey: shard.shard_key,
        runId: run.id,
        status: "skipped",
        error: "Launch claim lost",
      };
    }

    await executeRunFromRecord(
      run.id,
      config,
      shard.role_groups,
      reservation,
      {
        testMode: false,
        useAi: true,
        roleGroups: shard.role_groups,
        dateInterval: "2 days",
        actorSource: shard.actor_source,
        maxResults: shard.allocated_result_limit,
        explicitQueries: shard.search_queries,
        explicitGoogleQuery: shard.search_query ?? undefined,
        allowTokenRotation: false,
      }
    );
    await consumeTokenReservation(reservation.reservation.id, run.id);
    return { shardId: shard.id, shardKey: shard.shard_key, runId: run.id, status: "running" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await releaseTokenReservation(reservation.reservation.id, "actor_launch_failed").catch(() => false);
    const retry = await scheduleShardRetry({
      shardId: shard.id,
      runId: runId ?? null,
      error: message,
      fromStatuses: ["launching", "running"],
    });
    return {
      shardId: shard.id,
      shardKey: shard.shard_key,
      runId,
      status: retry?.status === "failed" ? "failed" : "retry_wait",
      error: message,
    };
  }
}

export async function launchAvailableBatchShards(batchId: string): Promise<NightlyShardLaunchResult[]> {
  const batch = await getBatchById(batchId);
  if (!batch) throw new Error(`Nightly batch not found: ${batchId}`);
  const claimed = await claimLaunchableShards(batchId, 28);
  const results = await runWithConcurrency(claimed, NIGHTLY_LAUNCH_CONCURRENCY, async (shard) => {
    try {
      return await launchClaimedShard(batch, shard);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = await scheduleShardRetry({
        shardId: shard.id,
        error: message,
        fromStatuses: ["launching", "running"],
      }).catch(() => null);
      return {
        shardId: shard.id,
        shardKey: shard.shard_key,
        status: retry?.status === "failed" ? "failed" as const : "retry_wait" as const,
        error: message,
      };
    }
  });
  await refreshBatchAggregates(batchId);
  return results;
}

export async function startOrResumeNightlyBatch(
  options: StartNightlyBatchOptions = {}
): Promise<StartNightlyBatchResult> {
  const window = getDhakaNightlyWindow(options.now ?? new Date(), options.businessDate);
  const matrix = buildNightlyShardMatrix();
  const invocationType = options.invocationType ?? "manual";
  const requestId = (options.requestId ?? "manual")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 100) || "manual";
  const batchKey = invocationType === "manual"
    ? `job-agent-nightly-dry:${window.businessDate}:${requestId}`
    : `job-agent-nightly:${window.businessDate}`;
  const existing = await getBatchByKey(batchKey);
  if (invocationType === "recovery" && !existing) {
    throw new Error(`No scheduled nightly batch exists for ${window.businessDate}`);
  }
  const defaultGroups = getNightlyDefaultGroups().map((group) => group.id);

  const batch = existing ?? await createOrGetBatch({
    batchKey,
    businessDate: window.businessDate,
    timezone: NIGHTLY_TIMEZONE,
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    triggerType: invocationType === "manual" ? "manual" : "nightly",
    // A newly created manual/test batch defaults to dry-run unless the
    // authoritative scheduled workflow explicitly opts in.
    autoImport: invocationType === "scheduled",
    actorSources: ["indeed", "linkedin", "google"],
    roleGroups: defaultGroups,
    resultCeilings: { indeed: 500, linkedin: 750, google: 500 },
    expectedShards: matrix.length,
  });

  const storedShards = await listBatchShards(batch.id);
  if (storedShards.length === 0) {
    await materializeBatchShards(
      batch.id,
      matrix.map((shard, logicalOrder) => ({
        shardKey: shard.shardKey,
        logicalOrder,
        actorSource: shard.actorSource,
        roleGroups: shard.roleGroups,
        searchQueries: shard.queries,
        searchQuery: shard.googleQuery ?? null,
        allocatedResultLimit: shard.maxResults,
        maxAttempts: 4,
      }))
    );
  } else if (storedShards.length !== batch.expected_shards) {
    throw new Error(
      `Nightly batch ${batch.id} is only partially materialized (${storedShards.length}/${batch.expected_shards})`,
    );
  }

  const launchResults = await launchAvailableBatchShards(batch.id);
  const progress = await getBatchProgress(batch.id);
  if (!progress) throw new Error(`Could not reload nightly batch ${batch.id}`);
  return { ...progress, created: !existing, launchResults };
}

export async function markNightlyRunProcessing(run: JobAgentRunRow): Promise<boolean> {
  if (!run.batch_shard_id) return false;
  const claimed = await transitionShardStatus(
    run.batch_shard_id,
    ["running"],
    "processing",
    { activeRunId: run.id }
  );
  return Boolean(claimed);
}

export async function markNightlyRunSucceeded(
  run: JobAgentRunRow,
  result: ProcessApifyRunResult
): Promise<void> {
  if (!run.batch_id || !run.batch_shard_id) return;
  await transitionShardStatus(run.batch_shard_id, ["processing", "running"], "succeeded", {
    activeRunId: null,
    lastRunId: run.id,
    rawCount: result.rawCount,
    acceptedCount: result.dateIncludedCount,
    dateExcludedCount: result.dateExcludedCount,
    dateExclusionReasons: result.dateExclusionReasons,
    duplicateCount: result.duplicateCount,
    classifiedCount: result.classifiedCount,
    completedAt: new Date().toISOString(),
    lastError: null,
  });
  if (run.token_reservation_id) {
    const configuredCost = Number(process.env.JOB_AGENT_PROJECTED_COST_PER_RESULT_USD ?? "0.001");
    const costPerResult = Number.isFinite(configuredCost) && configuredCost >= 0 ? configuredCost : 0.001;
    const cost = result.rawCount * costPerResult;
    await settleTokenReservation(run.token_reservation_id, Math.max(0, cost)).catch(() => null);
  }
  await refreshBatchAggregates(run.batch_id);
  await finalizeReadyBatch(run.batch_id);
}

export async function markNightlyRunFailed(run: JobAgentRunRow, error: string): Promise<void> {
  if (!run.batch_id || !run.batch_shard_id) return;
  await scheduleShardRetry({
    shardId: run.batch_shard_id,
    runId: run.id,
    error,
    fromStatuses: ["launching", "running", "processing"],
  });
  await refreshBatchAggregates(run.batch_id);
  await finalizeReadyBatch(run.batch_id);
}

export async function finalizeReadyBatch(batchId: string): Promise<JobAgentBatchRow | null> {
  const claimed = await claimBatchFinalization(batchId);
  if (!claimed) return getBatchById(batchId);
  const claimToken = claimed.finalization_claim_token;
  if (!claimToken) throw new Error(`Batch ${batchId} was claimed without a finalization token`);

  try {
    if (claimed.succeeded_shards === 0) {
      const failed = await transitionBatchStatus(claimed.id, ["finalizing"], "failed");
      return failed;
    }

    const terminalStatus = claimed.failed_shards > 0 ? "partial_success" : "succeeded";
    if (!claimed.auto_import) {
      return completeBatchFinalization({
        batchId: claimed.id,
        claimToken,
        status: terminalStatus,
        importedCount: 0,
      });
    }

    if (claimed.job_ceo_run_id) {
      const stats = await getBatchBridgeStats(claimed.id);
      await refreshBatchAggregates(claimed.id);
      return completeBatchFinalization({
        batchId: claimed.id,
        claimToken,
        status: terminalStatus,
        importedCount: stats.imported,
        jobCeoRunId: claimed.job_ceo_run_id,
      });
    }

    const imported = await importApprovedBatch(claimed.id, claimToken);
    if (!imported.batchClaimAccepted) {
      throw new Error("Nightly batch finalization claim expired before Job CEO handoff");
    }
    await refreshBatchAggregates(claimed.id);
    return completeBatchFinalization({
      batchId: claimed.id,
      claimToken,
      status: terminalStatus,
      importedCount: imported.imported,
      jobCeoRunId: imported.jobCeoRunId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failBatchFinalization(claimed.id, claimToken, message);
    throw error;
  }
}

/** Poller recovery: expire abandoned reservations, launch due retries, and finalize barriers. */
export async function advanceActiveNightlyBatches(): Promise<void> {
  const divergedRuns = await listDivergedTerminalBatchRuns();
  for (const run of divergedRuns) {
    if (run.status === "succeeded") {
      await markNightlyRunSucceeded(run, {
        rawCount: run.raw_count,
        dateIncludedCount: Math.max(0, run.raw_count - run.date_excluded_count),
        dateExcludedCount: run.date_excluded_count,
        dateExclusionReasons: {
          missing_date: Number(run.date_exclusion_reasons?.missing_date ?? 0),
          unparseable_date: Number(run.date_exclusion_reasons?.unparseable_date ?? 0),
          ambiguous_date: Number(run.date_exclusion_reasons?.ambiguous_date ?? 0),
          before_window: Number(run.date_exclusion_reasons?.before_window ?? 0),
          after_window: Number(run.date_exclusion_reasons?.after_window ?? 0),
        },
        duplicateCount: Math.max(0, run.skipped_count - run.date_excluded_count),
        classifiedCount: run.classified_count,
      });
    } else {
      await markNightlyRunFailed(run, run.error ?? "Terminal attempt failed before shard reconciliation");
    }
  }
  await expireStaleTokenReservations();
  await recoverStaleShardLaunches();
  const batches = await listActiveBatches(20);
  for (const batch of batches) {
    try {
      await launchAvailableBatchShards(batch.id);
      await refreshBatchAggregates(batch.id);
      await finalizeReadyBatch(batch.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordBatchError(batch.id, message).catch(() => undefined);
      console.error(`[job-agent-nightly] Failed to advance batch ${batch.id}:`, message);
    }
  }
}
