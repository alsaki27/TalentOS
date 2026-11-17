import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/bulk/route";
import { RESUME_RELEASE_REQUIRED_MESSAGE } from "@/server/services/resumeEvidenceReleaseService";

const mocks = vi.hoisted(() => ({
  getCurrentUserContext: vi.fn(),
  findApplicationById: vi.fn(),
  updateApplication: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  ASSIGNMENT_MANAGER_ROLES: ["admin", "manager"],
  getCurrentUserContext: mocks.getCurrentUserContext,
  hasRole: (profile: { role: string }, roles: string[]) => roles.includes(profile.role),
}));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/repositories/applicationsRepository", () => ({
  deleteApplication: vi.fn(),
  findApplicationById: mocks.findApplicationById,
  updateApplication: mocks.updateApplication,
}));
vi.mock("@/server/services/resumeSharePointArchiveService", () => ({ archiveResumeToSharePoint: vi.fn() }));
vi.mock("@/server/services/studioResumePdf", () => ({ getStudioApprovalPdf: vi.fn(), StudioResumeLayoutError: Error }));

const operator = { user_id: "staff-id", display_name: "Queue Reviewer", email: "staff@example.test", role: "manager" };
const readyApplication = {
  status: "in_progress",
  ae_stage: "ready_for_application",
  application_stage: "ready_for_application",
  review_status: "approved",
  applied_at: null,
  ae_applied_at: null,
  completed_at: null,
};

function request(updateData: object, ids = ["application-id"]) {
  return new NextRequest("https://talentos.test/api/bulk", {
    method: "POST",
    body: JSON.stringify({ action: "PATCH", table: "applications", ids, updateData }),
  });
}

function releaseGateError() {
  return Object.assign(new Error("Approve and validate the current resume PDF before moving this application forward"), { code: "23514" });
}

describe("Application Queue bulk actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getCurrentUserContext.mockResolvedValue({ profile: operator });
    mocks.findApplicationById.mockResolvedValue(readyApplication);
  });

  it.each([
    { status: "in_progress" },
    { application_stage: "in_progress", completed_at: null },
  ])("starts a ticket without replacing its hand-off stage (%j)", async input => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    const [id, updates] = mocks.updateApplication.mock.calls[0];
    expect(id).toBe("application-id");
    expect(updates).toMatchObject({ status: "in_progress", next_action: "Finish application submission." });
    expect(updates).not.toHaveProperty("application_stage");
    expect(updates).not.toHaveProperty("ae_stage");
  });

  it.each([
    { ae_stage: "applied" },
    { application_stage: "applied", ae_stage: "applied", completed_at: "2026-01-01T00:00:00.000Z" },
  ])("records an applied transition and its authenticated actor (%j)", async input => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: 1, failed: 0, updatedIds: ["application-id"] });
    const updates = mocks.updateApplication.mock.calls[0][1];
    expect(updates).toMatchObject({
      status: "applied",
      application_stage: "applied",
      ae_stage: "applied",
      ae_applied_by_user_id: operator.user_id,
      ae_applied_by_name: operator.display_name,
      applied_at: updates.ae_applied_at,
      completed_at: updates.applied_at,
      next_action: "Follow up with employer if there is no response.",
    });
    expect(updates.applied_at).toEqual(expect.any(String));
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO application_stage_history"), [
      "application-id", "ready_for_application", updates.ae_applied_at, operator.user_id, operator.display_name,
      "Marked applied from the queue.",
    ]);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_logs"), expect.any(Array));
  });

  it("returns a retriable conflict when every selected ticket needs resume approval", async () => {
    mocks.updateApplication.mockRejectedValueOnce(releaseGateError());
    const response = await POST(request({ ae_stage: "applied" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      updated: 0, failed: 1, error: RESUME_RELEASE_REQUIRED_MESSAGE,
      failures: [{ id: "application-id", code: "resume_release_required", error: RESUME_RELEASE_REQUIRED_MESSAGE }],
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("records the successful rows in a mixed batch and reports the rows requiring approval", async () => {
    mocks.updateApplication.mockRejectedValueOnce(releaseGateError());
    const response = await POST(request({ ae_stage: "applied" }, ["needs-approval", "valid-receipt"]));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({
      updated: 1, failed: 1, updatedIds: ["valid-receipt"],
      failures: [{ id: "needs-approval", code: "resume_release_required" }],
    });
    expect(mocks.execute.mock.calls.filter(([sql]) => sql.includes("application_stage_history")))
      .toEqual([[expect.any(String), ["valid-receipt", "ready_for_application", expect.any(String),
        operator.user_id, operator.display_name, "Marked applied from the queue."]]]);
  });

  it("keeps unrelated database constraints distinct from resume approval conflicts", async () => {
    mocks.updateApplication.mockRejectedValueOnce(Object.assign(new Error("Unrelated check violation"), { code: "23514" }));
    const response = await POST(request({ ae_stage: "applied" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Unrelated check violation", failures: [{ id: "application-id", error: "Unrelated check violation" }] });
  });

  it("rejects a conflicting legacy payload before looking up tickets", async () => {
    const response = await POST(request({ application_stage: "in_progress", ae_stage: "applied" }));
    expect(response.status).toBe(400);
    expect(mocks.findApplicationById).not.toHaveBeenCalled();
  });
});
