// Regression coverage: the scheduled batch-retry endpoint must be reachable
// with only a CRON_SECRET bearer (no staff session) — the GitHub Actions
// workflow has no browser session to present — the same exemption
// /api/job-ceo/dispatch and /api/job-ceo/enrich already have.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";

const originalCronSecret = process.env.CRON_SECRET;

function request(authorization?: string, method = "POST") {
  return new NextRequest("https://talentos.test/api/job-ceo/recovery-queue/retry", {
    method,
    headers: authorization ? { authorization } : undefined,
  });
}

describe("middleware auth for /api/job-ceo/recovery-queue/retry", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-secret-for-test";
  });
  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  it("allows the correct CRON_SECRET bearer through with no session", async () => {
    const response = await middleware(request("Bearer cron-secret-for-test"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a missing or wrong bearer", async () => {
    expect((await middleware(request())).status).toBe(401);
    expect((await middleware(request("Bearer wrong"))).status).toBe(401);
  });

  it("does not exempt the per-row manual retry route (that one stays staff-session-only)", async () => {
    const response = await middleware(
      new NextRequest("https://talentos.test/api/job-ceo/recovery-queue/abc-123/retry", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret-for-test" },
      })
    );
    expect(response.status).toBe(401);
  });
});
