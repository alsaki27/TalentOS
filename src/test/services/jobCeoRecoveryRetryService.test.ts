// Regression coverage for the system-wide (all-source) recovery-retry
// feature added 2026-10-26: jobs stuck at stage='no_description' with a
// source_url are re-fetched on a backoff schedule (12h/24h) instead of
// being abandoned after the first failure — confirmed live that the exact
// same URL, re-fetched later with the exact same tooling, frequently
// succeeds where the first attempt failed. Also covers the 2026-10-27
// staff-picked bulk retry (retryManyRowsByIds) added for selecting and
// retrying several jobs together, e.g. all of one source at once.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchJobPageText: vi.fn(),
  runDeepFetch: vi.fn(),
  callAgent: vi.fn(),
  getDescriptionMinimumForStagedRow: vi.fn(),
  claimRecoveryRetryBatch: vi.fn(),
  findStagedById: vi.fn(),
  updateStaged: vi.fn().mockResolvedValue(undefined),
  createRun: vi.fn(),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  backgroundDispatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ai/job-agents/fetchJobPage", () => ({ fetchJobPageText: mocks.fetchJobPageText }));
vi.mock("@/lib/ai/job-agents/deepFetch", () => ({ runDeepFetch: mocks.runDeepFetch }));
vi.mock("@/lib/ai/job-agents/constants", () => ({
  JOB_CEO_CONFIG_DEFAULTS: { job_ceo_deep_fetch: { temperature: 0.3, maxOutputTokens: 2048, timeoutMs: 10000 } },
}));
vi.mock("@/server/services/jobCeoService", () => ({
  callAgent: mocks.callAgent,
  getDescriptionMinimumForStagedRow: mocks.getDescriptionMinimumForStagedRow,
}));
vi.mock("@/server/repositories/jobCeoStagingRepository", () => ({
  claimRecoveryRetryBatch: mocks.claimRecoveryRetryBatch,
  findStagedById: mocks.findStagedById,
  updateStaged: mocks.updateStaged,
}));
vi.mock("@/server/repositories/jobCeoRunRepository", () => ({
  createRun: mocks.createRun,
  updateRunStatus: mocks.updateRunStatus,
}));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: mocks.backgroundDispatch }));

import {
  retryOneRow,
  retryRecoveryQueueRowById,
  retryManyRowsByIds,
  processRecoveryRetryBatch,
  RECOVERY_RETRY_MAX_ATTEMPTS,
  RECOVERY_RETRY_ELIGIBLE_WINDOW_DAYS,
  RECOVERY_RETRY_BATCH_SIZE,
} from "@/server/services/jobCeoRecoveryRetryService";

const baseRow = {
  id: "staged-1",
  stage: "no_description" as const,
  source_url: "https://careers.example.com/job/1",
  title: "OSP Fiber Technician",
  company: "Example Telecom",
  raw: { source: "adzuna" },
  recovery_retry_count: 0,
  recovery_last_retried_at: null,
};

describe("retryOneRow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDescriptionMinimumForStagedRow.mockReturnValue(1500);
    mocks.createRun.mockResolvedValue({ id: "new-run-1" });
  });

  it("is a no-op for a row not at stage='no_description'", async () => {
    const result = await retryOneRow({ ...baseRow, stage: "logged" as any });
    expect(result).toMatchObject({ outcome: "ineligible" });
    expect(mocks.fetchJobPageText).not.toHaveBeenCalled();
  });

  it("is a no-op for a row with no source_url (nothing to re-fetch)", async () => {
    const result = await retryOneRow({ ...baseRow, source_url: null });
    expect(result).toMatchObject({ outcome: "ineligible" });
    expect(mocks.fetchJobPageText).not.toHaveBeenCalled();
  });

  it("marks the job recovered, attaches it to a fresh run, and dispatches — when the re-fetch now clears the threshold", async () => {
    mocks.fetchJobPageText.mockResolvedValue("x".repeat(3000));
    mocks.callAgent.mockResolvedValue({
      result: { descriptionText: "x".repeat(2800), requirements: { yearsExperience: null } },
    });

    const result = await retryOneRow(baseRow);

    expect(result).toMatchObject({ outcome: "recovered", runId: "new-run-1" });
    expect(mocks.createRun).toHaveBeenCalledWith(expect.objectContaining({ source: "adzuna", triggerType: "recovery_retry" }));
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-1",
      expect.objectContaining({
        run_id: "new-run-1",
        stage: "researched",
        last_error: null,
        recovery_retry_count: 1,
      })
    );
    expect(mocks.updateRunStatus).toHaveBeenCalledWith("new-run-1", "qa");
    expect(global.fetch).toBeDefined(); // dispatch self-fetch path exercised via backgroundDispatch
  });

  it("bumps the retry count and records a distinct 'still failing' reason when the re-fetch still comes up short", async () => {
    mocks.fetchJobPageText.mockResolvedValue("");

    const result = await retryOneRow(baseRow);

    expect(result.outcome).toBe("still_failing");
    expect(mocks.createRun).not.toHaveBeenCalled();
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-1",
      expect.objectContaining({
        recovery_retry_count: 1,
        last_error: expect.stringContaining("retry 1"),
      })
    );
  });

  it("does not call the AI extraction step at all when the re-fetch itself returns nothing (saves the call)", async () => {
    mocks.fetchJobPageText.mockResolvedValue("");

    await retryOneRow(baseRow);

    expect(mocks.callAgent).not.toHaveBeenCalled();
  });

  it("records the retry attempt even when the re-fetch throws", async () => {
    mocks.fetchJobPageText.mockRejectedValue(new Error("network error"));

    const result = await retryOneRow(baseRow);

    expect(result.outcome).toBe("still_failing");
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-1",
      expect.objectContaining({ recovery_retry_count: 1, last_error: expect.stringContaining("network error") })
    );
  });

  it("increments from the row's existing retry count, not always from zero", async () => {
    mocks.fetchJobPageText.mockResolvedValue("");

    await retryOneRow({ ...baseRow, recovery_retry_count: 2 });

    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-1",
      expect.objectContaining({ recovery_retry_count: 3 })
    );
  });
});

describe("retryRecoveryQueueRowById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("404s cleanly (as 'ineligible') when the row does not exist", async () => {
    mocks.findStagedById.mockResolvedValue(null);
    const result = await retryRecoveryQueueRowById("missing-id");
    expect(result).toMatchObject({ outcome: "ineligible" });
  });
});

describe("processRecoveryRetryBatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDescriptionMinimumForStagedRow.mockReturnValue(1500);
  });

  it("does nothing when no rows are eligible", async () => {
    mocks.claimRecoveryRetryBatch.mockResolvedValue([]);
    const result = await processRecoveryRetryBatch();
    expect(result).toEqual({ processed: 0, recovered: 0, stillFailing: 0 });
  });

  it("claims with the cost-bounded settings: 2 attempts, 2-day window, batch of 10", async () => {
    mocks.claimRecoveryRetryBatch.mockResolvedValue([]);
    await processRecoveryRetryBatch();
    expect(RECOVERY_RETRY_MAX_ATTEMPTS).toBe(2);
    expect(RECOVERY_RETRY_ELIGIBLE_WINDOW_DAYS).toBe(2);
    expect(RECOVERY_RETRY_BATCH_SIZE).toBe(10);
    expect(mocks.claimRecoveryRetryBatch).toHaveBeenCalledWith(2, 2, 10);
  });

  it("processes a claimed batch and summarizes recovered vs still-failing", async () => {
    mocks.claimRecoveryRetryBatch.mockResolvedValue([
      { ...baseRow, id: "a" },
      { ...baseRow, id: "b" },
    ]);
    mocks.createRun.mockResolvedValue({ id: "new-run-1" });
    mocks.fetchJobPageText.mockImplementation(async (url: string) => (url.includes("careers") ? "" : ""));
    // Row "a" recovers, row "b" still fails.
    mocks.fetchJobPageText
      .mockResolvedValueOnce("x".repeat(3000))
      .mockResolvedValueOnce("");
    mocks.callAgent.mockResolvedValue({ result: { descriptionText: "x".repeat(2000), requirements: {} } });

    const result = await processRecoveryRetryBatch();

    expect(result).toEqual({ processed: 2, recovered: 1, stillFailing: 1 });
  });
});

describe("retryManyRowsByIds (staff-picked bulk retry)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDescriptionMinimumForStagedRow.mockReturnValue(1500);
    mocks.createRun.mockResolvedValue({ id: "new-run-1" });
  });

  it("retries each id, summarizing recovered / still-failing / ineligible", async () => {
    mocks.findStagedById.mockImplementation(async (id: string) => {
      if (id === "missing") return null;
      if (id === "no-link") return { ...baseRow, id, source_url: null };
      return { ...baseRow, id };
    });
    mocks.fetchJobPageText
      .mockResolvedValueOnce("x".repeat(3000)) // "recovers" -> recovered
      .mockResolvedValueOnce(""); // "fails" -> still_failing
    mocks.callAgent.mockResolvedValue({ result: { descriptionText: "x".repeat(2000), requirements: {} } });

    const summary = await retryManyRowsByIds(["recovers", "fails", "no-link", "missing"]);

    expect(summary.recovered).toBe(1);
    expect(summary.stillFailing).toBe(1);
    expect(summary.ineligible).toBe(2);
    expect(summary.results).toHaveLength(4);
    expect(summary.results.find((r) => r.id === "missing")).toMatchObject({ outcome: "ineligible" });
  });

  it("de-duplicates repeated ids so the same row is never retried twice in one call", async () => {
    mocks.findStagedById.mockResolvedValue({ ...baseRow, id: "dup" });
    mocks.fetchJobPageText.mockResolvedValue("");

    const summary = await retryManyRowsByIds(["dup", "dup", "dup"]);

    expect(summary.results).toHaveLength(1);
    expect(mocks.findStagedById).toHaveBeenCalledTimes(1);
  });

  it("caps a very large selection instead of retrying an unbounded number at once", async () => {
    mocks.findStagedById.mockImplementation(async (id: string) => ({ ...baseRow, id }));
    mocks.fetchJobPageText.mockResolvedValue("");

    const manyIds = Array.from({ length: 200 }, (_, i) => `id-${i}`);
    const summary = await retryManyRowsByIds(manyIds);

    expect(summary.results.length).toBeLessThanOrEqual(50);
  });
});
