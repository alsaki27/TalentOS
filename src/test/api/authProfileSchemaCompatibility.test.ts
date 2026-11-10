import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  verifyJWT: vi.fn(),
  cookieValue: "test-token",
}));

vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, query: vi.fn(), execute: vi.fn() }));
vi.mock("@/server/auth/jwt", () => ({ verifyJWT: mocks.verifyJWT }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => ({ value: mocks.cookieValue }) }),
}));

import { getCurrentUserContext } from "@/lib/auth";
import { findProfileByEmail } from "@/server/auth/profiles";

describe("auth profile schema compatibility", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cookieValue = "test-token";
    mocks.queryOne.mockResolvedValue({
      user_id: "admin-id",
      email: "admin@talentos.local",
      display_name: "Admin",
      role: "admin",
      is_active: true,
      password_hash: "hash",
    });
    mocks.verifyJWT.mockResolvedValue({ user_id: "admin-id", email: "admin@talentos.local" });
  });

  it("loads a password-login profile without requiring profiles.role_variant", async () => {
    const profile = await findProfileByEmail("admin@talentos.local");
    const [sql] = mocks.queryOne.mock.calls[0];

    expect(profile?.role).toBe("admin");
    expect(sql).toContain("to_jsonb(p)->>'role_variant' AS role_variant");
    expect(sql).not.toMatch(/\bp\.role_variant\b/);
  });

  it("loads the authenticated session when profiles.role_variant is absent", async () => {
    const context = await getCurrentUserContext();
    const [sql] = mocks.queryOne.mock.calls[0];

    expect(context?.profile.role).toBe("admin");
    expect(sql).toContain("to_jsonb(p)->>'role_variant' AS role_variant");
    expect(sql).not.toMatch(/\bp\.role_variant\b/);
  });
});
