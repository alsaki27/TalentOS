// Pure coverage of emailStageTarget/shouldAcceptEmailStage - testable only
// because Chunk B moved them out of gmailSyncService.ts, which can't be
// imported in a test without pulling in the Gmail API and the AI provider -
// plus write-ordering coverage for changeApplicationStatus itself: the
// concurrent_update guard, and that no audit rows are written on any skip
// path (not_found / same_status / guard_rejected / concurrent_update).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/lib/activity", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import {
  changeApplicationStatus,
  emailStageTarget,
  shouldAcceptEmailStage,
} from "@/server/services/applicationStatusService";

describe("emailStageTarget", () => {
  it("maps each triage category to its stage target", () => {
    expect(emailStageTarget("application_confirmation")).toBe("applied");
    expect(emailStageTarget("interview_invite")).toBe("interview");
    expect(emailStageTarget("scheduling")).toBe("interview");
    expect(emailStageTarget("offer")).toBe("offer");
    expect(emailStageTarget("rejection")).toBe("rejected");
  });
  it("returns null for categories with no stage signal", () => {
    expect(emailStageTarget("recruiter_reply")).toBeNull();
    expect(emailStageTarget("application_invite")).toBeNull();
    expect(emailStageTarget("other")).toBeNull();
  });
});

describe("shouldAcceptEmailStage — never-downgrade rules", () => {
  it("rejects a no-op (current already equals target)", () => {
    expect(shouldAcceptEmailStage("interview", "interview")).toBe(false);
  });
  it("withdrawn is always terminal", () => {
    expect(shouldAcceptEmailStage("withdrawn", "interview")).toBe(false);
    expect(shouldAcceptEmailStage("withdrawn", "offer")).toBe(false);
  });
  it("offer never regresses to a non-offer target", () => {
    expect(shouldAcceptEmailStage("offer", "interview")).toBe(false);
    expect(shouldAcceptEmailStage("offer", "applied")).toBe(false);
  });
  it("rejected never regresses to a non-rejected target", () => {
    expect(shouldAcceptEmailStage("rejected", "interview")).toBe(false);
    expect(shouldAcceptEmailStage("rejected", "applied")).toBe(false);
  });
  it("rejection is accepted from anything except offer", () => {
    expect(shouldAcceptEmailStage("interview", "rejected")).toBe(true);
    expect(shouldAcceptEmailStage("applied", "rejected")).toBe(true);
    expect(shouldAcceptEmailStage("offer", "rejected")).toBe(false);
  });
  it("interview is accepted unless already offer/rejected/withdrawn", () => {
    expect(shouldAcceptEmailStage("applied", "interview")).toBe(true);
    expect(shouldAcceptEmailStage("assigned", "interview")).toBe(true);
    expect(shouldAcceptEmailStage("offer", "interview")).toBe(false);
  });
  it("applied is only accepted from pre-pipeline statuses", () => {
    expect(shouldAcceptEmailStage("assigned", "applied")).toBe(true);
    expect(shouldAcceptEmailStage("stacked", "applied")).toBe(true);
    expect(shouldAcceptEmailStage("interview", "applied")).toBe(false);
    expect(shouldAcceptEmailStage("offer", "applied")).toBe(false);
  });
});

describe("changeApplicationStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes all four audit trails in order and returns changed:true", async () => {
    (queryOne as any).mockResolvedValueOnce({
      status: "assigned", ae_stage: "in_ai_pipeline", application_stage: "in_ai_pipeline",
      applied_at: null, candidate_id: "cand-1",
    });
    (execute as any).mockResolvedValue({ rowCount: 1 });

    const result = await changeApplicationStatus({
      applicationId: "app-1", toStatus: "interview",
      actorType: "ai", actorName: "Email Triage (AI)", source: "email_ai",
      reason: "Interview invite detected", emailCommunicationId: "email-1", confidence: 0.9,
    });

    expect(result).toEqual({ changed: true, fromStatus: "assigned", toStatus: "interview" });

    const calls = (execute as any).mock.calls as [string, unknown[]][];
    expect(calls[0][0]).toMatch(/UPDATE applications/);
    expect(calls[0][0]).toMatch(/AND status = \$6/);
    expect(calls[0][1]).toEqual(["app-1", "interview", expect.any(String), null, "Email Triage (AI)", "assigned"]);

    expect(calls[1][0]).toMatch(/INSERT INTO application_stage_history/);
    expect(calls[1][1][7]).toBe("email_ai"); // source column

    expect(calls[2][0]).toMatch(/INSERT INTO application_events/);
    expect(calls[2][1]).toEqual(["app-1", "assigned", "interview", "Interview invite detected"]);

    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({
      actorName: "Email Triage (AI)", actorType: "ai", entityId: "app-1",
      metadata: { source: "email_ai", confidence: 0.9 },
    }));

    expect(calls[3][0]).toMatch(/INSERT INTO candidate_workflow_events/);
    expect(calls[3][1][0]).toBe("cand-1");
  });

  it("skips with not_found and writes no audit rows when the application doesn't exist", async () => {
    (queryOne as any).mockResolvedValueOnce(null);

    const result = await changeApplicationStatus({
      applicationId: "missing", toStatus: "interview",
      actorType: "ai", actorName: "x", source: "email_ai",
    });

    expect(result).toEqual({ changed: false, fromStatus: null, toStatus: "interview", skippedReason: "not_found" });
    expect(execute).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("skips with same_status and writes no audit rows when already at the target", async () => {
    (queryOne as any).mockResolvedValueOnce({ status: "interview", ae_stage: null, application_stage: "interview", applied_at: null, candidate_id: "cand-1" });

    const result = await changeApplicationStatus({
      applicationId: "app-1", toStatus: "interview",
      actorType: "ai", actorName: "x", source: "email_ai",
    });

    expect(result.skippedReason).toBe("same_status");
    expect(execute).not.toHaveBeenCalled();
  });

  it("skips with guard_rejected and writes no audit rows when the never-downgrade rule rejects it", async () => {
    (queryOne as any).mockResolvedValueOnce({ status: "offer", ae_stage: null, application_stage: "offer", applied_at: null, candidate_id: "cand-1" });

    const result = await changeApplicationStatus({
      applicationId: "app-1", toStatus: "interview",
      actorType: "ai", actorName: "x", source: "email_ai",
    });

    expect(result.skippedReason).toBe("guard_rejected");
    expect(execute).not.toHaveBeenCalled();
  });

  it("bypasses the guard when enforceEmailStageGuard is false", async () => {
    (queryOne as any).mockResolvedValueOnce({ status: "offer", ae_stage: null, application_stage: "offer", applied_at: null, candidate_id: "cand-1" });
    (execute as any).mockResolvedValue({ rowCount: 1 });

    const result = await changeApplicationStatus({
      applicationId: "app-1", toStatus: "interview",
      actorType: "ae", actorName: "Manual override", source: "queue",
      enforceEmailStageGuard: false,
    });

    expect(result.changed).toBe(true);
  });

  it("skips with concurrent_update and writes no audit rows when the row changed between read and write", async () => {
    (queryOne as any).mockResolvedValueOnce({ status: "assigned", ae_stage: null, application_stage: "assigned", applied_at: null, candidate_id: "cand-1" });
    (execute as any).mockResolvedValueOnce({ rowCount: 0 }); // the UPDATE's WHERE status=$expected matched nothing

    const result = await changeApplicationStatus({
      applicationId: "app-1", toStatus: "interview",
      actorType: "ai", actorName: "x", source: "email_ai",
    });

    expect(result.skippedReason).toBe("concurrent_update");
    // Only the UPDATE attempt itself - no history/events/workflow-event rows.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it("only writes candidate_workflow_events when emailCommunicationId or actionItemId is given", async () => {
    (queryOne as any).mockResolvedValueOnce({ status: "assigned", ae_stage: null, application_stage: "assigned", applied_at: null, candidate_id: "cand-1" });
    (execute as any).mockResolvedValue({ rowCount: 1 });

    await changeApplicationStatus({
      applicationId: "app-1", toStatus: "interview",
      actorType: "ae", actorName: "An AE", source: "queue",
    });

    const calls = (execute as any).mock.calls as [string, unknown[]][];
    expect(calls).toHaveLength(3); // UPDATE, stage_history, events - no workflow_events
    expect(calls.some((c) => c[0].includes("candidate_workflow_events"))).toBe(false);
  });
});
