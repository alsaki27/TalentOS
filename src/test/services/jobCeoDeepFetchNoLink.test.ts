// Regression coverage for the Adzuna recovery-queue plan's Phase 1 fix
// (2026-10-25): a staged row with no source_url and no raw.apply_url
// fallback has nothing for Deep Fetch to fetch — it must be short-circuited
// straight to stage='no_description' with a distinct, honest last_error,
// WITHOUT ever calling the agent (deepFetch.ts's own resolveFetchUrl()
// already degrades gracefully for this case, which previously produced the
// same generic "Description too short (0 chars...)" message used for a page
// that WAS fetched but came up short — conflating two recovery paths that
// need different fixes). A row that still has a usable source_url, or a
// usable raw.apply_url fallback, must be completely unaffected.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNextStagedBatch: vi.fn(),
  updateStaged: vi.fn().mockResolvedValue(undefined),
  removeDedupSignature: vi.fn().mockResolvedValue(undefined),
  bumpRunCounts: vi.fn().mockResolvedValue(undefined),
  findAgentConfigByAutomationId: vi.fn().mockResolvedValue(null),
  callWithUsageTracking: vi.fn(),
}));

vi.mock("@/server/repositories/jobCeoStagingRepository", () => ({
  claimNextStagedBatch: mocks.claimNextStagedBatch,
  updateStaged: mocks.updateStaged,
  removeDedupSignature: mocks.removeDedupSignature,
  countByStage: vi.fn(),
  insertStaged: vi.fn(),
}));

vi.mock("@/server/repositories/jobCeoRunRepository", () => ({
  bumpRunCounts: mocks.bumpRunCounts,
  createRun: vi.fn(),
  findRunById: vi.fn(),
  updateRunStatus: vi.fn(),
  findEarliestActiveRun: vi.fn(),
}));

vi.mock("@/server/repositories/aiAgentConfigRepository", () => ({
  findAgentConfigByAutomationId: mocks.findAgentConfigByAutomationId,
}));

vi.mock("@/server/repositories/jobsRepository", () => ({ createJob: vi.fn() }));
vi.mock("@/lib/companyDirectory", () => ({ syncCompanyDirectoryFromJobs: vi.fn() }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/jobDuplicateNotify", () => ({ notifyBatchDuplicateSummary: vi.fn() }));
vi.mock("@/lib/ai/routing", () => ({ callWithUsageTracking: mocks.callWithUsageTracking }));
vi.mock("@/lib/ai/job-agents/matchmaker", () => ({ runMatchmaker: vi.fn() }));
vi.mock("@/lib/ai/job-agents/queryScout", () => ({ runQueryScout: vi.fn() }));
vi.mock("@/lib/ai/job-agents/qaBouncer", () => ({ runQaBouncer: vi.fn() }));
vi.mock("@/lib/ai/job-agents/deepFetch", () => ({ runDeepFetch: vi.fn() }));
vi.mock("@/lib/ai/job-agents/ceoOrchestrator", () => ({ runCeoOrchestrator: vi.fn() }));
vi.mock("@/lib/ai/job-agents/loadCandidateSummaries", () => ({ loadCandidateSummaries: vi.fn() }));
vi.mock("@/lib/ai/job-agents/constants", () => ({
  JOB_CEO_CONFIG_DEFAULTS: {
    job_ceo_deep_fetch: { temperature: 0.3, maxOutputTokens: 2048, timeoutMs: 10000 },
  },
}));
vi.mock("@/server/repositories/agentConfigProposalRepository", () => ({
  createProposal: vi.fn(),
  supersedePendingFor: vi.fn(),
}));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));

import { processDeepFetchBatch } from "@/server/services/jobCeoService";

const baseRow = {
  id: "staged-no-link",
  title: "OSP Fiber Technician",
  company: "Example Telecom",
  location: "Austin, TX",
  description_text: null,
  external_job_id: "adzuna-1",
  dedup_signature: "id:adzuna:adzuna-1",
  raw: { source: "adzuna", apply_url: null, matched_keywords: ["fiber technician"] },
};

describe("Job CEO Deep Fetch — no fetchable URL at all", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits a row with source_url=null and no raw.apply_url straight to no_description, without calling the agent", async () => {
    mocks.claimNextStagedBatch.mockResolvedValue([{ ...baseRow, source_url: null }]);

    const result = await processDeepFetchBatch("run-1");

    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-no-link",
      expect.objectContaining({
        stage: "no_description",
        last_error: "No employer/ATS link found for this posting",
      })
    );
    // Its dedup signature is released, exactly like every other no_description
    // disposition, so a future ingestion run could re-submit the same job.
    expect(mocks.removeDedupSignature).toHaveBeenCalledWith("id:adzuna:adzuna-1");
    expect(result).toMatchObject({ processed: 1, researched: 0, skipped: 1 });
  });

  it("still calls the agent normally for a row with a real source_url (no regression)", async () => {
    mocks.claimNextStagedBatch.mockResolvedValue([
      { ...baseRow, source_url: "https://careers.exampletelecom.com/job/1" },
    ]);
    mocks.callWithUsageTracking.mockResolvedValue({
      result: { descriptionText: "x".repeat(2000), requirements: {} },
      providerName: "test",
      aiKeyId: "key-1",
      model: "test-model",
    });

    const result = await processDeepFetchBatch("run-1");

    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(1);
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-no-link",
      expect.objectContaining({ stage: "researched" })
    );
    expect(result).toMatchObject({ processed: 1, researched: 1, skipped: 0 });
  });

  it("still calls the agent when source_url is null but raw.apply_url provides a usable fallback (matches deepFetch.ts's own resolveFetchUrl)", async () => {
    mocks.claimNextStagedBatch.mockResolvedValue([
      {
        ...baseRow,
        source_url: null,
        raw: { ...baseRow.raw, apply_url: "https://careers.exampletelecom.com/job/1" },
      },
    ]);
    mocks.callWithUsageTracking.mockResolvedValue({
      result: { descriptionText: "x".repeat(2000), requirements: {} },
      providerName: "test",
      aiKeyId: "key-1",
      model: "test-model",
    });

    const result = await processDeepFetchBatch("run-1");

    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ processed: 1, researched: 1, skipped: 0 });
  });

  it("does not apply the no-link short-circuit to a non-Adzuna row that simply has a blank apply_url string (falsy-but-not-null edge case stays on the old generic path)", async () => {
    // Guards against over-matching: an empty string is still "no usable URL",
    // so this SHOULD also short-circuit — asserting it here pins that an
    // empty string is treated the same as null/absent, not as "has a URL".
    mocks.claimNextStagedBatch.mockResolvedValue([
      { ...baseRow, source_url: "", raw: { ...baseRow.raw, apply_url: "" } },
    ]);

    const result = await processDeepFetchBatch("run-1");

    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
    expect(result).toMatchObject({ processed: 1, researched: 0, skipped: 1 });
  });
});
