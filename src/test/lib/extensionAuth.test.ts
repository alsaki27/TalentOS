// Unit tests for authenticateExtension() — the bearer-token auth gate used by every
// /api/extension/v1/* route. Covers the valid/revoked/malformed-token and
// missing-scope paths. This is the gate that was previously unreachable because
// middleware short-circuited these paths with a generic session-cookie 401 before
// the route handler ever ran (fixed in middleware.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";

const queryOneMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: queryOneMock,
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
}));

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, EXTENSION_SCOPES } from "@/lib/extensionAuth";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("https://test.local/api/extension/v1/queue/next", { headers });
}

describe("authenticateExtension", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
  });

  it("rejects with 401 invalid_key when no token is present (no auth header, no x-api-key)", async () => {
    const res = await authenticateExtension(makeRequest({}), EXTENSION_SCOPES.queueRead);
    expect(res).toBeInstanceOf(NextResponse);
    if (res instanceof NextResponse) {
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_key");
    }
  });

  it("rejects with 401 invalid_key when the token does not match any active key", async () => {
    queryOneMock.mockResolvedValue(null);
    const res = await authenticateExtension(
      makeRequest({ authorization: "Bearer tos_nonexistent" }),
      EXTENSION_SCOPES.queueRead
    );
    expect(res).toBeInstanceOf(NextResponse);
    if (res instanceof NextResponse) {
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("invalid_key");
    }
  });

  it("rejects with 403 missing_scope when the key is valid but lacks the required scope", async () => {
    queryOneMock.mockResolvedValue({
      id: "key-1",
      label: "test",
      scopes: ["extension:job:capture"],
      candidate_id: null,
    });
    const res = await authenticateExtension(
      makeRequest({ authorization: "Bearer tos_valid" }),
      EXTENSION_SCOPES.queueRead
    );
    expect(res).toBeInstanceOf(NextResponse);
    if (res instanceof NextResponse) {
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("missing_scope");
      expect(body.error.message).toContain("extension:queue:read");
    }
  });

  it("returns the resolved key when the token is valid and has the required scope", async () => {
    const row = { id: "key-1", label: "test", scopes: ["extension:queue:read"], candidate_id: null };
    queryOneMock.mockResolvedValue(row);
    const res = await authenticateExtension(
      makeRequest({ authorization: "Bearer tos_valid" }),
      EXTENSION_SCOPES.queueRead
    );
    expect(res).not.toBeInstanceOf(NextResponse);
    expect((res as any).key).toEqual(row);
  });

  it("accepts the token via x-api-key header instead of Bearer", async () => {
    const row = { id: "key-2", label: "api-key", scopes: ["extension:readiness:read"], candidate_id: "c-1" };
    queryOneMock.mockResolvedValue(row);
    const res = await authenticateExtension(
      makeRequest({ "x-api-key": "tos_xapikey" }),
      EXTENSION_SCOPES.readinessRead
    );
    expect(res).not.toBeInstanceOf(NextResponse);
    expect((res as any).key).toEqual(row);
    expect(queryOneMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a revoked key (revoked_at IS NULL filter means no row returned)", async () => {
    queryOneMock.mockResolvedValue(null);
    const res = await authenticateExtension(
      makeRequest({ authorization: "Bearer tos_revoked" }),
      EXTENSION_SCOPES.queueRead
    );
    if (res instanceof NextResponse) {
      expect(res.status).toBe(401);
    }
  });
});