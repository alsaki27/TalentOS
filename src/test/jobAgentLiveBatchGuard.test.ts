import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRunById: vi.fn(),
  transitionRunStatus: vi.fn(),
  getTokenById: vi.fn(),
  fetchLiveApifyDatasetItems: vi.fn(),
  checkApifyRunStatus: vi.fn(),
  processApifyRunData: vi.fn(),
  requireCurrentUser: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("@/server/repositories/jobAgentRunRepository", () => ({
  getRunById: mocks.getRunById,
  transitionRunStatus: mocks.transitionRunStatus,
}));
vi.mock("@/server/repositories/jobAgentTokenRepository", () => ({
  getTokenById: mocks.getTokenById,
}));
vi.mock("@/server/services/jobAgentService", () => ({
  fetchLiveApifyDatasetItems: mocks.fetchLiveApifyDatasetItems,
  checkApifyRunStatus: mocks.checkApifyRunStatus,
  processApifyRunData: mocks.processApifyRunData,
}));
vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: mocks.waitUntil,
}));

import { GET } from "@/app/api/job-agent/runs/[id]/live/route";
import type { NextRequest } from "next/server";

function run(batchId: string | null) {
  return {
    id: "run-1",
    status: "running",
    batch_id: batchId,
    actor_source: "indeed",
    apify_run_id: "actor-1",
    apify_dataset_id: "dataset-1",
    token_id: "token-1",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
  mocks.getTokenById.mockResolvedValue({ id: "token-1", token: "secret" });
  mocks.checkApifyRunStatus.mockResolvedValue("SUCCEEDED");
  mocks.processApifyRunData.mockResolvedValue({
    rawCount: 0,
    dateIncludedCount: 0,
    dateExcludedCount: 0,
    dateExclusionReasons: {},
    duplicateCount: 0,
    classifiedCount: 0,
  });
});

describe("Job Agent live-route processing ownership", () => {
  test("never processes a completed Apify dataset belonging to a nightly batch", async () => {
    mocks.getRunById.mockResolvedValue(run("batch-1"));

    const response = await GET({} as NextRequest, { params: { id: "run-1" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "running", apify_status: "SUCCEEDED" });
    expect(mocks.transitionRunStatus).not.toHaveBeenCalled();
    expect(mocks.processApifyRunData).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  test("manual processing starts only after the conditional status claim succeeds", async () => {
    mocks.getRunById.mockResolvedValue(run(null));
    mocks.transitionRunStatus.mockResolvedValue(true);

    const response = await GET({} as NextRequest, { params: { id: "run-1" } });

    expect(response.status).toBe(200);
    expect(mocks.transitionRunStatus).toHaveBeenCalledWith("run-1", "running", expect.objectContaining({
      status: "processing",
      processing_started_at: expect.any(String),
    }));
    expect(mocks.processApifyRunData).toHaveBeenCalledOnce();
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
  });

  test("a caller that loses the processing claim cannot process the dataset", async () => {
    mocks.getRunById.mockResolvedValue(run(null));
    mocks.transitionRunStatus.mockResolvedValue(false);

    const response = await GET({} as NextRequest, { params: { id: "run-1" } });
    const body = await response.json();

    expect(body.status).toBe("processing");
    expect(mocks.processApifyRunData).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });
});
