import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/applications/[id]/route";

const mocks = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), execute: vi.fn(), queryOne: vi.fn(),
  archive: vi.fn(), render: vi.fn(), logActivity: vi.fn(), recordExtensionActivity: vi.fn(),
  StageChangedError: class extends Error {},
}));

vi.mock("@/lib/auth", () => ({
  ASSIGNMENT_MANAGER_ROLES: ["manager"], hasRole: () => false,
  getCurrentUserContext: async () => ({ profile: { user_id: "staff", display_name: "Test AE", is_active: true } }),
}));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/webhookEngine", () => ({ triggerWebhooks: vi.fn() }));
vi.mock("@/server/db/neon", () => ({ execute: mocks.execute, queryOne: mocks.queryOne }));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));
vi.mock("@/server/repositories/applicationsRepository", () => ({
  findApplicationById: mocks.find, updateApplication: mocks.update, deleteApplication: vi.fn(),
  ApplicationStageChangedError: mocks.StageChangedError,
}));
vi.mock("@/server/services/extensionActivityService", () => ({ recordExtensionActivity: mocks.recordExtensionActivity }));
vi.mock("@/server/services/resumeSharePointArchiveService", () => ({ archiveResumeToSharePoint: mocks.archive }));
vi.mock("@/server/services/studioResumePdf", () => ({ getStudioApprovalPdf: mocks.render, StudioResumeLayoutError: Error }));

function patch(body: Record<string, unknown>) {
  return PATCH(new NextRequest("https://talentos.test/api/applications/ticket", {
    method: "PATCH", body: JSON.stringify(body),
  }), { params: { id: "ticket" } });
}

const ready = {
  ae_stage: "ready_for_application", application_stage: "ready_for_application", status: "in_progress",
  review_status: "not_required", applied_at: null, completed_at: null, ae_applied_at: null,
};
const revision = "version:saved-content-hash";
const source = {
  version_id: "version", workflow_id: "workflow", content: { summary: "Edited content" },
  updated_at: "2026-11-17T06:00:00.000Z", finalized: true, review_required: true,
  edited: true, approval_status: "not_required", export_id: null, revision,
};
const releaseGate = () => Object.assign(new Error("Approve and validate the current resume PDF before moving this application forward"), { code: "23514" });
const confirmApplied = () => patch({ ae_stage: "applied", approve_resume: true, resume_approval_revision: revision });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue(ready);
  mocks.update.mockImplementation(async (_, updates) => ({ ...ready, ...updates }));
  mocks.render.mockResolvedValue({ bytes: new Uint8Array([1, 2]), pdfHash: "current-pdf", contentHash: "current-content", metrics: { pageCount: 1 }, timings: {} });
  mocks.archive.mockResolvedValue({ ok: true, id: "current-export" });
});

describe("AE Applied stage", () => {
  it.each([{ ae_stage: "applied" }, { application_stage: "applied" }, { status: "applied" }])(
    "synchronizes stages and audit fields with no new PDF work for %j",
    async (body) => {
      const response = await patch(body);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        status: "applied", application_stage: "applied", ae_stage: "applied",
        applied_at: expect.any(String), ae_applied_at: expect.any(String),
        ae_applied_by_name: "Test AE", application_stage_changed_by_user_id: "staff",
      });
      expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO application_stage_history"),
        ["ticket", "ready_for_application", "applied", "staff", "Test AE", null, "queue"]);
      expect(mocks.queryOne).not.toHaveBeenCalled();
      expect(mocks.archive).not.toHaveBeenCalled();
    },
  );

  it("does not reset the follow-up or re-record the transition when retried", async () => {
    const appliedAt = "2026-11-17T06:00:00.000Z";
    mocks.find.mockResolvedValue({ ...ready, ae_stage: "applied", application_stage: "applied", status: "applied", applied_at: appliedAt });
    expect((await patch({ ae_stage: "applied" })).status).toBe(200);
    const fields = mocks.update.mock.calls[0][1];
    expect(fields.applied_at).toBe(appliedAt);
    expect(fields).not.toHaveProperty("follow_up_at");
    expect(fields).not.toHaveProperty("ae_applied_by_user_id");
    expect(mocks.recordExtensionActivity).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes("application_stage_history"))).toBe(false);
  });

  it("recovers a stale PDF within AE Applied when the reviewed revision is confirmed", async () => {
    mocks.queryOne.mockResolvedValueOnce({ revision });
    mocks.update.mockRejectedValueOnce(releaseGate());
    const blocked = await patch({ ae_stage: "applied" });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ code: "resume_release_required", resume_approval_revision: revision });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();

    mocks.queryOne.mockResolvedValueOnce(source).mockResolvedValueOnce({ id: "version" });
    const approved = await confirmApplied();
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ ae_stage: "applied", resume_release: { pageCount: 1 } });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenLastCalledWith("ticket", expect.objectContaining({ ae_stage: "applied" }),
      { stage: "ready_for_application", reviewStatus: "not_required" });
    expect(mocks.archive).toHaveBeenCalledWith(expect.objectContaining({ applicationId: "ticket", resumeVersionId: "version", variantLabel: "current-pdf" }));
    const [writeSql, params] = mocks.queryOne.mock.calls[2];
    expect(writeSql).toContain("FOR UPDATE");
    expect(params.slice(-3)).toEqual([source.updated_at, "workflow", "ready_for_application"]);
    expect(JSON.parse(params[3])).toMatchObject({ exportId: "current-export", pdfHash: "current-pdf", approvedBy: "staff" });

    expect(mocks.archive).toHaveBeenCalledTimes(1);
  });

  it("still accepts standalone approval from an older queue tab without moving its stage", async () => {
    mocks.queryOne.mockResolvedValueOnce(source).mockResolvedValueOnce({ id: "version" });
    const response = await patch({ ae_stage: "ready_for_application", approve_resume: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ae_stage: "ready_for_application" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires confirmation for the exact saved version", async () => {
    expect((await patch({ ae_stage: "applied", approve_resume: true })).status).toBe(400);
    mocks.queryOne.mockResolvedValueOnce({ ...source, revision: "version:new-content-hash" });
    const stale = await confirmApplied();
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "resume_release_changed" });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reuses an approval that already saved the same PDF when a stage move is retried", async () => {
    mocks.queryOne.mockResolvedValueOnce({ ...source, export_id: "existing-export", updated_at: "2026-11-17T06:01:00.000Z" });
    const response = await confirmApplied();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ae_stage: "applied" });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("keeps review findings and SharePoint failures from marking the application applied", async () => {
    mocks.queryOne.mockResolvedValueOnce({ ...source, edited: false });
    const needsReview = await confirmApplied();
    expect(needsReview.status).toBe(409);
    expect(await needsReview.json()).toMatchObject({ error: expect.stringContaining("review findings") });
    expect(mocks.archive).not.toHaveBeenCalled();

    mocks.queryOne.mockResolvedValueOnce(source);
    mocks.archive.mockResolvedValueOnce({ ok: false, error: "Archive unavailable" });
    const uploadFailed = await confirmApplied();
    expect(uploadFailed.status).toBe(409);
    expect(await uploadFailed.json()).toMatchObject({ error: expect.stringContaining("save the validated PDF") });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns the existing Applied result if a confirmed request is retried after success", async () => {
    mocks.find.mockResolvedValue({ ...ready, ae_stage: "applied", application_stage: "applied", status: "applied", applied_at: source.updated_at });
    const response = await confirmApplied();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ae_stage: "applied", applied_at: source.updated_at });
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("reports a changed application instead of overwriting a concurrent stage or review decision", async () => {
    mocks.queryOne.mockResolvedValueOnce(source).mockResolvedValueOnce({ id: "version" });
    mocks.update.mockRejectedValueOnce(new mocks.StageChangedError("The application or its review changed."));
    const response = await confirmApplied();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "application_stage_changed" });
    expect(mocks.recordExtensionActivity).not.toHaveBeenCalled();
  });

  it("returns a conflict when the resume or ticket changes during approval", async () => {
    mocks.queryOne.mockResolvedValueOnce(source).mockResolvedValueOnce(null);
    const response = await patch({ ae_stage: "ready_for_application", approve_resume: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("changed while approving") });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("prevents reapproval from being bundled with marking the ticket applied", async () => {
    const response = await patch({ ae_stage: "ready_for_application", approve_resume: true, status: "applied" });
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("keeps the manager review gate in place for pending tickets", async () => {
    mocks.find.mockResolvedValue({ ...ready, review_status: "pending" });
    const response = await patch({ ae_stage: "applied" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("Manager review") });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("does not treat unrelated database constraints as stale résumé approval", async () => {
    mocks.update.mockRejectedValueOnce(Object.assign(new Error("Another check failed"), { code: "23514" }));
    expect((await patch({ ae_stage: "applied" })).status).toBe(500);
  });
});
