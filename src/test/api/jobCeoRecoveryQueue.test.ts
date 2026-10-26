import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  listRecoveryQueue: vi.fn(),
  countRecoveryQueue: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories/jobCeoStagingRepository", () => ({
  listRecoveryQueue: mocks.listRecoveryQueue,
  countRecoveryQueue: mocks.countRecoveryQueue,
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/job-ceo/recovery-queue/route";

function makeRequest(query = "") {
  return new NextRequest(`https://talentos.test/api/job-ceo/recovery-queue${query}`);
}

describe("GET /api/job-ceo/recovery-queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a staff session — returns the auth response unchanged when denied", async () => {
    const denied = new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
    mocks.requireCurrentUser.mockResolvedValue({ context: null, response: denied });

    const response = await GET(makeRequest());

    expect(response).toBe(denied);
    expect(mocks.listRecoveryQueue).not.toHaveBeenCalled();
  });

  it("returns the recovery queue rows and total count for an authorized staff user", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "u1" } }, response: null });
    mocks.listRecoveryQueue.mockResolvedValue([{ id: "row-1", stage: "no_description" }]);
    mocks.countRecoveryQueue.mockResolvedValue(42);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.total).toBe(42);
  });

  it("clamps the limit query param to 1000", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "u1" } }, response: null });
    mocks.listRecoveryQueue.mockResolvedValue([]);
    mocks.countRecoveryQueue.mockResolvedValue(0);

    await GET(makeRequest("?limit=999999"));

    expect(mocks.listRecoveryQueue).toHaveBeenCalledWith(1000, 0);
  });

  it("returns a 500 with the error message when the query fails", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "u1" } }, response: null });
    mocks.listRecoveryQueue.mockRejectedValue(new Error("db down"));
    mocks.countRecoveryQueue.mockResolvedValue(0);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("db down");
  });
});
