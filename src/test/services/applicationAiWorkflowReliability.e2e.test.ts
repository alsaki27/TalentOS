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
  const commitStageResult = vi.fn(async (input: any) => {
    const rows = await Promise.all([input.output, ...(input.analysis ? [input.analysis] : [])].map(entry =>
      createArtifact({ ...entry, contentHash: entry.digest, sequenceNumber: input.sequence, workflowId: input.workflowId }),
    ));
    await updateStageRun(input.stageRunId, { status: "success", output_artifact_id: rows[0].id });
    return rows;
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
    commitStageResult,
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

vi.mock("@/server/repositories/aiRuntimeConfigRepository", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/server/repositories/aiRuntimeConfigRepository")>(),
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

// runResumeForge now also does the job-analysis work formerly split out as
// its own "Job Lens" stage (see resumeForge.ts's analyzeJob()), returning
// both pieces together - processWorkflowStage destructures this into two
// separate artifacts (application_job_lens, application_resume_forge)
// under the same stage.
vi.mock("@/lib/ai/application-agents/resumeForge", () => ({
  runResumeForge: vi.fn().mockResolvedValue({
    jobAnalysis: { requirements: [], mustHave: [], niceToHave: [] },
    draft: { summary: "Evidence-backed summary", experience: [], education: [], skills: [] },
  }),
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

vi.mock("@/server/repositories/resumeModelCheckpointRepository", () => ({
  withResumeModelCheckpoint: vi.fn(async (_input: unknown, run: () => Promise<unknown>) => ({ result: await run(), reused: false })),
  ResumeModelCheckpointError: class extends Error {},
}));

vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: vi.fn(async (automationId: string, _context: unknown, fn: (provider: any) => Promise<unknown>) => ({
    result: await fn({ send: async () => ({
      stopReason: "end_turn", content: [{ type: "text", text: JSON.stringify(
        automationId === "application_hiring_panel_evidence_v2"
          ? { atsScore: 8, recruiterScore: 8, roleFitScore: 8, risk: "clear", issues: [] }
          : { prioritize: ["s1"] },
      ) }],
    }) }),
    providerName: "test-provider",
    aiKeyId: "test-key",
    model: "test-model",
    routeRank: 1,
  })),
}));

import { processWorkflowStage } from "@/server/services/applicationAiWorkflowService";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import { callWithUsageTracking } from "@/lib/ai/routing";

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

  it("runs ten independent logs through all three stages without duplicate claims or recursive dispatch", async () => {
    for (let i = 1; i <= 10; i += 1) {
      const id = `historical-log-${i}`;
      for (let stage = 0; stage < 3; stage += 1) {
        await processWorkflowStage(id);
      }

      const workflow = h.workflows.get(id);
      const runs = h.stageRuns.get(id) ?? [];
      const outputs = h.artifacts.get(id) ?? [];

      expect(workflow.status).toBe("completed");
      // 3 stage_runs (one per pipeline stage - resume_forge, hiring_panel,
      // final_polish), even though resume_forge's stage_run produces two
      // output artifacts (application_job_lens + application_resume_forge -
      // see processWorkflowStage's split-artifact write).
      expect(runs).toHaveLength(3);
      expect(runs.map((run) => run.sequence_number)).toEqual([1, 2, 3]);
      expect(runs.every((run) => run.status === "success")).toBe(true);
      expect(new Set(runs.map((run) => run.attempt_number)).size).toBe(1);
      expect(outputs.filter((artifact) => artifact.automation_id.endsWith(":input"))).toHaveLength(3);
      // 4 non-input artifacts: job_lens + resume_forge (both from the
      // resume_forge stage) + hiring_panel + final_polish.
      expect(outputs.filter((artifact) => !artifact.automation_id.endsWith(":input"))).toHaveLength(4);
    }

    expect(h.claimWorkflowById).toHaveBeenCalledTimes(30);
    expect(finalizeWorkflow).toHaveBeenCalledTimes(10);
    expect(h.updateStageRun).toHaveBeenCalled();
    expect(h.markOrphanedStageRuns).not.toHaveBeenCalled();
  });

  it("runs the five-stage version with one Luna draft and skips clean downstream edits", async () => {
    const id = "historical-log-1";
    const workflow = h.workflows.get(id);
    const forge = "application_resume_forge_evidence_v2";
    const panel = "application_hiring_panel_evidence_v2";
    const config = { is_active: true, max_output_tokens: 800, timeout_ms: 1000, max_attempts: 1 };
    Object.assign(workflow.config_snapshot, {
      pipelineVariant: "resume_evidence_v2",
      evidenceConfigs: Object.fromEntries([
        forge, panel, "application_final_polish_evidence_v2", "application_opportunity_reviewer", "application_release_editor",
      ].map(key => [key, config])),
      evidenceRoutes: {
        [forge]: {provider: "openai", model: "gpt-6-luna"},
        [panel]: {provider: "anthropic", model: "claude-haiku-5-5"},
      },
      verifiedSkills: ["Kubernetes"], forgeInputChars: 6000, resumeMaxPages: 2,
      job: { title: "Engineer", description: "Required qualifications\nMust know Kubernetes." },
      baseResume: { content: { header: {fullName:"Example Person"}, experience: [], education: [], skills: ["Linux"] } },
    });
    for (let index = 0; index < 5; index++) await processWorkflowStage(id);
    expect(workflow.status).toBe("completed");
    expect(h.stageRuns.get(id)?.map(run => run.status)).toEqual(Array(5).fill("success"));
    expect(vi.mocked(callWithUsageTracking).mock.calls.map(call => call[0])).toEqual([forge, panel]);
    const release = h.artifacts.get(id)?.find(row => row.automation_id === "application_release_editor");
    expect(release?.data.exportReady).toBe(true);
    expect(release?.data.documentValidation.pdfHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
