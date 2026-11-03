import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), session: vi.fn(), queryOne: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.auth, MASTER_DATA_MANAGER_ROLES: ["admin", "manager"] }));
vi.mock("@/server/security/scheduledCandidateLoggingAuth", () => ({ hasScheduledLoggingSession: mocks.session }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne }));
vi.mock("@/server/services/scheduledCandidateLoggingService", () => ({ runScheduledCandidateLogging: mocks.run }));

import { POST } from "@/app/api/admin/scheduled-job-logging/run/route";
const actorId = "11111111-1111-4111-8111-111111111111";
const request = () => new NextRequest("https://talentos.test/api/admin/scheduled-job-logging/run", { method: "POST" });

describe("Run one scheduled candidate logging batch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ response: null, context: { profile: { user_id: actorId, role: "manager" } } });
    mocks.session.mockResolvedValue(true);
    mocks.queryOne.mockResolvedValue({ is_enabled: true });
    mocks.run.mockResolvedValue({ runId: "run-fixture", status: "completed", jobsSeen: 2, queuedForReview: 1, aiCalls: 1 });
  });

  it.each([401, 403])("refuses unauthorized access (%s) before running anything", async status => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: "Access denied" }, { status }) });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("requires the feature page to be unlocked", async () => {
    mocks.session.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(423);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("reports missing migrations and refuses a disabled feature", async () => {
    mocks.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ is_enabled: false });
    expect((await POST(request())).status).toBe(503);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("dispatches one manual run with the signed-in actor and returns review counts", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { queuedForReview: 1, aiCalls: 1 } });
    expect(mocks.auth).toHaveBeenCalledWith(["admin", "manager"]);
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ triggerType: "manual", actorUserId: actorId,
      runKey: expect.stringMatching(/^scheduled-candidate-logging:manual:[a-f0-9-]+$/) });
  });

  it("returns the failure to the page instead of reporting a successful batch", async () => {
    mocks.run.mockRejectedValue(new Error("Batch storage unavailable"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Batch storage unavailable" });
  });
});
