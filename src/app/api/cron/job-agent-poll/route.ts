// src/app/api/cron/job-agent-poll/route.ts
// Polls Apify attempts, processes each dataset once, launches due retries, and
// advances the nightly batch barrier/finalization. GET and POST are equivalent.

import { NextRequest, NextResponse } from "next/server";
import {
  getRunById,
  listRunningRuns,
  recordRunPollFailure,
  recordRunPollSuccess,
  requestRunCancellation,
  transitionRunStatus,
  updateRunStatus,
  type JobAgentRunRow,
} from "@/server/repositories/jobAgentRunRepository";
import {
  deactivateToken,
  getTokenById,
  markTokenError,
  settleTokenReservation,
} from "@/server/repositories/jobAgentTokenRepository";
import {
  abortApifyRun,
  checkApifyTokenIdentity,
  getApifyRunDetails,
  isApifyAuthorizationError,
  processApifyRunData,
  type ProcessApifyRunOptions,
} from "@/server/services/jobAgentService";
import {
  advanceActiveNightlyBatches,
  markNightlyRunFailed,
  markNightlyRunUnrecoverable,
  markNightlyRunProcessing,
  markNightlyRunSucceeded,
  isJobAgentNightlyEnabled,
} from "@/server/services/jobAgentNightlyService";

export const dynamic = "force-dynamic";

const METADATA_GRACE_MS = 5 * 60 * 1000;
const ACTOR_TIMEOUT_GRACE_MS = 5 * 60 * 1000;
// Dataset processing is now bounded by the Apify fetch timeouts and the
// indexed historical-dedupe path. Keep a generous lease so a second poller
// cannot reclaim a legitimately slow request while the first one is still
// committing rows. A genuinely abandoned attempt is still recovered on the
// next poll after 30 minutes and can enter the normal shard retry path.
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
  if (!["running", "pending", "processing"].includes(run.status)) return false;
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

  if (run.batch_id && (!run.window_start || !run.window_end)) {
    throw new Error("Nightly run is missing its immutable posting-date window");
  }

  if (run.window_start && run.window_end) {
    base.windowStart = run.window_start;
    base.windowEnd = run.window_end;
    // Relative labels (for example "1 hour ago") are relative to when this
    // actor attempt actually scraped. Keep the recorded request window immutable.
    base.dateReferenceStartTime = run.started_at;
    base.dateReferenceTime = new Date().toISOString();
  }
  if (run.batch_id) base.batchId = run.batch_id;
  return base;
}

async function disableTokenIfIdentityIsRejected(run: JobAgentRunRow, message: string): Promise<void> {
  if (!run.token_id) return;
  const token = await getTokenById(run.token_id);
  if (!token) return;
  const identity = await checkApifyTokenIdentity(token);
  if (identity.status === 401) {
    await markTokenError(run.token_id, `Apify /users/me rejected token while polling run ${run.id}: ${message}`);
    await deactivateToken(run.token_id);
    console.error(`[job-agent-poll] Apify confirmed token ${run.token_id} is invalid; disabled it for future starts.`);
    return;
  }
  console.warn(
    `[job-agent-poll] Run resource returned 401 for ${run.id}, but /users/me did not confirm an invalid token (status=${identity.status ?? "unavailable"}); keeping the key active.`,
  );
}

async function runJobAgentPoll() {
  const runningRuns = await listRunningRuns();
  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let datasetsClaimed = 0;

  for (const run of runningRuns) {
    // The five-minute poller is shared with manual Job Agent runs. Keep it
    // active, but do not poll, process, retry, or hand off paused nightly
    // batches.
    if (run.batch_id && !isJobAgentNightlyEnabled()) {
      results.push({ runId: run.id, status: "nightly_disabled" });
      continue;
    }
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
          const message = `Dataset processing lease expired after ${Math.round(PROCESSING_LEASE_MS / 60000)} minutes`;
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

      const apifyRun = await getApifyRunDetails(run.apify_run_id, token);
      const apifyStatus = apifyRun.status;
      await recordRunPollSuccess(run.id);

      if (apifyStatus === "SUCCEEDED") {
        const claimed = await transitionRunStatus(run.id, "running", {
          status: "processing",
          processing_started_at: new Date().toISOString(),
          cancel_requested_at: null,
          cancellation_kind: null,
          cancel_reason: null,
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
          if (run.token_reservation_id && !run.batch_id) {
            const configuredCost = Number(process.env.JOB_AGENT_PROJECTED_COST_PER_RESULT_USD ?? "0.001");
            const costPerResult = Number.isFinite(configuredCost) && configuredCost >= 0 ? configuredCost : 0.001;
            await settleTokenReservation(run.token_reservation_id, outcome.rawCount * costPerResult).catch((error) => {
              console.error(`[job-agent-poll] Could not settle token reservation for ${run.id}:`, error);
            });
          }
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
          if (isApifyAuthorizationError(error)) {
            await disableTokenIfIdentityIsRejected(run, message).catch((healthError) => {
              console.error(`[job-agent-poll] Could not validate token health for ${run.id}:`, healthError);
            });
            const actionableError = `Apify authorization was rejected while fetching this dataset (${message}). The local run is marked failed; verify and stop the remote actor in Apify if it is still active.`;
            await updateRunStatus(run.id, {
              status: "failed",
              error: actionableError,
              completed_at: new Date().toISOString(),
              processing_started_at: null,
            }).catch(() => undefined);
            if (run.batch_id) await markNightlyRunUnrecoverable(run, actionableError);
            results.push({ runId: run.id, status: "authorization_failed_remote_unverified", error: actionableError });
            console.error(`[job-agent-poll] Dataset authorization failed for run ${run.id}; nightly retry suppressed to avoid a duplicate actor.`);
          } else {
            if (run.batch_id) await markNightlyRunFailed(run, message);
            results.push({ runId: run.id, status: "processing_failed", error: message });
            console.error(`[job-agent-poll] Processing run ${run.id} failed:`, error);
          }
        }
      } else if (["FAILED", "ABORTED", "TIMED-OUT"].includes(apifyStatus)) {
        // Re-read the cancellation marker because an operator may have clicked
        // Cancel while this poll request was already in flight.
        const latestRun = await getRunById(run.id);
        const operatorCancelled = apifyStatus === "ABORTED" && latestRun?.cancellation_kind === "operator";
        const detail = [
          apifyRun.statusMessage,
          apifyRun.exitCode === null ? null : `exit code ${apifyRun.exitCode}`,
        ].filter(Boolean).join(" · ");
        const message = operatorCancelled
          ? "Apify run cancelled by operator."
          : `${latestRun?.cancellation_kind === "timeout" ? "Apify run exceeded its configured time limit and was stopped" : `Apify run ended with status ${apifyStatus}`}${detail ? `: ${detail}` : ""}`;
        if (operatorCancelled) {
          const won = await transitionRunStatus(run.id, run.status, {
            status: "cancelled",
            error: message,
            completed_at: new Date().toISOString(),
            processing_started_at: null,
          });
          results.push({ runId: run.id, status: won ? "cancelled" : "already_claimed", apifyStatus, message });
        } else {
          const won = await failClaimedRun(latestRun ?? run, message);
          results.push({ runId: run.id, status: won ? "failed_on_apify" : "already_claimed", apifyStatus, message });
        }
      } else {
        const actorTimeoutMs = run.actor_source === "google" ? 30 * 60_000 : 60 * 60_000;
        const actorStartedAtMs = apifyRun.startedAt ? new Date(apifyRun.startedAt).getTime() : new Date(run.started_at).getTime();
        const actorAgeMs = Number.isFinite(actorStartedAtMs) ? Date.now() - actorStartedAtMs : 0;

        if (run.cancellation_kind === "operator" && ["READY", "RUNNING", "ABORTING"].includes(apifyStatus)) {
          const aborted = await abortApifyRun(run.apify_run_id, token);
          if (aborted.status === "ABORTED") {
            const latestRun = await getRunById(run.id);
            const won = latestRun?.cancellation_kind === "operator"
              ? await transitionRunStatus(run.id, "running", {
                  status: "cancelled",
                  cancel_reason: "Cancelled by operator.",
                  error: "Apify run cancelled by operator.",
                  completed_at: new Date().toISOString(),
                })
              : false;
            results.push({ runId: run.id, status: won ? "cancelled" : "already_claimed", apifyStatus: aborted.status });
          } else {
            results.push({ runId: run.id, status: "operator_abort_pending", apifyStatus: aborted.status });
          }
          continue;
        }

        if (["RUNNING", "READY", "TIMING-OUT"].includes(apifyStatus) && actorAgeMs > actorTimeoutMs + ACTOR_TIMEOUT_GRACE_MS) {
          const reason = `Apify actor exceeded its configured ${Math.round(actorTimeoutMs / 60_000)}-minute time limit; automatic abort requested.`;
          const alreadyTimedOut = run.cancellation_kind === "timeout";
          const claimedTimeout = alreadyTimedOut || await requestRunCancellation(run.id, "timeout", reason);
          if (!claimedTimeout) {
            results.push({ runId: run.id, status: "abort_already_requested", cancellationKind: run.cancellation_kind });
            continue;
          }
          const aborted = await abortApifyRun(run.apify_run_id, token);
          if (["ABORTED", "FAILED", "TIMED-OUT"].includes(aborted.status)) {
            const latestRun = await getRunById(run.id);
            const won = await failClaimedRun(latestRun ?? run, reason);
            results.push({ runId: run.id, status: won ? "failed_actor_timeout" : "already_claimed", apifyStatus: aborted.status, error: reason });
          } else {
            results.push({ runId: run.id, status: "actor_timeout_abort_requested", apifyStatus: aborted.status, error: reason });
          }
        } else {
          results.push({ runId: run.id, status: "still_running", apifyStatus });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureCount = await recordRunPollFailure(run.id, message).catch(() => 0);
      if (run.token_id && isApifyAuthorizationError(error)) {
        // A run-scoped 401 can mean a valid key belongs to another account.
        // Disable it only if Apify's account endpoint also rejects the key.
        await disableTokenIfIdentityIsRejected(run, message).catch((healthError) => {
          console.error(`[job-agent-poll] Could not validate token health for ${run.id}:`, healthError);
        });
        const actionableError = `Apify authorization was rejected while checking this run (${message}). The local run is marked failed; verify and stop the remote actor in Apify if it is still active.`;
        await transitionRunStatus(run.id, run.status, {
          status: "failed",
          error: actionableError,
          completed_at: new Date().toISOString(),
          processing_started_at: null,
        }).catch((statusError) => {
          console.error(`[job-agent-poll] Could not close unauthorized run ${run.id}:`, statusError);
        });
        if (run.batch_id) {
          await markNightlyRunUnrecoverable(run, actionableError).catch((batchError) => {
            console.error(`[job-agent-poll] Could not close unauthorized nightly shard ${run.id}:`, batchError);
          });
        }
        results.push({ runId: run.id, status: "authorization_failed_remote_unverified", error: actionableError, consecutiveFailures: failureCount });
        console.error(`[job-agent-poll] Apify authorization failed for run ${run.id}; token disabled and remote actor state is unverified.`);
        continue;
      }
      results.push({ runId: run.id, status: "poll_error", error: message });
      console.error(`[job-agent-poll] Error polling run ${run.id} (consecutive failures: ${failureCount}):`, error);
    }
  }

  let advanceError: string | null = null;
  try {
    // This runs even when there are no active attempts: due retries and a ready
    // all-terminal batch still need to be launched/finalized.
    if (isJobAgentNightlyEnabled()) await advanceActiveNightlyBatches();
  } catch (error) {
    advanceError = error instanceof Error ? error.message : String(error);
    console.error("[job-agent-poll] Nightly batch recovery failed:", error);
  }

  const pollErrors = results.filter((result) => result.status === "poll_error").length;
  return NextResponse.json({
    ok: advanceError === null,
    polled: runningRuns.length,
    processed,
    pollErrors,
    results,
    advanceError,
  }, { status: advanceError === null ? 200 : 500 });
}

async function handlePoll(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runJobAgentPoll();
}

export async function GET(req: NextRequest) {
  return handlePoll(req);
}

export async function POST(req: NextRequest) {
  return handlePoll(req);
}
