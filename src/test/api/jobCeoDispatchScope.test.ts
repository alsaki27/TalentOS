import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchAndChain: vi.fn(),
}));

vi.mock("@/server/services/jobCeoService", () => ({
  dispatchAndChain: mocks.dispatchAndChain,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/job-ceo/dispatch/route";

describe("POST /api/job-ceo/dispatch run scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    mocks.dispatchAndChain.mockResolvedValue({
      dispatched: true,
      runId: "run-123",
      stage: "qa",
      count: 3,
      needsDispatch: true,
    });
  });

  it("forwards an explicit run ID so the service can dispatch only that run", async () => {
    const request = new NextRequest("https://talentos.test/api/job-ceo/dispatch?runId=run-123", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.dispatchAndChain).toHaveBeenCalledWith("run-123");
  });

  it("preserves the global dispatcher behavior when no run ID is supplied", async () => {
    const request = new NextRequest("https://talentos.test/api/job-ceo/dispatch", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.dispatchAndChain).toHaveBeenCalledWith(undefined);
  });
});
