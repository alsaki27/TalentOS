import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/auth", () => ({ requireCurrentUser: vi.fn() }));
vi.mock("@/server/auth/jwt", () => ({ verifyJWT: vi.fn().mockResolvedValue(null) }));
vi.mock("@/server/db/neon", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("@/lib/resumeStorage", () => ({ downloadResumeFile: vi.fn() }));
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { middleware } from "@/middleware";
import { POST as enroll } from "@/app/api/browser-worker/v2/enrollments/route";
import { POST as claim } from "@/app/api/browser-worker/v2/claims/route";

describe("prepare route authentication and middleware", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "true"); vi.stubEnv("BROWSER_WORKER_ENVIRONMENT", "staging"); });
  afterEach(() => vi.unstubAllEnvs());
  it("lets only machine paths reach their credential handler without a session", async () => {
    for (const suffix of ["claims", "runs/11111111-1111-4111-8111-111111111111/artifact", "runs/11111111-1111-4111-8111-111111111111/facts", "runs/11111111-1111-4111-8111-111111111111/result"]) {
      const result = await middleware(new NextRequest(`http://localhost/api/browser-worker/v2/${suffix}`));
      expect(result.headers.get("x-middleware-next")).toBe("1");
    }
    for (const suffix of ["enrollments", "enrollments/11111111-1111-4111-8111-111111111111/revoke", "arbitrary"]) {
      expect((await middleware(new NextRequest(`http://localhost/api/browser-worker/v2/${suffix}`))).status).toBe(401);
    }
  });
  it("handler rejects anonymous machine requests", async () => {
    const result = await claim(new Request("http://localhost/api/browser-worker/v2/claims", { method: "POST", body: "{}" }));
    expect(result.status).toBe(401); expect(queryOne).not.toHaveBeenCalled();
    expect(result.headers.get("cache-control")).toBe("no-store, private");
  });
  it("does not expose worker routes while disabled", async () => {
    vi.stubEnv("BROWSER_WORKER_PREPARE_ENABLED", "false");
    expect((await claim(new Request("http://localhost/api/browser-worker/v2/claims", { method: "POST", body: "{}" }))).status).toBe(404);
    expect(queryOne).not.toHaveBeenCalled();
  });
  it("requires admin or manager operator session before enrollment reads", async () => {
    vi.mocked(requireCurrentUser).mockResolvedValue({ context: null, response: NextResponse.json({ error: "Permission denied" }, { status: 403 }) });
    expect((await enroll(new Request("http://localhost/api/browser-worker/v2/enrollments", { method: "POST", body: "{}" }))).status).toBe(403);
    expect(requireCurrentUser).toHaveBeenCalledWith(["admin", "manager"]); expect(queryOne).not.toHaveBeenCalled();
  });
});
