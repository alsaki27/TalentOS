import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/applications/[id]/route";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
  logActivity: vi.fn(),
  recordExtensionActivity: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ASSIGNMENT_MANAGER_ROLES: ["manager"],
  hasRole: () => false,
  getCurrentUserContext: async () => ({ profile: { user_id: "staff-1", display_name: "Test Staff", email: "staff@test.local", is_active: true } }),
}));
vi.mock("@/lib/applicationAutomation", () => ({ applicationAutomation: () => ({}) }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/webhookEngine", () => ({ triggerWebhooks: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ execute: mocks.execute, queryOne: vi.fn() }));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));
vi.mock("@/server/repositories/applicationsRepository", () => ({
  findApplicationById: mocks.find,
  updateApplication: mocks.update,
  deleteApplication: vi.fn(),
  ApplicationStageChangedError: class extends Error {},
}));
vi.mock("@/server/services/extensionActivityService", () => ({ recordExtensionActivity: mocks.recordExtensionActivity }));
vi.mock("@/server/services/resumeSharePointArchiveService", () => ({ archiveResumeToSharePoint: vi.fn() }));
vi.mock("@/server/services/studioResumePdf", () => ({ getStudioApprovalPdf: vi.fn(), StudioResumeLayoutError: Error }));

const aeStages = new Set(["in_ai_pipeline", "ready_for_review", "ready_for_application", "applied"]);

function patch(status: string) {
  return PATCH(new NextRequest("https://talentos.test/api/applications/custom-interview-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  }), { params: { id: "custom-interview-1" } });
}

function application(overrides: Record<string, unknown> = {}) {
  return {
    id: "custom-interview-1",
    candidate_id: "candidate-1",
    job_id: "job-1",
    source_type: "custom_interview",
    status: "interview",
    application_stage: "interview",
    ae_stage: "applied",
    applied_at: "2026-11-20T00:00:00.000Z",
    completed_at: null,
    review_status: "not_required",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue(undefined);
  mocks.logActivity.mockResolvedValue(undefined);
  mocks.recordExtensionActivity.mockResolvedValue(undefined);
  mocks.find.mockResolvedValue(application());
  mocks.update.mockImplementation(async (_id, updates) => ({ ...application(), ...updates }));
});

describe("custom interview application status transitions", () => {
  it.each([
    { fromStatus: "interview", fromStage: "interview", status: "replied", applicationStage: "screening", aeStage: "applied" },
    { fromStatus: "applied", fromStage: "applied", status: "replied", applicationStage: "screening", aeStage: "applied" },
    { fromStatus: "applied", fromStage: "applied", status: "interview", applicationStage: "interview", aeStage: "applied" },
    { fromStatus: "replied", fromStage: "screening", status: "interview", applicationStage: "interview", aeStage: "applied" },
    { fromStatus: "interview", fromStage: "interview", status: "offer", applicationStage: "offer", aeStage: "applied" },
    { fromStatus: "offer", fromStage: "offer", status: "rejected", applicationStage: "rejected", aeStage: "applied" },
    { fromStatus: "interview", fromStage: "interview", status: "withdrawn", applicationStage: "withdrawn", aeStage: "applied" },
    { fromStatus: "interview", fromStage: "interview", status: "applied", applicationStage: "applied", aeStage: "applied" },
  ])("moves $fromStatus → $status without writing a lifecycle value into ae_stage", async (transition) => {
    const current = application({ status: transition.fromStatus, application_stage: transition.fromStage });
    mocks.find.mockResolvedValueOnce(current);
    mocks.update.mockImplementationOnce(async (_id, updates) => ({ ...current, ...updates }));

    const response = await patch(transition.status);
    expect(response.status).toBe(200);

    const updates = mocks.update.mock.calls[0][1];
    expect(updates.status).toBe(transition.status);
    expect(updates.application_stage).toBe(transition.applicationStage);
    expect(aeStages.has(String(updates.ae_stage ?? current.ae_stage))).toBe(true);
    expect(String(updates.ae_stage ?? current.ae_stage)).toBe(transition.aeStage);

    if (transition.fromStage !== transition.applicationStage) {
      expect(mocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO application_stage_history"),
        ["custom-interview-1", transition.fromStage, transition.applicationStage, "staff-1", "Test Staff", expect.any(String), "manual"],
      );
    }
  });

  it.each(["assigned", "stacked", "in_progress"]) (
    "maps the legacy %s status to the allowed AE review stage",
    async (status) => {
      const response = await patch(status);
      expect(response.status).toBe(200);
      const updates = mocks.update.mock.calls[0][1];
      expect(updates).toMatchObject({
        status,
        application_stage: "ready_for_review",
        ae_stage: "ready_for_review",
      });
      expect(aeStages.has(String(updates.ae_stage))).toBe(true);
    },
  );

  it("does not record an AE-applied activity when a custom lifecycle status uses the applied AE marker", async () => {
    const current = application({ status: "interview", application_stage: "interview", ae_stage: "ready_for_review" });
    mocks.find.mockResolvedValueOnce(current);
    mocks.update.mockImplementationOnce(async (_id, updates) => ({ ...current, ...updates }));

    const response = await patch("offer");
    expect(response.status).toBe(200);
    expect(mocks.recordExtensionActivity).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][1]).toMatchObject({ application_stage: "offer", ae_stage: "applied" });
  });
});
