// Regression coverage for processWorkflowStage's Hiring Panel branch.
//
// Context: the Hiring Panel stage used to hard-block the pipeline (status
// 'waiting') for ANY non-clean score, including borderline ones. That was
// changed so borderline ("review") scores flow through to Final Polish and
// only a genuine hard-fail (fabricated content, disqualifying scores) still
// stops the pipeline. A prior commit accidentally deleted the quality-gate
// call entirely, silently removing the hard-fail stop too — these tests
// guard against that regression recurring.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
}));

vi.mock("@/server/repositories/applicationAiWorkflowRepository", () => ({
  findWorkflowById: vi.fn(),
  updateWorkflowStatus: vi.fn().mockResolvedValue(undefined),
  createStageRun: vi.fn().mockResolvedValue({ id: "stage-run-1" }),
  updateStageRun: vi.fn().mockResolvedValue(undefined),
  createArtifact: vi.fn().mockResolvedValue({ id: "artifact-1" }),
  listStageRuns: vi.fn().mockResolvedValue([]),
  listArtifacts: vi.fn().mockResolvedValue([]),
  claimNextPendingWorkflow: vi.fn().mockResolvedValue(null),
  updateWorkflowHeartbeat: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/repositories/aiAgentConfigRepository", () => ({
  findAgentConfigByAutomationId: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/ai/application-agents/finalizationService", () => ({
  finalizeWorkflow: vi.fn().mockResolvedValue("resume-version-1"),
}));

vi.mock("@/lib/ai/routing", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/routing")>("@/lib/ai/routing");
  return {
    ...actual,
    callWithUsageTracking: vi.fn(),
  };
});

import { processWorkflowStage } from "@/server/services/applicationAiWorkflowService";
import {
  findWorkflowById,
  updateWorkflowStatus,
} from "@/server/repositories/applicationAiWorkflowRepository";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import { callWithUsageTracking } from "@/lib/ai/routing";

function hiringPanelWorkflow() {
  return {
    id: "wf-1",
    application_id: "app-1",
    status: "queued",
    current_stage: 2, // index 2 = application_hiring_panel
    config_snapshot: { candidateId: "cand-1", job: {}, baseResume: {}, evidence: [] },
    started_by: null,
  } as any;
}

function mockCallResult(reviewOutput: Record<string, unknown>) {
  return {
    result: reviewOutput,
    providerName: "google",
    aiKeyId: "key-1",
    model: "gemini",
    routeRank: 1,
  };
}

describe("processWorkflowStage — Hiring Panel gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (findWorkflowById as any).mockResolvedValue(hiringPanelWorkflow());
  });

  it("hard-fail score stops the pipeline (does not reach Final Polish)", async () => {
    const hardFailReview = {
      atsScore: 2, // below MIN_ATS_SCORE (4) -> action: "fail"
      recruiterScore: 8,
      roleFitScore: 8,
      truthfulnessRisk: 1,
      passFail: "fail",
    };
    (callWithUsageTracking as any).mockResolvedValue(
      mockCallResult(hardFailReview)
    );

    await processWorkflowStage("wf-1");

    // Only one provider call — Final Polish must never have been invoked.
    expect(callWithUsageTracking).toHaveBeenCalledTimes(1);
    expect(finalizeWorkflow).not.toHaveBeenCalled();

    // Workflow must be marked failed, not left queued/waiting.
    const failedCall = (updateWorkflowStatus as any).mock.calls.find(
      (c: any[]) => c[1] === "failed"
    );
    expect(failedCall).toBeTruthy();
  });

  it("borderline ('review') score does NOT stop the pipeline — continues past Hiring Panel", async () => {
    const borderlineReview = {
      atsScore: 5, // below REVIEW_ATS_THRESHOLD (6) -> action: "review", not "fail"
      recruiterScore: 6,
      roleFitScore: 6,
      truthfulnessRisk: 2,
      passFail: "pass",
    };
    (callWithUsageTracking as any).mockResolvedValue(
      mockCallResult(borderlineReview)
    );

    await processWorkflowStage("wf-1");

    // Must NOT be marked failed or left in a blocking "waiting" state.
    const failedCall = (updateWorkflowStatus as any).mock.calls.find(
      (c: any[]) => c[1] === "failed" || c[1] === "waiting"
    );
    expect(failedCall).toBeFalsy();

    // Must have advanced past Hiring Panel (queued for next stage).
    const queuedCall = (updateWorkflowStatus as any).mock.calls.find(
      (c: any[]) => c[1] === "queued"
    );
    expect(queuedCall).toBeTruthy();
  });

  it("clean auto-pass score does not stop the pipeline", async () => {
    const cleanReview = {
      atsScore: 9,
      recruiterScore: 9,
      roleFitScore: 9,
      truthfulnessRisk: 1,
      passFail: "pass",
    };
    (callWithUsageTracking as any).mockResolvedValue(
      mockCallResult(cleanReview)
    );

    await processWorkflowStage("wf-1");

    const failedCall = (updateWorkflowStatus as any).mock.calls.find(
      (c: any[]) => c[1] === "failed"
    );
    expect(failedCall).toBeFalsy();
  });
});
