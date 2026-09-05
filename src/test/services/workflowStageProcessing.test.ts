// Regression coverage for processWorkflowStage's Hiring Panel branch.
//
// Context: the Hiring Panel stage used to hard-block the pipeline (status
// 'failed') for a genuine hard-fail-grade review (fabricated content,
// disqualifying scores). That's no longer correct: Hiring Panel is a review
// step, not a gate — whatever it finds must always reach Final Polish, which
// is the stage responsible for actually applying the fixes (stripping
// unsupported claims, trimming for length) and producing an export-ready
// resume. These tests guard against a hard-fail-before-Final-Polish path
// being reintroduced.

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
  updateStageRun: vi.fn().mockResolvedValue(true),
  createArtifact: vi.fn().mockResolvedValue({ id: "artifact-1" }),
  listStageRuns: vi.fn().mockResolvedValue([]),
  listArtifacts: vi.fn().mockResolvedValue([]),
  claimWorkflowById: vi.fn().mockResolvedValue({
    id: "wf-1",
    application_id: "app-1",
    status: "running",
    current_stage: 2,
    config_snapshot: { candidateId: "cand-1", job: {}, baseResume: {}, evidence: [], routingStateId: "state-1" },
    started_by: null,
    claimed_by: "dispatcher",
    lock_version: 1,
    stage_retry_count: 0,
  }),
  claimNextPendingWorkflow: vi.fn().mockResolvedValue(null),
  updateWorkflowHeartbeat: vi.fn().mockResolvedValue(true),
  assertWorkflowClaim: vi.fn().mockResolvedValue(true),
  closeOrphanedStageRuns: vi.fn().mockResolvedValue(0),
}));

vi.mock("@/server/repositories/aiAgentConfigRepository", () => ({
  findAgentConfigByAutomationId: vi.fn().mockResolvedValue(null),
}));

// @opennextjs/cloudflare's entry imports "server-only", which isn't
// resolvable outside a real Next.js server build - mock it out rather than
// let applicationAiWorkflowService.ts's static import of backgroundDispatch
// drag it in at module-load time.
vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: vi.fn().mockResolvedValue(undefined),
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
  createStageRun,
  listStageRuns,
  updateStageRun,
  updateWorkflowStatus,
} from "@/server/repositories/applicationAiWorkflowRepository";
import { callWithUsageTracking, AiRouteCallError } from "@/lib/ai/routing";

function hiringPanelWorkflow() {
  return {
    id: "wf-1",
    application_id: "app-1",
    status: "queued",
    current_stage: 2, // index 2 = application_hiring_panel
    config_snapshot: { candidateId: "cand-1", job: {}, baseResume: {}, evidence: [], routingStateId: "state-1" },
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
    (listStageRuns as any).mockResolvedValue([]);
    (callWithUsageTracking as any).mockResolvedValue(mockCallResult({
      atsScore: 9,
      recruiterScore: 9,
      roleFitScore: 9,
      truthfulnessRisk: 1,
      passFail: "pass",
    }));
  });

  it("hard-fail-grade score does NOT stop the pipeline — still reaches Final Polish", async () => {
    const hardFailGradeReview = {
      atsScore: 2, // would have been below the old MIN_ATS_SCORE (4) hard-fail threshold
      recruiterScore: 8,
      roleFitScore: 8,
      truthfulnessRisk: 9, // would have exceeded the old MAX_TRUTH_RISK (7) threshold
      passFail: "fail",
      requiredEdits: [{ issueId: "x", severity: "critical", description: "fabricated PE license" }],
    };
    (callWithUsageTracking as any).mockResolvedValue(
      mockCallResult(hardFailGradeReview)
    );

    await processWorkflowStage("wf-1");

    // Must NOT be marked failed — Hiring Panel's findings (however severe)
    // are Final Polish's job to fix, not a reason to stop the pipeline.
    const failedCall = (updateWorkflowStatus as any).mock.calls.find(
      (c: any[]) => c[1] === "failed"
    );
    expect(failedCall).toBeFalsy();

    // Must have advanced past Hiring Panel (queued for next stage).
    const queuedCall = (updateWorkflowStatus as any).mock.calls.find(
      (c: any[]) => c[1] === "queued"
    );
    expect(queuedCall).toBeTruthy();
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

  it("allocates a new stage-run identity after a stale attempt already exists", async () => {
    (listStageRuns as any).mockResolvedValue([{
      automation_id: "application_hiring_panel",
      sequence_number: 3,
      attempt_number: 1,
    }]);

    await processWorkflowStage("wf-1");

    expect(createStageRun).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "wf-1",
      sequenceNumber: 3,
      attemptNumber: 2,
    }));
  });

  it("advances the stage-run identity when two dispatchers race on INSERT", async () => {
    (createStageRun as any)
      .mockRejectedValueOnce({
        code: "23505",
        constraint: "application_ai_stage_runs_workflow_id_sequence_number_attem_key",
      })
      .mockResolvedValueOnce({ id: "stage-run-2" });

    await processWorkflowStage("wf-1");

    expect((createStageRun as any).mock.calls.slice(-2)).toEqual([
      [expect.objectContaining({ attemptNumber: 1 })],
      [expect.objectContaining({ attemptNumber: 2 })],
    ]);
  });

  it("persists the normalized invalid_output code for malformed provider output", async () => {
    (callWithUsageTracking as any).mockRejectedValue(new AiRouteCallError(
      "Provider returned malformed JSON",
      {
        aiKeyId: null,
        provider: "google_vertex_proxy",
        model: "gemini-2.5-flash-lite",
        routeRank: 1,
        errorCode: "invalid_output",
      },
    ));

    await processWorkflowStage("wf-1");

    const failedStageCall = (updateStageRun as any).mock.calls.find(
      (c: any[]) => c[1]?.status === "failed",
    );
    expect(failedStageCall?.[1]?.error_code).toBe("invalid_output");
  });
});
