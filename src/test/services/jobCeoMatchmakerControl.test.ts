// The Job CEO Matchmaker has two responsibilities in the legacy flow:
// candidate matching and promotion of a staged job into `jobs`.
// Disabling the agent must remove only the first responsibility.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNextStagedBatch: vi.fn(),
  updateStaged: vi.fn().mockResolvedValue(undefined),
  bumpRunCounts: vi.fn().mockResolvedValue(undefined),
  listAllJobsForFuzzyDedupe: vi.fn(),
  loadCandidateSummaries: vi.fn(),
  findAgentConfigByAutomationId: vi.fn(),
  createJob: vi.fn(),
  syncCompanyDirectoryFromJobs: vi.fn().mockResolvedValue(undefined),
  logActivity: vi.fn().mockResolvedValue(undefined),
  callWithUsageTracking: vi.fn(),
  runMatchmaker: vi.fn(),
}));

vi.mock("@/server/repositories/jobCeoStagingRepository", () => ({
  claimNextStagedBatch: mocks.claimNextStagedBatch,
  updateStaged: mocks.updateStaged,
  countByStage: vi.fn(),
  insertStaged: vi.fn(),
  removeDedupSignature: vi.fn(),
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

vi.mock("@/server/repositories/jobsRepository", () => ({
  listAllJobsForFuzzyDedupe: mocks.listAllJobsForFuzzyDedupe,
  createJob: mocks.createJob,
}));

vi.mock("@/lib/companyDirectory", () => ({
  syncCompanyDirectoryFromJobs: mocks.syncCompanyDirectoryFromJobs,
}));

vi.mock("@/lib/activity", () => ({
  logActivity: mocks.logActivity,
}));

vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: mocks.callWithUsageTracking,
}));

vi.mock("@/lib/ai/job-agents/matchmaker", () => ({
  runMatchmaker: mocks.runMatchmaker,
}));

vi.mock("@/lib/ai/job-agents/queryScout", () => ({ runQueryScout: vi.fn() }));
vi.mock("@/lib/ai/job-agents/qaBouncer", () => ({ runQaBouncer: vi.fn() }));
vi.mock("@/lib/ai/job-agents/deepFetch", () => ({ runDeepFetch: vi.fn() }));
vi.mock("@/lib/ai/job-agents/ceoOrchestrator", () => ({ runCeoOrchestrator: vi.fn() }));
vi.mock("@/lib/ai/job-agents/loadCandidateSummaries", () => ({
  loadCandidateSummaries: mocks.loadCandidateSummaries,
}));
vi.mock("@/lib/ai/job-agents/constants", () => ({
  JOB_CEO_CONFIG_DEFAULTS: {
    job_ceo_matchmaker: { temperature: 0.2 },
  },
}));
vi.mock("@/server/repositories/agentConfigProposalRepository", () => ({
  createProposal: vi.fn(),
  supersedePendingFor: vi.fn(),
}));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));

import { processMatchmakerBatch } from "@/server/services/jobCeoService";

const stagedJob = {
  id: "staged-1",
  title: "Senior GIS Analyst",
  company: "Example Maps",
  location: "Remote",
  source_url: "https://example.test/job/1",
  description_text: "A sufficiently detailed job description.",
  external_job_id: "external-1",
  raw: { source: "openjobdata" },
  requirements: { techStack: ["GIS"] },
};

const activeConfig = { is_active: true, timeout_ms: 8000 };
const disabledConfig = { is_active: false, timeout_ms: 8000 };

describe("Job CEO Matchmaker control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimNextStagedBatch.mockResolvedValue([stagedJob]);
    mocks.listAllJobsForFuzzyDedupe.mockResolvedValue([]);
    mocks.loadCandidateSummaries.mockResolvedValue([{ id: "candidate-1", name: "Candidate" }]);
    mocks.createJob.mockResolvedValue({ id: "job-1", title: stagedJob.title, company: stagedJob.company });
    mocks.callWithUsageTracking.mockResolvedValue({
      result: { matches: [{ candidateId: "candidate-1", score: 95, reasons: ["fit"], outreachDraft: "draft" }] },
      providerName: "test",
      aiKeyId: "key-1",
      model: "test-model",
    });
  });

  it("preserves candidate matching when Matchmaker is enabled", async () => {
    mocks.findAgentConfigByAutomationId.mockResolvedValue(activeConfig);

    const result = await processMatchmakerBatch("run-1");

    expect(mocks.loadCandidateSummaries).toHaveBeenCalledWith(50);
    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "job_ceo_match" }));
    expect(result).toMatchObject({ processed: 1, matched: 1, logged: 1, skipped: 0 });
  });

  it("still creates and logs the job while Matchmaker is disabled", async () => {
    mocks.findAgentConfigByAutomationId.mockResolvedValue(disabledConfig);

    const result = await processMatchmakerBatch("run-1");

    expect(mocks.loadCandidateSummaries).not.toHaveBeenCalled();
    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-1",
      expect.objectContaining({ stage: "logged", logged_job_id: "job-1", match_results: { matches: [] } })
    );
    expect(mocks.logActivity).not.toHaveBeenCalledWith(expect.objectContaining({ type: "job_ceo_match" }));
    expect(result).toMatchObject({ processed: 1, matched: 0, logged: 1, skipped: 0 });
  });

  it("does not create a duplicate job while matching is disabled", async () => {
    mocks.findAgentConfigByAutomationId.mockResolvedValue(disabledConfig);
    mocks.listAllJobsForFuzzyDedupe.mockResolvedValue([
      { title: stagedJob.title, company: stagedJob.company },
    ]);

    const result = await processMatchmakerBatch("run-1");

    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      "staged-1",
      expect.objectContaining({ stage: "logged", match_results: { matches: [], duplicate: true } })
    );
    expect(result).toMatchObject({ processed: 1, matched: 0, logged: 0, skipped: 1 });
  });

  it("keeps historical matching behavior when no Matchmaker config exists", async () => {
    mocks.findAgentConfigByAutomationId.mockResolvedValue(null);

    await processMatchmakerBatch("run-1");

    expect(mocks.loadCandidateSummaries).toHaveBeenCalledWith(50);
    expect(mocks.callWithUsageTracking).toHaveBeenCalledTimes(1);
  });

  it("fails closed for candidate assignment when the config read fails", async () => {
    mocks.findAgentConfigByAutomationId.mockRejectedValue(new Error("Neon unavailable"));

    const result = await processMatchmakerBatch("run-1");

    expect(mocks.loadCandidateSummaries).not.toHaveBeenCalled();
    expect(mocks.callWithUsageTracking).not.toHaveBeenCalled();
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ processed: 1, matched: 0, logged: 1, skipped: 0 });
  });
});
