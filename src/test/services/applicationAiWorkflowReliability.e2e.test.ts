import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const workflows = new Map<string, any>();
  const stageRuns = new Map<string, any[]>();
  const artifacts = new Map<string, any[]>();
  let artifactNumber = 0;
  let stageNumber = 0;

  const reset = () => {
    workflows.clear();
    stageRuns.clear();
    artifacts.clear();
    artifactNumber = 0;
    stageNumber = 0;
  };

  const findWorkflowById = vi.fn(async (id: string) => workflows.get(id) ?? null);
  const claimWorkflowById = vi.fn(async (id: string) => {
    const workflow = workflows.get(id);
    if (!workflow || workflow.status !== "queued") return null;
    workflow.status = "running";
    workflow.claimed_by = "dispatcher";
    workflow.lock_version += 1;
    return { ...workflow };
  });
  const updateWorkflowStatus = vi.fn(async (id: string, status: string, extra?: Record<string, unknown>) => {
    const workflow = workflows.get(id);
    if (!workflow) return false;
    if (typeof extra?.expected_lock_version === "number" && extra.expected_lock_version !== workflow.lock_version) {
      throw new Error("Workflow claim lost while updating test fixture");
    }
    workflow.status = status;
    if (extra?.current_stage !== undefined) workflow.current_stage = extra.current_stage;
    if (extra?.stage_retry_count !== undefined) workflow.stage_retry_count = extra.stage_retry_count;
    if (status !== "running") workflow.claimed_by = null;
    return true;
  });
  const createStageRun = vi.fn(async (input: any) => {
    const row = {
      id: `stage-${++stageNumber}`,
      workflow_id: input.workflowId,
      automation_id: input.automationId,
      sequence_number: input.sequenceNumber,
      attempt_number: input.attemptNumber ?? 1,
      status: "pending",
    };
    const rows = stageRuns.get(input.workflowId) ?? [];
    rows.push(row);
    stageRuns.set(input.workflowId, rows);
    return row;
  });
  const updateStageRun = vi.fn(async (id: string, updates: any) => {
    for (const rows of stageRuns.values()) {
      const row = rows.find((candidate) => candidate.id === id);
      if (row) Object.assign(row, updates);
    }
    return true;
  });
  const createArtifact = vi.fn(async (input: any) => {
    const row = {
      id: `artifact-${++artifactNumber}`,
      workflow_id: input.workflowId,
      automation_id: input.automationId,
      sequence_number: input.sequenceNumber,
      schema_version: input.schemaVersion,
      content_hash: input.contentHash,
      data: input.data,
      created_at: new Date().toISOString(),
    };
    const rows = artifacts.get(input.workflowId) ?? [];
    rows.push(row);
    artifacts.set(input.workflowId, rows);
    return row;
  });

  return {
    workflows,
    stageRuns,
    artifacts,
    reset,
    findWorkflowById,
    claimWorkflowById,
    updateWorkflowStatus,
    createStageRun,
    updateStageRun,
    createArtifact,
    listStageRuns: vi.fn(async (id: string) => stageRuns.get(id) ?? []),
    listArtifacts: vi.fn(async (id: string) => artifacts.get(id) ?? []),
    updateWorkflowHeartbeat: vi.fn(async () => true),
    assertWorkflowClaim: vi.fn(async () => true),
    markOrphanedStageRuns: vi.fn(async () => undefined),
  };
});

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
}));

vi.mock("@/server/repositories/applicationAiWorkflowRepository", () => ({
  ...h,
}));

vi.mock("@/server/repositories/aiRuntimeConfigRepository", () => ({
  getAiRuntimeConfig: vi.fn().mockResolvedValue({ active_routing_state_id: "state-test" }),
}));

vi.mock("@/server/repositories/aiAgentConfigRepository", () => ({
  findAgentConfigByAutomationId: vi.fn().mockResolvedValue({
    is_active: true,
    temperature: 0.2,
    max_output_tokens: 4096,
    timeout_ms: 1000,
    max_attempts: 2,
    minimum_score: 0,
  }),
}));

vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));
vi.mock("@/server/services/sourceOfTruthService", () => ({ getSourceOfTruth: vi.fn() }));
vi.mock("@/lib/ai/selectBestBaseResume", () => ({ selectBestBaseResume: vi.fn() }));
vi.mock("@/server/repositories/targetJobsRepository", () => ({ upsertTargetJobByCandidateAndJob: vi.fn() }));

vi.mock("@/lib/ai/application-agents/jobLens", () => ({
  runJobLens: vi.fn().mockResolvedValue({ requirements: [], mustHave: [], niceToHave: [] }),
}));
vi.mock("@/lib/ai/application-agents/resumeForge", () => ({
  runResumeForge: vi.fn().mockResolvedValue({ summary: "Evidence-backed summary", experience: [], education: [], skills: [] }),
}));
vi.mock("@/lib/ai/application-agents/hiringPanel", () => ({
  runHiringPanel: vi.fn().mockResolvedValue({ atsScore: 8, recruiterScore: 8, roleFitScore: 8, truthfulnessRisk: 1, passFail: "pass" }),
}));
vi.mock("@/lib/ai/application-agents/finalPolish", () => ({
  runFinalPolish: vi.fn().mockResolvedValue({ summary: "Evidence-backed summary", experience: [], education: [], skills: [], exportReady: true }),
}));
vi.mock("@/lib/ai/application-agents/finalizationService", () => ({
  finalizeWorkflow: vi.fn(async (workflowId: string) => {
    const workflow = h.workflows.get(workflowId);
    if (workflow) {
      workflow.status = "completed";
      workflow.claimed_by = null;
    }
    return `resume-${workflowId}`;
  }),
}));

vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: vi.fn(async (_automationId: string, _context: unknown, fn: (provider: any) => Promise<unknown>) => ({
    result: await fn({ send: vi.fn() }),
    providerName: "test-provider",
    aiKeyId: "test-key",
    model: "test-model",
    routeRank: 1,
  })),
}));

import { processWorkflowStage } from "@/server/services/applicationAiWorkflowService";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";

describe("application AI pipeline reliability — 10-log E2E state machine", () => {
  beforeEach(() => {
    h.reset();
    vi.clearAllMocks();
    for (let i = 1; i <= 10; i += 1) {
      const id = `historical-log-${i}`;
      h.workflows.set(id, {
        id,
        application_id: `application-${i}`,
        status: "queued",
        current_stage: 0,
        config_snapshot: {
          candidateId: `candidate-${i}`,
          job: { title: `Role ${i}` },
          baseResume: { content: { experience: [], education: [] } },
          evidence: [],
          routingStateId: "state-test",
        },
        started_by: null,
        claimed_by: null,
        lock_version: 0,
        stage_retry_count: 0,
      });
    }
  });

  it("runs ten independent logs through all four stages without duplicate claims or recursive dispatch", async () => {
    for (let i = 1; i <= 10; i += 1) {
      const id = `historical-log-${i}`;
      for (let stage = 0; stage < 4; stage += 1) {
        await processWorkflowStage(id);
      }

      const workflow = h.workflows.get(id);
      const runs = h.stageRuns.get(id) ?? [];
      const outputs = h.artifacts.get(id) ?? [];

      expect(workflow.status).toBe("completed");
      expect(runs).toHaveLength(4);
      expect(runs.map((run) => run.sequence_number)).toEqual([1, 2, 3, 4]);
      expect(runs.every((run) => run.status === "success")).toBe(true);
      expect(new Set(runs.map((run) => run.attempt_number)).size).toBe(1);
      expect(outputs.filter((artifact) => artifact.automation_id.endsWith(":input"))).toHaveLength(4);
      expect(outputs.filter((artifact) => !artifact.automation_id.endsWith(":input"))).toHaveLength(4);
    }

    expect(h.claimWorkflowById).toHaveBeenCalledTimes(40);
    expect(finalizeWorkflow).toHaveBeenCalledTimes(10);
    expect(h.updateStageRun).toHaveBeenCalled();
    expect(h.markOrphanedStageRuns).not.toHaveBeenCalled();
  });
});
