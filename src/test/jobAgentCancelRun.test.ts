import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunById: vi.fn(),
  requestRunCancellation: vi.fn(),
  transitionRunStatus: vi.fn(),
  getTokenById: vi.fn(),
  getApifyRunDetails: vi.fn(),
  abortApifyRun: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/server/repositories/jobAgentRunRepository", () => ({
  getRunById: mocks.getRunById,
  requestRunCancellation: mocks.requestRunCancellation,
  transitionRunStatus: mocks.transitionRunStatus,
}));
vi.mock("@/server/repositories/jobAgentTokenRepository", () => ({ getTokenById: mocks.getTokenById }));
vi.mock("@/server/services/jobAgentService", () => ({
  getApifyRunDetails: mocks.getApifyRunDetails,
  abortApifyRun: mocks.abortApifyRun,
}));
vi.mock("@/lib/auth", () => ({
  MASTER_DATA_MANAGER_ROLES: ["admin"],
  requireCurrentUser: mocks.requireCurrentUser,
}));

import { POST } from "@/app/api/job-agent/runs/[id]/cancel/route";
import type { NextRequest } from "next/server";

function manualRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    status: "running",
    trigger_type: "manual",
    batch_id: null,
    apify_run_id: "apify-1",
    token_id: "token-1",
    cancel_requested_at: null,
    cancellation_kind: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ user: { id: "staff-1" }, response: null });
  mocks.getRunById.mockResolvedValue(manualRun());
  mocks.requestRunCancellation.mockResolvedValue(true);
  mocks.getTokenById.mockResolvedValue("secret-token");
  mocks.getApifyRunDetails.mockResolvedValue({ status: "RUNNING" });
  mocks.abortApifyRun.mockResolvedValue({ status: "ABORTING" });
});

describe("Job Agent manual run cancellation", () => {
  test("requests the provider abort and keeps the row active until Apify confirms", async () => {
    const response = await POST({} as NextRequest, { params: { id: "run-1" } });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "cancellation_requested", apifyStatus: "ABORTING" });
    expect(mocks.requestRunCancellation).toHaveBeenCalledWith("run-1", "operator", expect.stringContaining("Apify cancellation"));
    expect(mocks.abortApifyRun).toHaveBeenCalledWith("apify-1", "secret-token");
  });

  test("does not allow the manual stop control to cancel scheduled batch shards", async () => {
    mocks.getRunById.mockResolvedValue(manualRun({ trigger_type: "nightly", batch_id: "batch-1" }));

    const response = await POST({} as NextRequest, { params: { id: "run-1" } });
    expect(response.status).toBe(403);
    expect(mocks.abortApifyRun).not.toHaveBeenCalled();
  });

  test("marks the local run cancelled when Apify confirms immediate abort", async () => {
    mocks.abortApifyRun.mockResolvedValue({ status: "ABORTED" });
    mocks.transitionRunStatus.mockResolvedValue(true);

    const response = await POST({} as NextRequest, { params: { id: "run-1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "cancelled" });
    expect(mocks.transitionRunStatus).toHaveBeenCalledWith("run-1", "running", expect.objectContaining({ status: "cancelled" }));
  });
});
