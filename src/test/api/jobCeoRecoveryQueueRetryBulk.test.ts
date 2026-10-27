import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  retryManyRowsByIds: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/services/jobCeoRecoveryRetryService", () => ({
  retryManyRowsByIds: mocks.retryManyRowsByIds,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/job-ceo/recovery-queue/retry-bulk/route";

function req(body: unknown) {
  return new NextRequest("https://talentos.test/api/job-ceo/recovery-queue/retry-bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/job-ceo/recovery-queue/retry-bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ response: null });
  });

  it("requires a staff session", async () => {
    const denied = new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
    mocks.requireCurrentUser.mockResolvedValue({ response: denied });

    const response = await POST(req({ ids: ["a"] }));

    expect(response).toBe(denied);
    expect(mocks.retryManyRowsByIds).not.toHaveBeenCalled();
  });

  it("400s when ids is missing or empty", async () => {
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ ids: [] }))).status).toBe(400);
    expect(mocks.retryManyRowsByIds).not.toHaveBeenCalled();
  });

  it("filters out non-string entries before calling the service", async () => {
    mocks.retryManyRowsByIds.mockResolvedValue({ results: [], recovered: 0, stillFailing: 0, ineligible: 0 });

    await POST(req({ ids: ["a", 123, null, "b"] }));

    expect(mocks.retryManyRowsByIds).toHaveBeenCalledWith(["a", "b"]);
  });

  it("returns the summary on success", async () => {
    mocks.retryManyRowsByIds.mockResolvedValue({
      results: [{ id: "a", outcome: "recovered", runId: "run-1" }],
      recovered: 1,
      stillFailing: 0,
      ineligible: 0,
    });

    const response = await POST(req({ ids: ["a"] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ recovered: 1, stillFailing: 0, ineligible: 0 });
  });

  it("returns a 500 with the error message when the service throws", async () => {
    mocks.retryManyRowsByIds.mockRejectedValue(new Error("db down"));

    const response = await POST(req({ ids: ["a"] }));

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("db down");
  });
});
