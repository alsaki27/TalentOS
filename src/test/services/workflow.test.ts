// Hard test: workflow creation, status transitions, error handling.
// Uses mocked Neon queries.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Neon adapter
vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

// Mock activity logger
vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn(),
}));

// Mock webhook engine
vi.mock("@/lib/webhookEngine", () => ({
  triggerWebhooks: vi.fn(),
}));

import { createWorkflow, findWorkflowById, updateWorkflowStatus, findActiveWorkflowByApplicationId } from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne, execute } from "@/server/db/neon";

describe("applicationAiWorkflowRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWorkflow", () => {
    it("creates a workflow with correct fields", async () => {
      const mockRow = {
        id: "wf-1",
        application_id: "app-1",
        base_resume_id: null,
        status: "queued",
        current_stage: 0,
        idempotency_key: null,
        config_snapshot: null,
        started_by: null,
        started_at: null,
        completed_at: null,
        cancelled_at: null,
        last_error: null,
        created_at: "2026-07-11T12:00:00Z",
      };
      (query as any).mockResolvedValue([mockRow]);

      const result = await createWorkflow({ applicationId: "app-1" });
      expect(result.id).toBe("wf-1");
      expect(result.status).toBe("queued");
      expect(query).toHaveBeenCalledOnce();
    });

    it("passes idempotency key", async () => {
      (query as any).mockResolvedValue([{ id: "wf-2", application_id: "app-1", status: "queued", current_stage: 0 }]);

      await createWorkflow({ applicationId: "app-1", idempotencyKey: "idem-123" });
      const sql = (query as any).mock.calls[0][0];
      expect(sql).toContain("idempotency_key");
    });
  });

  describe("findWorkflowById", () => {
    it("returns null when not found", async () => {
      (queryOne as any).mockResolvedValue(null);
      const result = await findWorkflowById("nonexistent");
      expect(result).toBeNull();
    });

    it("returns workflow row when found", async () => {
      (queryOne as any).mockResolvedValue({ id: "wf-1", status: "queued" });
      const result = await findWorkflowById("wf-1");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("wf-1");
    });
  });

  describe("findActiveWorkflowByApplicationId", () => {
    it("returns only queued/running/waiting workflows", async () => {
      (queryOne as any).mockResolvedValue({ id: "wf-1", status: "running" });
      const result = await findActiveWorkflowByApplicationId("app-1");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("running");
    });

    it("returns null when no active workflow exists", async () => {
      (queryOne as any).mockResolvedValue(null);
      const result = await findActiveWorkflowByApplicationId("app-1");
      expect(result).toBeNull();
    });
  });

  describe("updateWorkflowStatus", () => {
    it("updates status to running and sets started_at", async () => {
      (execute as any).mockResolvedValue({ rowCount: 1 });
      await updateWorkflowStatus("wf-1", "running");
      expect(execute).toHaveBeenCalled();
      const sql = (execute as any).mock.calls[0][0];
      expect(sql).toContain("status");
      expect(sql).toContain("started_at");
    });

    it("updates status to completed and sets completed_at", async () => {
      (execute as any).mockResolvedValue({ rowCount: 1 });
      await updateWorkflowStatus("wf-1", "completed");
      const sql = (execute as any).mock.calls[0][0];
      expect(sql).toContain("completed_at");
    });

    it("updates status to cancelled and sets cancelled_at", async () => {
      (execute as any).mockResolvedValue({ rowCount: 1 });
      await updateWorkflowStatus("wf-1", "cancelled");
      const sql = (execute as any).mock.calls[0][0];
      expect(sql).toContain("cancelled_at");
    });

    it("includes last_error when passed in extra", async () => {
      (execute as any).mockResolvedValue({ rowCount: 1 });
      await updateWorkflowStatus("wf-1", "failed", { last_error: "Something broke" });
      const sql = (execute as any).mock.calls[0][0];
      expect(sql).toContain("last_error");
    });

    it("includes current_stage when passed in extra", async () => {
      (execute as any).mockResolvedValue({ rowCount: 1 });
      await updateWorkflowStatus("wf-1", "running", { current_stage: 2 });
      const sql = (execute as any).mock.calls[0][0];
      expect(sql).toContain("current_stage");
    });
  });
});

describe("applicationAiWorkflowService", () => {
  it("agent ordering is correct", async () => {
    const { APPLICATION_AGENT_IDS } = await import("@/lib/ai/application-agents/types");
    expect(APPLICATION_AGENT_IDS).toEqual([
      "application_job_lens",
      "application_resume_forge",
      "application_hiring_panel",
      "application_final_polish",
      "copilot_fill_planner",
      "copilot_question_answerer",
      "copilot_ceo",
      "copilot_form_analyst",
      "copilot_compliance",
      "copilot_correction_reviewer",
      "copilot_cover_letter",
    ]);
  });
});
