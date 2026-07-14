import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryOneMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn(),
}));

vi.mock("@/server/db/index", () => ({
  isNeon: () => true,
  isSupabase: () => false,
  getDbProvider: () => "neon",
  isDatabaseConfigured: () => true,
  getDbStatus: () => ({ provider: "neon", configured: true, neonUrlPresent: true, supabaseUrlPresent: false }),
}));

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: queryOneMock,
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import { requireCandidateByToken } from "@/lib/portalAuth";

describe("requireCandidateByToken", () => {
  beforeEach(() => {
    queryOneMock.mockReset();
  });

  it("returns the candidate when token is valid", async () => {
    queryOneMock.mockResolvedValue({
      id: "cand-1",
      name: "Alice",
      portal_token_expires_at: null,
      portal_token_revoked_at: null,
    });

    const result = await requireCandidateByToken("valid-token");

    expect(result.response).toBeNull();
    expect(result.candidate).toEqual({ id: "cand-1", name: "Alice" });
  });

  it("returns 404 when token is not found", async () => {
    queryOneMock.mockResolvedValue(null);

    const result = await requireCandidateByToken("bad-token");

    expect(result.candidate).toBeNull();
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(404);
  });

  it("returns 410 when token is revoked", async () => {
    queryOneMock.mockResolvedValue({
      id: "cand-2",
      name: "Bob",
      portal_token_expires_at: null,
      portal_token_revoked_at: new Date().toISOString(),
    });

    const result = await requireCandidateByToken("revoked-token");

    expect(result.candidate).toBeNull();
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(410);
  });

  it("returns 410 when token is expired", async () => {
    const pastDate = new Date(Date.now() - 1000 * 86400).toISOString();
    queryOneMock.mockResolvedValue({
      id: "cand-3",
      name: "Charlie",
      portal_token_expires_at: pastDate,
      portal_token_revoked_at: null,
    });

    const result = await requireCandidateByToken("expired-token");

    expect(result.candidate).toBeNull();
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(410);
  });

  it("returns the candidate when token has future expiry", async () => {
    const futureDate = new Date(Date.now() + 1000 * 86400 * 90).toISOString();
    queryOneMock.mockResolvedValue({
      id: "cand-4",
      name: "Diana",
      portal_token_expires_at: futureDate,
      portal_token_revoked_at: null,
    });

    const result = await requireCandidateByToken("future-expiry-token");

    expect(result.response).toBeNull();
    expect(result.candidate).toEqual({ id: "cand-4", name: "Diana" });
  });
});
