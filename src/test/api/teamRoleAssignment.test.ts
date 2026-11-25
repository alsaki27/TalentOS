import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAssignableTeamRole, TEAM_ROLE_KEYS } from "@/lib/auth-edge";
import { PATCH } from "@/app/api/users/[id]/route";
import { POST } from "@/app/api/users/route";

const mocks = vi.hoisted(() => ({ queryOne: vi.fn(), upsertProfile: vi.fn() }));
vi.mock("@/lib/auth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  requireCurrentUser: async () => ({ context: { profile: { user_id: "admin" } }, response: null }),
}));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne }));
vi.mock("@/server/repositories/profilesRepository", () => ({ upsertProfile: mocks.upsertProfile }));

const profile = { user_id: "member", email: "member@example.test", display_name: "Member", role: "application_engineer", role_variant: null, is_active: true };
const params = { params: { id: profile.user_id } };
function request(method: string, body: object) {
  return new NextRequest("https://example.test/api/users", { method, body: JSON.stringify(body) });
}

describe("team role assignment", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("offers every existing role except the plain Application Engineer title", () => {
    expect(TEAM_ROLE_KEYS.filter(role => !isAssignableTeamRole(role))).toEqual(["application_engineer"]);
  });

  it.each(["application_engineer", undefined])("rejects creating a user with role %s before writing", async role => {
    const response = await POST(request("POST", { ...profile, role, password: "test-password" }));
    expect(response.status).toBe(400);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.upsertProfile).not.toHaveBeenCalled();
  });

  it("rejects assigning the plain title to another role, including AE subroles", async () => {
    mocks.queryOne.mockResolvedValue(null);
    const response = await PATCH(request("PATCH", { role: "application_engineer" }), params);
    expect(response.status).toBe(400);
    expect(mocks.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = $2 AND role = $3 AND role_variant IS NULL"),
      [expect.any(String), "member", "application_engineer"]
    );
  });

  it.each([{}, { role: "application_engineer" }])("retains an existing holder's role when reactivating with %j", async extra => {
    mocks.queryOne.mockResolvedValue(profile);
    const response = await PATCH(request("PATCH", { is_active: true, ...extra }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user_id: "member", role_key: "application_engineer", is_active: true });
    expect(mocks.queryOne.mock.calls[0][0].split(" WHERE ")[0]).toBe("UPDATE profiles SET updated_at = $1, is_active = $2");
  });

  it.each(["application_engineer_reviewer", "application_engineer_grunter"])("assigns %s with its usual access role", async role => {
    mocks.queryOne.mockResolvedValue({ ...profile, role_variant: role });
    const response = await PATCH(request("PATCH", { role }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ role_key: role, role: "application_engineer" });
    expect(mocks.queryOne.mock.calls[0][1]).toEqual([expect.any(String), "application_engineer", role, "member"]);
  });
});
