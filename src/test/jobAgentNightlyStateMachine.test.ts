import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildNightlyShardMatrix: vi.fn(),
  getNightlyDefaultGroups: vi.fn(),
  importApprovedBatch: vi.fn(),
  getBatchBridgeStats: vi.fn(),
  claimBatchFinalization: vi.fn(),
  claimLaunchableShards: vi.fn(),
  completeBatchFinalization: vi.fn(),
  createOrGetBatch: vi.fn(),
  failBatchFinalization: vi.fn(),
  getBatchById: vi.fn(),
  getBatchByKey: vi.fn(),
  getBatchProgress: vi.fn(),
  listBatchShards: vi.fn(),
  listActiveBatches: vi.fn(),
  materializeBatchShards: vi.fn(),
  recordBatchError: vi.fn(),
  recoverStaleShardLaunches: vi.fn(),
  refreshBatchAggregates: vi.fn(),
  scheduleShardRetry: vi.fn(),
  attachRunToClaimedShard: vi.fn(),
  transitionBatchStatus: vi.fn(),
  transitionShardStatus: vi.fn(),
  getDefaultConfig: vi.fn(),
  createRun: vi.fn(),
  listDivergedTerminalBatchRuns: vi.fn(),
  updateRunStatus: vi.fn(),
  consumeTokenReservation: vi.fn(),
  expireStaleTokenReservations: vi.fn(),
  releaseTokenReservation: vi.fn(),
  reserveTokenAtomically: vi.fn(),
  settleTokenReservation: vi.fn(),
  executeRunFromRecord: vi.fn(),
}));

vi.mock("@/lib/jobAgentNightlyPlan", () => ({
  buildNightlyShardMatrix: mocks.buildNightlyShardMatrix,
}));
vi.mock("@/lib/jobAgentRoleLibrary", () => ({
  getNightlyDefaultGroups: mocks.getNightlyDefaultGroups,
}));
vi.mock("@/lib/jobAgentImporter", () => ({
  importApprovedBatch: mocks.importApprovedBatch,
}));
vi.mock("@/server/repositories/jobAgentBridgeRepository", () => ({
  getBatchBridgeStats: mocks.getBatchBridgeStats,
}));
vi.mock("@/server/repositories/jobAgentBatchRepository", () => ({
  claimBatchFinalization: mocks.claimBatchFinalization,
  claimLaunchableShards: mocks.claimLaunchableShards,
  completeBatchFinalization: mocks.completeBatchFinalization,
  createOrGetBatch: mocks.createOrGetBatch,
  failBatchFinalization: mocks.failBatchFinalization,
  getBatchById: mocks.getBatchById,
  getBatchByKey: mocks.getBatchByKey,
  getBatchProgress: mocks.getBatchProgress,
  listBatchShards: mocks.listBatchShards,
  listActiveBatches: mocks.listActiveBatches,
  materializeBatchShards: mocks.materializeBatchShards,
  recordBatchError: mocks.recordBatchError,
  recoverStaleShardLaunches: mocks.recoverStaleShardLaunches,
  refreshBatchAggregates: mocks.refreshBatchAggregates,
  scheduleShardRetry: mocks.scheduleShardRetry,
  attachRunToClaimedShard: mocks.attachRunToClaimedShard,
  transitionBatchStatus: mocks.transitionBatchStatus,
  transitionShardStatus: mocks.transitionShardStatus,
}));
vi.mock("@/server/repositories/jobAgentConfigRepository", () => ({
  getDefaultConfig: mocks.getDefaultConfig,
}));
vi.mock("@/server/repositories/jobAgentRunRepository", () => ({
  createRun: mocks.createRun,
  listDivergedTerminalBatchRuns: mocks.listDivergedTerminalBatchRuns,
  updateRunStatus: mocks.updateRunStatus,
}));
vi.mock("@/server/repositories/jobAgentTokenRepository", () => ({
  consumeTokenReservation: mocks.consumeTokenReservation,
  expireStaleTokenReservations: mocks.expireStaleTokenReservations,
  releaseTokenReservation: mocks.releaseTokenReservation,
  reserveTokenAtomically: mocks.reserveTokenAtomically,
  settleTokenReservation: mocks.settleTokenReservation,
}));
vi.mock("@/server/services/jobAgentService", () => ({
  executeRunFromRecord: mocks.executeRunFromRecord,
}));

import {
  advanceActiveNightlyBatches,
  finalizeReadyBatch,
  startOrResumeNightlyBatch,
} from "@/server/services/jobAgentNightlyService";
import type {
  JobAgentBatchProgress,
  JobAgentBatchRow,
  JobAgentBatchShardRow,
} from "@/server/repositories/jobAgentBatchRepository";
import type { JobAgentRunRow } from "@/server/repositories/jobAgentRunRepository";

const SHARD_PLAN = [{
  shardKey: "indeed-ca",
  actorSource: "indeed" as const,
  roleGroups: ["A", "B"],
  queries: ["Engineer"],
  maxResults: 100,
}];

function batch(overrides: Partial<JobAgentBatchRow> = {}): JobAgentBatchRow {
  return {
    id: "batch-1",
    batch_key: "job-agent-nightly:2026-08-07",
    business_date: "2026-08-07",
    timezone: "Asia/Dhaka",
    window_start: "2026-08-04T18:00:00.000Z",
    window_end: "2026-08-06T18:00:00.000Z",
    trigger_type: "nightly",
    auto_import: true,
    status: "running",
    actor_sources: ["indeed", "linkedin", "google"],
    role_groups: ["A", "B"],
    result_ceilings: { indeed: 500, linkedin: 750, google: 500 },
    expected_shards: 1,
    terminal_shards: 0,
    succeeded_shards: 0,
    failed_shards: 0,
    raw_count: 0,
    accepted_count: 0,
    date_excluded_count: 0,
    date_exclusion_reasons: {},
    duplicate_count: 0,
    final_duplicate_count: 0,
    classified_count: 0,
    imported_count: 0,
    errors: [],
    last_error: null,
    job_ceo_run_id: null,
    finalization_claim_token: null,
    finalization_claimed_at: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-06T18:00:00.000Z",
    updated_at: "2026-08-06T18:00:00.000Z",
    ...overrides,
  };
}

function shard(overrides: Partial<JobAgentBatchShardRow> = {}): JobAgentBatchShardRow {
  return {
    id: "shard-1",
    batch_id: "batch-1",
    shard_key: "indeed-ca",
    logical_order: 0,
    actor_source: "indeed",
    role_groups: ["A", "B"],
    search_queries: ["Engineer"],
    search_query: null,
    allocated_result_limit: 100,
    status: "pending",
    attempt_count: 0,
    max_attempts: 4,
    active_run_id: null,
    last_run_id: null,
    next_retry_at: null,
    launch_claim_token: null,
    launch_claimed_at: null,
    raw_count: 0,
    accepted_count: 0,
    date_excluded_count: 0,
    date_exclusion_reasons: {},
    duplicate_count: 0,
    classified_count: 0,
    imported_count: 0,
    errors: [],
    last_error: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-06T18:00:00.000Z",
    updated_at: "2026-08-06T18:00:00.000Z",
    ...overrides,
  };
}

function progress(row: JobAgentBatchRow, shards: JobAgentBatchShardRow[] = []): JobAgentBatchProgress {
  return {
    batch: row,
    shards,
    allTerminal: row.expected_shards > 0 && row.terminal_shards === row.expected_shards,
    hasFailures: row.failed_shards > 0,
  };
}

function terminalRun(status: "succeeded" | "failed", id: string): JobAgentRunRow {
  return {
    id,
    config_id: "config-1",
    token_id: null,
    token_reservation_id: null,
    apify_run_id: `apify-${id}`,
    apify_dataset_id: `dataset-${id}`,
    status,
    actor_source: "indeed",
    batch_id: "batch-1",
    batch_shard_id: `shard-${id}`,
    attempt_number: 1,
    trigger_type: "nightly",
    window_start: "2026-08-04T18:00:00.000Z",
    window_end: "2026-08-06T18:00:00.000Z",
    allocated_result_limit: 100,
    auto_import: true,
    auto_import_status: "pending",
    auto_import_error: null,
    auto_import_completed_at: null,
    date_excluded_count: status === "succeeded" ? 2 : 0,
    date_exclusion_reasons: status === "succeeded" ? { before_window: 2 } : {},
    processing_started_at: null,
    raw_count: status === "succeeded" ? 10 : 0,
    deduped_count: 0,
    imported_count: 0,
    skipped_count: status === "succeeded" ? 3 : 0,
    classified_count: status === "succeeded" ? 7 : 0,
    estimated_cost_usd: 0,
    error: status === "failed" ? "actor failed" : null,
    role_groups_ran: ["A", "B"],
    search_queries_ran: ["Engineer"],
    started_at: "2026-08-06T18:00:00.000Z",
    completed_at: "2026-08-06T18:05:00.000Z",
    created_at: "2026-08-06T18:00:00.000Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.buildNightlyShardMatrix.mockReturnValue(SHARD_PLAN);
  mocks.getNightlyDefaultGroups.mockReturnValue([
    { id: "A", label: "A", roles: [], nightlyDefault: true },
    { id: "B", label: "B", roles: [], nightlyDefault: true },
  ]);
  mocks.claimLaunchableShards.mockResolvedValue([]);
  mocks.refreshBatchAggregates.mockImplementation(async (id: string) => batch({ id }));
  mocks.expireStaleTokenReservations.mockResolvedValue(0);
  mocks.recoverStaleShardLaunches.mockResolvedValue(0);
  mocks.listActiveBatches.mockResolvedValue([]);
  mocks.listDivergedTerminalBatchRuns.mockResolvedValue([]);
});

describe("nightly batch identity and launch mode", () => {
  test("scheduled calls use the canonical business-date key and enable auto-import", async () => {
    const row = batch();
    mocks.getBatchByKey.mockResolvedValue(null);
    mocks.createOrGetBatch.mockResolvedValue(row);
    mocks.listBatchShards.mockResolvedValue([]);
    mocks.getBatchById.mockResolvedValue(row);
    mocks.getBatchProgress.mockResolvedValue(progress(row, [shard()]));

    const result = await startOrResumeNightlyBatch({
      invocationType: "scheduled",
      now: new Date("2026-08-06T18:00:00.000Z"),
    });

    expect(result.created).toBe(true);
    expect(mocks.getBatchByKey).toHaveBeenCalledWith("job-agent-nightly:2026-08-07");
    expect(mocks.createOrGetBatch).toHaveBeenCalledWith(expect.objectContaining({
      batchKey: "job-agent-nightly:2026-08-07",
      businessDate: "2026-08-07",
      triggerType: "nightly",
      autoImport: true,
      expectedShards: 1,
    }));
    expect(mocks.materializeBatchShards).toHaveBeenCalledWith("batch-1", [expect.objectContaining({
      shardKey: "indeed-ca",
      maxAttempts: 4,
    })]);
  });

  test("manual calls get an isolated dry-run key and cannot auto-import", async () => {
    const row = batch({
      batch_key: "job-agent-nightly-dry:2026-08-07:QA-run-7",
      trigger_type: "manual",
      auto_import: false,
    });
    mocks.getBatchByKey.mockResolvedValue(null);
    mocks.createOrGetBatch.mockResolvedValue(row);
    mocks.listBatchShards.mockResolvedValue([]);
    mocks.getBatchById.mockResolvedValue(row);
    mocks.getBatchProgress.mockResolvedValue(progress(row, [shard()]));

    await startOrResumeNightlyBatch({
      invocationType: "manual",
      requestId: "QA run #7",
      now: new Date("2026-08-06T18:00:00.000Z"),
    });

    expect(mocks.createOrGetBatch).toHaveBeenCalledWith(expect.objectContaining({
      batchKey: "job-agent-nightly-dry:2026-08-07:QA-run-7",
      triggerType: "manual",
      autoImport: false,
    }));
  });

  test("recovery resumes only the scheduled key and never creates a missing batch", async () => {
    mocks.getBatchByKey.mockResolvedValue(null);

    await expect(startOrResumeNightlyBatch({
      invocationType: "recovery",
      businessDate: "2026-08-07",
    })).rejects.toThrow("No scheduled nightly batch exists for 2026-08-07");
    expect(mocks.getBatchByKey).toHaveBeenCalledWith("job-agent-nightly:2026-08-07");
    expect(mocks.createOrGetBatch).not.toHaveBeenCalled();

    vi.resetAllMocks();
    const existing = batch();
    mocks.buildNightlyShardMatrix.mockReturnValue(SHARD_PLAN);
    mocks.getNightlyDefaultGroups.mockReturnValue([{ id: "A" }, { id: "B" }]);
    mocks.getBatchByKey.mockResolvedValue(existing);
    mocks.listBatchShards.mockResolvedValue([shard()]);
    mocks.getBatchById.mockResolvedValue(existing);
    mocks.claimLaunchableShards.mockResolvedValue([]);
    mocks.refreshBatchAggregates.mockResolvedValue(existing);
    mocks.getBatchProgress.mockResolvedValue(progress(existing, [shard()]));

    const resumed = await startOrResumeNightlyBatch({
      invocationType: "recovery",
      businessDate: "2026-08-07",
    });
    expect(resumed.created).toBe(false);
    expect(mocks.createOrGetBatch).not.toHaveBeenCalled();
    expect(mocks.materializeBatchShards).not.toHaveBeenCalled();
  });
});

describe("nightly finalization state machine", () => {
  test("a dry batch completes without invoking the Job CEO importer", async () => {
    const claimed = batch({
      status: "finalizing",
      auto_import: false,
      terminal_shards: 1,
      succeeded_shards: 1,
      finalization_claim_token: "claim-1",
    });
    const completed = batch({ status: "succeeded", terminal_shards: 1, succeeded_shards: 1 });
    mocks.claimBatchFinalization.mockResolvedValue(claimed);
    mocks.completeBatchFinalization.mockResolvedValue(completed);

    expect(await finalizeReadyBatch("batch-1")).toBe(completed);
    expect(mocks.importApprovedBatch).not.toHaveBeenCalled();
    expect(mocks.completeBatchFinalization).toHaveBeenCalledWith({
      batchId: "batch-1",
      claimToken: "claim-1",
      status: "succeeded",
      importedCount: 0,
    });
  });

  test("an automatic batch creates at most one bridge handoff across repeated finalization", async () => {
    const claimed = batch({
      status: "finalizing",
      terminal_shards: 1,
      succeeded_shards: 1,
      finalization_claim_token: "claim-1",
    });
    const completed = batch({
      status: "succeeded",
      terminal_shards: 1,
      succeeded_shards: 1,
      imported_count: 6,
      job_ceo_run_id: "ceo-1",
    });
    mocks.claimBatchFinalization.mockResolvedValueOnce(claimed).mockResolvedValueOnce(null);
    mocks.importApprovedBatch.mockResolvedValue({
      jobCeoRunId: "ceo-1",
      imported: 6,
      duplicates: 2,
      batchClaimAccepted: true,
    });
    mocks.completeBatchFinalization.mockResolvedValue(completed);
    mocks.getBatchById.mockResolvedValue(completed);

    await expect(finalizeReadyBatch("batch-1")).resolves.toBe(completed);
    await expect(finalizeReadyBatch("batch-1")).resolves.toBe(completed);

    expect(mocks.importApprovedBatch).toHaveBeenCalledTimes(1);
    expect(mocks.importApprovedBatch).toHaveBeenCalledWith("batch-1", "claim-1");
    expect(mocks.completeBatchFinalization).toHaveBeenCalledTimes(1);
    expect(mocks.completeBatchFinalization).toHaveBeenCalledWith(expect.objectContaining({
      importedCount: 6,
      jobCeoRunId: "ceo-1",
    }));
  });

  test("zero eligible jobs complete successfully without attaching a Job CEO run", async () => {
    const claimed = batch({
      status: "finalizing",
      terminal_shards: 1,
      succeeded_shards: 1,
      finalization_claim_token: "claim-zero",
    });
    mocks.claimBatchFinalization.mockResolvedValue(claimed);
    mocks.importApprovedBatch.mockResolvedValue({
      jobCeoRunId: null,
      imported: 0,
      duplicates: 0,
      batchClaimAccepted: true,
    });
    mocks.completeBatchFinalization.mockResolvedValue(batch({ status: "succeeded" }));

    await finalizeReadyBatch("batch-1");

    expect(mocks.completeBatchFinalization).toHaveBeenCalledWith({
      batchId: "batch-1",
      claimToken: "claim-zero",
      status: "succeeded",
      importedCount: 0,
      jobCeoRunId: null,
    });
  });

  test("an all-failed barrier terminates the batch and never invokes import", async () => {
    const claimed = batch({
      status: "finalizing",
      terminal_shards: 1,
      failed_shards: 1,
      succeeded_shards: 0,
      finalization_claim_token: "claim-failed",
    });
    const failed = batch({ status: "failed", terminal_shards: 1, failed_shards: 1 });
    mocks.claimBatchFinalization.mockResolvedValue(claimed);
    mocks.transitionBatchStatus.mockResolvedValue(failed);

    expect(await finalizeReadyBatch("batch-1")).toBe(failed);
    expect(mocks.transitionBatchStatus).toHaveBeenCalledWith("batch-1", ["finalizing"], "failed");
    expect(mocks.importApprovedBatch).not.toHaveBeenCalled();
    expect(mocks.completeBatchFinalization).not.toHaveBeenCalled();
  });
});

describe("recovery reconciliation and retry contract", () => {
  test("reconciles terminal attempt rows back into their logical shards", async () => {
    const succeeded = terminalRun("succeeded", "success");
    const failed = terminalRun("failed", "failure");
    mocks.listDivergedTerminalBatchRuns.mockResolvedValue([succeeded, failed]);
    mocks.transitionShardStatus.mockResolvedValue(shard({ status: "succeeded" }));
    mocks.scheduleShardRetry.mockResolvedValue(shard({ status: "retry_wait", attempt_count: 1 }));
    mocks.claimBatchFinalization.mockResolvedValue(null);
    mocks.getBatchById.mockResolvedValue(batch());

    await advanceActiveNightlyBatches();

    expect(mocks.transitionShardStatus).toHaveBeenCalledWith(
      "shard-success",
      ["processing", "running"],
      "succeeded",
      expect.objectContaining({
        lastRunId: "success",
        rawCount: 10,
        acceptedCount: 8,
        dateExcludedCount: 2,
        duplicateCount: 1,
        classifiedCount: 7,
      }),
    );
    expect(mocks.scheduleShardRetry).toHaveBeenCalledWith({
      shardId: "shard-failure",
      runId: "failure",
      error: "actor failed",
      fromStatuses: ["launching", "running", "processing"],
    });
    expect(mocks.expireStaleTokenReservations).toHaveBeenCalledOnce();
    expect(mocks.recoverStaleShardLaunches).toHaveBeenCalledOnce();
  });

  test("repository contract is initial attempt plus 5/15/30 minute retries, capped at four attempts", () => {
    const source = readFileSync(
      join(process.cwd(), "src/server/repositories/jobAgentBatchRepository.ts"),
      "utf8",
    ).replace(/\s+/g, " ");

    expect(source).toContain("attempt_count < max_attempts THEN 'retry_wait' ELSE 'failed'");
    expect(source).toContain("attempt_count = 1 THEN NOW() + INTERVAL '5 minutes'");
    expect(source).toContain("attempt_count = 2 THEN NOW() + INTERVAL '15 minutes'");
    expect(source).toContain("ELSE NOW() + INTERVAL '30 minutes'");
    expect(source).toContain("completed_at = CASE WHEN attempt_count >= max_attempts THEN NOW()");
  });
});
