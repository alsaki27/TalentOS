import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), query: vi.fn(), queryOne: vi.fn(),
  testConnection: vi.fn(),
  countProfiles: vi.fn(), createProfile: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.auth }));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query, queryOne: mocks.queryOne, testConnection: mocks.testConnection,
}));
vi.mock("@/server/repositories/auditLogRepository", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/server/auth/profiles", () => ({
  countProfiles: mocks.countProfiles, createProfile: mocks.createProfile,
  createAuditLog: vi.fn(), findProfileByEmail: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ createAuthResponse: vi.fn() }));
vi.mock("@/server/services/applicationAiWorkflowService", () => ({
  refreshWorkflowRoutingSnapshot: vi.fn(), retryWorkflow: vi.fn(),
}));

import { GET as archiveGet } from "@/app/api/admin/run-archive/route";
import { GET as repairGet } from "@/app/api/admin/repair-ai-queue/route";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as keysGet, POST as keysPost } from "@/app/api/api-keys/route";
import { DELETE as keyDelete } from "@/app/api/api-keys/[id]/route";
import { GET as signupGet, POST as signupPost } from "@/app/api/auth/signup/route";

describe("codebase audit security guards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) });
  });

  it("retires the destructive archive URL", async () => {
    expect((await archiveGet()).status).toBe(410);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("does not retry workflows from a GET navigation", async () => {
    const response = await repairGet();
    expect(response.status).toBe(405);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires an admin profile for public API key reads, creation, and revocation", async () => {
    expect((await keysGet()).status).toBe(403);
    expect((await keysPost(new Request("https://talentos.test/api/api-keys", { method: "POST" }) as any)).status).toBe(403);
    expect((await keyDelete(new Request("https://talentos.test/api/api-keys/id"), { params: { id: "id" } })).status).toBe(403);
    expect(mocks.auth).toHaveBeenCalledTimes(3);
    expect(mocks.auth).toHaveBeenNthCalledWith(1, ["admin"]);
    expect(mocks.auth).toHaveBeenNthCalledWith(2, ["admin"]);
    expect(mocks.auth).toHaveBeenNthCalledWith(3, ["admin"]);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it("keeps public health checks while omitting driver and error details", async () => {
    mocks.testConnection.mockResolvedValue({ ok: false, driver: "postgres-tcp", error: "internal host" });
    const response = await healthGet();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "error", duration_ms: expect.any(Number) });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses anonymous staff signup after a workspace owner exists", async () => {
    mocks.countProfiles.mockResolvedValue(1);
    expect(await (await signupGet()).json()).toEqual({ bootstrap_available: false });
    const response = await signupPost(new Request("https://talentos.test/api/auth/signup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", password: "password123", display_name: "New User" }),
    }) as any);
    expect(response.status).toBe(403);
    expect(mocks.createProfile).not.toHaveBeenCalled();
  });
});
