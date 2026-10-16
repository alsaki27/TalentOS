import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findRunById: vi.fn(),
  countByStage: vi.fn(),
  deleteRun: vi.fn(),
}));

vi.mock("@/server/repositories/jobCeoRunRepository", () => ({
  findRunById: mocks.findRunById,
  deleteRun: mocks.deleteRun,
}));

vi.mock("@/server/repositories/jobCeoStagingRepository", () => ({
  countByStage: mocks.countByStage,
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/job-ceo/runs/[id]/route";
import { middleware } from "@/middleware";

const runId = "7c94cce4-9fa5-4ecf-a7d3-2ad53e6f74d2";
const originalCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

function statusRequest(authorization?: string) {
  return new NextRequest(`https://talentos.test/api/job-ceo/runs/${runId}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("Job CEO run status polling auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "cron-secret-for-test";
    mocks.findRunById.mockResolvedValue({ id: runId, status: "deep_fetch" });
    mocks.countByStage.mockResolvedValue([{ stage: "ingested", count: "2" }]);
  });

  it("allows the CRON_SECRET bearer through middleware for the exact GET status route", async () => {
    const response = await middleware(statusRequest("Bearer cron-secret-for-test"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("does not allow a wrong secret or a mutating run endpoint through middleware", async () => {
    const wrongSecret = await middleware(statusRequest("Bearer wrong-secret"));
    const deleteRequest = new NextRequest(`https://talentos.test/api/job-ceo/runs/${runId}`, {
      method: "DELETE",
      headers: { authorization: "Bearer cron-secret-for-test" },
    });
    const cancelRequest = new NextRequest(`https://talentos.test/api/job-ceo/runs/${runId}/cancel`, {
      method: "POST",
      headers: { authorization: "Bearer cron-secret-for-test" },
    });
    const deleteResponse = await middleware(deleteRequest);
    const cancelResponse = await middleware(cancelRequest);

    expect(wrongSecret.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(cancelResponse.status).toBe(401);
  });

  it("re-checks a supplied bearer token in the status route", async () => {
    const response = await GET(statusRequest("Bearer cron-secret-for-test"), { params: { id: runId } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.run.status).toBe("deep_fetch");
    expect(mocks.findRunById).toHaveBeenCalledWith(runId);
  });

  it("rejects an invalid bearer token before reading the run", async () => {
    const response = await GET(statusRequest("Bearer wrong-secret"), { params: { id: runId } });

    expect(response.status).toBe(401);
    expect(mocks.findRunById).not.toHaveBeenCalled();
  });
});
