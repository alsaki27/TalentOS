import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  findStagedById: vi.fn(),
  updateStaged: vi.fn().mockResolvedValue(undefined),
  createRun: vi.fn(),
  updateRunStatus: vi.fn().mockResolvedValue(undefined),
  getDescriptionMinimumForStagedRow: vi.fn(),
  isSafeExternalUrl: vi.fn(),
  backgroundDispatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories/jobCeoStagingRepository", () => ({
  findStagedById: mocks.findStagedById,
  updateStaged: mocks.updateStaged,
}));

vi.mock("@/server/repositories/jobCeoRunRepository", () => ({
  createRun: mocks.createRun,
  updateRunStatus: mocks.updateRunStatus,
}));

vi.mock("@/server/services/jobCeoService", () => ({
  getDescriptionMinimumForStagedRow: mocks.getDescriptionMinimumForStagedRow,
}));

vi.mock("@/lib/ai/job-agents/fetchJobPage", () => ({
  isSafeExternalUrl: mocks.isSafeExternalUrl,
}));

vi.mock("@/server/lib/waitUntil", () => ({
  backgroundDispatch: mocks.backgroundDispatch,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/job-ceo/recovery-queue/[id]/resolve/route";

const stagedId = "staged-1";
const originalFetch = global.fetch;

function makeRequest(body: unknown) {
  return new NextRequest(`https://talentos.test/api/job-ceo/recovery-queue/${stagedId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/job-ceo/recovery-queue/[id]/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "u1" } }, response: null });
    mocks.isSafeExternalUrl.mockReturnValue(true);
    mocks.getDescriptionMinimumForStagedRow.mockReturnValue(1500);
    mocks.createRun.mockResolvedValue({ id: "new-run-1" });
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requires a staff session", async () => {
    const denied = new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
    mocks.requireCurrentUser.mockResolvedValue({ context: null, response: denied });

    const response = await POST(makeRequest({ descriptionText: "x".repeat(2000) }), { params: { id: stagedId } });

    expect(response).toBe(denied);
    expect(mocks.findStagedById).not.toHaveBeenCalled();
  });

  it("404s when the staging row does not exist", async () => {
    mocks.findStagedById.mockResolvedValue(null);

    const response = await POST(makeRequest({ descriptionText: "x".repeat(2000) }), { params: { id: stagedId } });

    expect(response.status).toBe(404);
  });

  it("409s when the row is not at stage='no_description' (e.g. it already got logged)", async () => {
    mocks.findStagedById.mockResolvedValue({ id: stagedId, stage: "logged", raw: { source: "adzuna" } });

    const response = await POST(makeRequest({ descriptionText: "x".repeat(2000) }), { params: { id: stagedId } });

    expect(response.status).toBe(409);
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("400s when the supplied description is shorter than this source's minimum", async () => {
    mocks.findStagedById.mockResolvedValue({ id: stagedId, stage: "no_description", raw: { source: "adzuna" } });
    mocks.getDescriptionMinimumForStagedRow.mockReturnValue(1500);

    const response = await POST(makeRequest({ descriptionText: "too short" }), { params: { id: stagedId } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/too short/i);
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("400s when sourceUrl is supplied but fails the safe-external-URL check", async () => {
    mocks.findStagedById.mockResolvedValue({ id: stagedId, stage: "no_description", raw: { source: "adzuna" } });
    mocks.isSafeExternalUrl.mockReturnValue(false);

    const response = await POST(
      makeRequest({ descriptionText: "x".repeat(2000), sourceUrl: "javascript:alert(1)" }),
      { params: { id: stagedId } }
    );

    expect(response.status).toBe(400);
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  it("creates a fresh run at stage 'qa', attaches the row to it, and dispatches — on a valid resolve", async () => {
    mocks.findStagedById.mockResolvedValue({
      id: stagedId,
      stage: "no_description",
      source_url: null,
      raw: { source: "adzuna" },
    });
    const longDescription = "x".repeat(2000);

    const response = await POST(
      makeRequest({ descriptionText: longDescription, sourceUrl: "https://careers.example.com/job/1" }),
      { params: { id: stagedId } }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, runId: "new-run-1" });

    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ source: "adzuna", triggerType: "manual_recovery", startedBy: "u1" })
    );
    expect(mocks.updateStaged).toHaveBeenCalledWith(
      stagedId,
      expect.objectContaining({
        run_id: "new-run-1",
        description_text: longDescription,
        source_url: "https://careers.example.com/job/1",
        stage: "researched",
        last_error: null,
      })
    );
    expect(mocks.updateRunStatus).toHaveBeenCalledWith("new-run-1", "qa");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/job-ceo/dispatch?runId=new-run-1"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to the row's existing source_url when no sourceUrl is supplied in the request", async () => {
    mocks.findStagedById.mockResolvedValue({
      id: stagedId,
      stage: "no_description",
      source_url: "https://existing.example.com/job",
      raw: { source: "adzuna" },
    });

    await POST(makeRequest({ descriptionText: "x".repeat(2000) }), { params: { id: stagedId } });

    expect(mocks.updateStaged).toHaveBeenCalledWith(
      stagedId,
      expect.objectContaining({ source_url: "https://existing.example.com/job" })
    );
  });
});
