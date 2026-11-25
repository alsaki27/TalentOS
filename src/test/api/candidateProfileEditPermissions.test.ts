import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(), verifyJWT: vi.fn(), queryOne: vi.fn(), query: vi.fn(), execute: vi.fn(),
  logActivity: vi.fn(), triggerWebhooks: vi.fn(), sendEmail: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: () => ({ get: mocks.cookieGet }) }));
vi.mock("@/server/auth/jwt", () => ({ verifyJWT: mocks.verifyJWT }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, query: mocks.query, execute: mocks.execute }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/webhookEngine", () => ({ triggerWebhooks: mocks.triggerWebhooks }));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: vi.fn() }));
vi.mock("@/lib/emailService", () => ({ sendEmail: mocks.sendEmail }));

import { DELETE, GET, PATCH } from "@/app/api/candidates/[id]/route";
import { POST as forgotPassword } from "@/app/api/portal/auth/forgot-password/route";
import { getTeamRoleStorage, TEAM_ROLE_KEYS, type TeamRoleKey } from "@/lib/auth-edge";

const candidateId = "09a1bf9c-ee50-4fbc-a7bf-c9d81133f324";
const params = { params: { id: candidateId } };
const candidateUrl = `https://talentos.test/api/candidates/${candidateId}`;
let candidate: Record<string, unknown>;

function useRole(role: TeamRoleKey, isActive = true) {
  mocks.queryOne.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM profiles")) {
      return { user_id: "staff", email: "staff@example.com", display_name: "Test staff", is_active: isActive, ...getTeamRoleStorage(role) };
    }
    if (sql.startsWith("UPDATE candidates SET")) {
      const fields = [...sql.matchAll(/(\w+) = \$(\d+)/g)].filter(([, field]) => field !== "id");
      for (const [, field, position] of fields) candidate[field] = values[Number(position) - 1];
      return { ...candidate };
    }
    if (sql.includes("WHERE LOWER(account_email)")) {
      return values[0] === candidate.account_email ? { ...candidate } : null;
    }
    if (sql.startsWith("SELECT * FROM candidates")) return { ...candidate };
    throw new Error(`Unexpected query: ${sql}`);
  });
}

function jsonRequest(url: string, method: string, body: Record<string, unknown>) {
  return new NextRequest(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function edit(body: Record<string, unknown>) {
  return PATCH(jsonRequest(candidateUrl, "PATCH", body), params);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.cookieGet.mockReturnValue({ value: "test-session" });
  mocks.verifyJWT.mockResolvedValue({ user_id: "staff" });
  candidate = { id: candidateId, name: "Original name", account_email: "portal@example.test", password_hash: "example hash" };
  useRole("application_engineer");
});

describe("Edit profile permissions", () => {
  it.each(TEAM_ROLE_KEYS)("lets %s save and reopen the existing profile fields", async (role) => {
    useRole(role);
    const fields = {
      name: "Updated name", email: "contact@example.test", phone: null,
      target_roles: "CAD Designer", preferred_locations: "Atlanta, GA", salary_expectation: null, work_authorization: null,
      linkedin_url: "https://example.test/profile", github_url: null, portfolio_url: null, visa_status: null,
      target_industries: ["Design"], current_location: "Dallas, TX", location_preference: null,
      work_mode_preference: "Hybrid", available_start_date: "2027-01-04", verified_skills: ["Drafting"],
      eeo_gender: null, eeo_race: null, eeo_veteran: null, eeo_disability: null,
    };
    const saved = await edit({ ...fields, account_email: "ignored@example.test", password_hash: "ignored" });
    expect(saved.status).toBe(200);
    const response = await saved.json();
    expect(response).toMatchObject({ ...fields, timezone: "America/Chicago", account_email: "portal@example.test" });
    expect(response).not.toHaveProperty("password_hash");
    expect(await (await GET(new NextRequest(candidateUrl), params)).json()).toMatchObject(fields);
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: "staff", entityId: candidateId }));
  });

  it.each(["status", "pipeline_stage", "has_contract", "portal_token_expires_at", "portal_token_revoked_at"])(
    "rejects a profile update mixed with restricted field %s before writing", async field => {
      const res = await edit({ name: "Blocked change", [field]: field === "has_contract" ? true : null });
      expect(res.status).toBe(403);
      expect(candidate.name).toBe("Original name");
      expect(mocks.logActivity).not.toHaveBeenCalled();
    },
  );

  it("keeps manager and contract permissions independent of profile editing", async () => {
    useRole("application_engineer_manager_reviewer");
    expect((await edit({ pipeline_stage: "applying" })).status).toBe(200);
    expect((await edit({ has_contract: true })).status).toBe(403);
    useRole("co_manager");
    expect((await edit({ has_contract: true })).status).toBe(200);
    useRole("application_engineer_grunter");
    expect((await DELETE(new NextRequest(candidateUrl, { method: "DELETE" }), params)).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("requires a signed-in, active staff account", async () => {
    useRole("application_engineer_reviewer", false);
    expect((await edit({ name: "Blocked change" })).status).toBe(401);
    mocks.cookieGet.mockReturnValue(undefined);
    expect((await edit({ name: "Blocked change" })).status).toBe(401);
    expect(candidate.name).toBe("Original name");
  });
});

describe("Candidate password recovery after a contact edit", () => {
  const resetUrl = "https://talentos.test/api/portal/auth/forgot-password";

  it("uses the portal login address even after an application engineer edits the contact email", async () => {
    expect((await edit({ email: "contact@example.test" })).status).toBe(200);
    const otherAddress = await forgotPassword(jsonRequest(resetUrl, "POST", { email: "contact@example.test" }));
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    const loginAddress = await forgotPassword(jsonRequest(resetUrl, "POST", { email: " PORTAL@example.test " }));
    expect(await loginAddress.json()).toEqual(await otherAddress.json());
    expect(mocks.sendEmail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "portal@example.test", candidateId }));
  });

  it("never issues a reset to a contact address for a candidate without a portal login", async () => {
    candidate.account_email = null;
    expect((await edit({ email: "new@example.test" })).status).toBe(200);
    expect((await forgotPassword(jsonRequest(resetUrl, "POST", { email: "new@example.test" }))).status).toBe(200);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
