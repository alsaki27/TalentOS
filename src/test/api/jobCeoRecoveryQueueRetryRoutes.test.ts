import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  processRecoveryRetryBatch: vi.fn(),
  retryRecoveryQueueRowById: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/services/jobCeoRecoveryRetryService", () => ({
  processRecoveryRetryBatch: mocks.processRecoveryRetryBatch,
  retryRecoveryQueueRowById: mocks.retryRecoveryQueueRowById,
}));

import { NextRequest } from "next/server";
import { POST as batchRetry } from "@/app/api/job-ceo/recovery-queue/retry/route";
import { POST as singleRetry } from "@/app/api/job-ceo/recovery-queue/[id]/retry/route";

const originalCronSecret = process.env.CRON_SECRET;

describe("POST /api/job-ceo/recovery-queue/retry (scheduled batch)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
  });
  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  function req(authorization?: string) {
    return new NextRequest("https://talentos.test/api/job-ceo/recovery-queue/retry", {
      method: "POST",
      headers: authorization ? { authorization } : undefined,
    });
  }

  it("rejects a request with no or wrong CRON_SECRET bearer", async () => {
    const response = await batchRetry(req());
    expect(response.status).toBe(401);
    expect(mocks.processRecoveryRetryBatch).not.toHaveBeenCalled();

    const wrong = await batchRetry(req("Bearer wrong"));
    expect(wrong.status).toBe(401);
  });

  it("runs the batch and returns its summary for a valid bearer", async () => {
    mocks.processRecoveryRetryBatch.mockResolvedValue({ processed: 5, recovered: 2, stillFailing: 3 });

    const response = await batchRetry(req("Bearer test-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ processed: 5, recovered: 2, stillFailing: 3 });
  });

  it("returns a 500 with the error message when the batch throws", async () => {
    mocks.processRecoveryRetryBatch.mockRejectedValue(new Error("db down"));
    const response = await batchRetry(req("Bearer test-secret"));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("db down");
  });
});

describe("POST /api/job-ceo/recovery-queue/[id]/retry (manual, staff-triggered)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a staff session", async () => {
    const denied = new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
    mocks.requireCurrentUser.mockResolvedValue({ response: denied });

    const response = await singleRetry(new NextRequest("https://talentos.test/x", { method: "POST" }), { params: { id: "row-1" } });

    expect(response).toBe(denied);
    expect(mocks.retryRecoveryQueueRowById).not.toHaveBeenCalled();
  });

  it("returns the outcome with 200 when recovered", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ response: null });
    mocks.retryRecoveryQueueRowById.mockResolvedValue({ id: "row-1", outcome: "recovered", runId: "run-1" });

    const response = await singleRetry(new NextRequest("https://talentos.test/x", { method: "POST" }), { params: { id: "row-1" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ outcome: "recovered", runId: "run-1" });
    expect(mocks.retryRecoveryQueueRowById).toHaveBeenCalledWith("row-1");
  });

  it("returns 409 when the row is not eligible (wrong stage, or no link)", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ response: null });
    mocks.retryRecoveryQueueRowById.mockResolvedValue({ id: "row-1", outcome: "ineligible", reason: "No source_url" });

    const response = await singleRetry(new NextRequest("https://talentos.test/x", { method: "POST" }), { params: { id: "row-1" } });

    expect(response.status).toBe(409);
  });
});
