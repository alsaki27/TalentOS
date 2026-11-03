import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(), verifyJWT: vi.fn(), queryOne: vi.fn(), execute: vi.fn(),
  syncCompanies: vi.fn(), logActivity: vi.fn(), webhooks: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: () => ({ get: mocks.cookieGet }) }));
vi.mock("@/server/auth/jwt", () => ({ verifyJWT: mocks.verifyJWT }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, execute: mocks.execute, query: vi.fn() }));
vi.mock("@/server/repositories/jobsRepository", () => ({ findJobById: vi.fn() }));
vi.mock("@/lib/companyDirectory", () => ({ syncCompanyDirectoryFromJobs: mocks.syncCompanies }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/webhookEngine", () => ({ triggerWebhooks: mocks.webhooks }));

// Exercise the real requireCurrentUser implementation, including cookies,
// verified identity, active profile, role checks, and the route's field filter.
import { GET, PATCH, DELETE } from "@/app/api/jobs/[id]/route";
import { DESTRUCTIVE_MANAGER_ROLES, JOB_EDITOR_ROLES, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";

const jobId = "e12e308c-ceb4-4057-b026-05325fedfa05";
const params = { params: { id: jobId } };
let role = "application_engineer";
let active = true;
let stored: Record<string, unknown>;

function request(body: Record<string, unknown>) {
  return new NextRequest(`https://talentos.test/api/jobs/${jobId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("job editing permissions", () => {
  beforeEach(() => {
    vi.resetAllMocks(); role = "application_engineer"; active = true;
    stored = { id: jobId, title: "Original title", company: "Original company", is_active: true, applications: [] };
    mocks.cookieGet.mockReturnValue({ value: "valid-session" });
    mocks.verifyJWT.mockResolvedValue({ user_id: "ae-user", email: "ae@example.com" });
    mocks.syncCompanies.mockResolvedValue(undefined);
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.webhooks.mockResolvedValue(undefined);
    mocks.queryOne.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM profiles")) return { user_id: "ae-user", email: "ae@example.com", display_name: "Test AE", role, is_active: active };
      if (sql.startsWith("UPDATE jobs SET")) {
        const fields = sql.match(/SET (.+) WHERE/)![1].split(",").map(field => field.trim().split(" = ")[0]);
        fields.forEach((field, index) => { stored[field] = values[index]; });
        return { ...stored };
      }
      if (sql.includes("FROM jobs")) return { ...stored };
      return null;
    });
  });

  it.each(["admin", "manager", "application_engineer"])("lets an active %s edit a job", async userRole => {
    role = userRole;
    const response = await PATCH(request({ title: "Updated title" }), params);
    expect(response.status).toBe(200);
    expect((await response.json()).title).toBe("Updated title");
  });

  it("saves and reads back every existing Edit Job form field for an AE", async () => {
    const edits = {
      title: "NOC Analyst", company: "Zeektek", location: "Columbus, OH", role_tier: "osp",
      salary_range: "$70,000 - $90,000", source_url: "https://example.com/source", notes: "Verified details",
      seniority_level: "1+ years", employment_type: "Full-time", company_website: "https://example.com",
      apply_url: "https://example.com/apply", description_text: "Monitor infrastructure and troubleshoot network incidents.",
      job_function: "Operations", industries: "Technology", company_linkedin_url: "https://linkedin.com/company/example",
      company_logo_url: "https://example.com/logo.png", company_slogan: "Reliable operations", company_description: "Technology services",
      job_category: "IT", category_tags: ["NOC", "Networking"], category_relevance_score: 95, is_active: false,
    };
    const response = await PATCH(request(edits), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(edits);
    const reopened = await GET(new NextRequest(`https://talentos.test/api/jobs/${jobId}`), params);
    expect(await reopened.json()).toMatchObject(edits);
    expect(mocks.syncCompanies).toHaveBeenCalledWith([expect.objectContaining(edits)]);
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ userId: "ae-user", type: "update", entityId: jobId }));
  });

  it("allows clearing optional fields without granting access to system fields", async () => {
    const response = await PATCH(request({ company: null, notes: null, id: "another-job", created_at: "2000-01-01" }), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: jobId, company: null, notes: null });
    expect(stored).not.toHaveProperty("created_at");
  });

  it("requires a signed-in, active user for job editing", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    expect((await PATCH(request({ title: "Blocked" }), params)).status).toBe(401);
    mocks.cookieGet.mockReturnValue({ value: "valid-session" });
    active = false;
    expect((await PATCH(request({ title: "Blocked" }), params)).status).toBe(401);
    expect(stored.title).toBe("Original title");
  });

  it("keeps deletion and other master-data management restricted to managers/admins", async () => {
    expect(JOB_EDITOR_ROLES).toContain("application_engineer");
    expect(MASTER_DATA_MANAGER_ROLES).not.toContain("application_engineer");
    expect(DESTRUCTIVE_MANAGER_ROLES).not.toContain("application_engineer");
    const response = await DELETE(new NextRequest(`https://talentos.test/api/jobs/${jobId}`, { method: "DELETE" }), params);
    expect(response.status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("reports the active original separately from the hidden copy's stored inactive flag", async () => {
    const canonicalId = "00cfcd73-a337-4fdd-bc4b-777ac893adab";
    const previous = mocks.queryOne.getMockImplementation()!;
    mocks.queryOne.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM jobs")) return values[0] === jobId
        ? { ...stored, is_active: false, content_duplicate_of: canonicalId }
        : { id: canonicalId, title: "Original posting", company: "Original company", is_active: true };
      return previous(sql, values);
    });
    const response = await GET(new NextRequest(`https://talentos.test/api/jobs/${jobId}`), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: jobId, is_active: false, content_duplicate_of: canonicalId,
      jobStatus: { state: "active", requestedJobId: jobId, canonicalJobId: canonicalId, redirected: true, sourceAvailability: "unverified" },
    });
  });

  it("does not claim an inactive source posting is closed or reactivate its stored record", async () => {
    stored.is_active = false;
    const response = await GET(new NextRequest(`https://talentos.test/api/jobs/${jobId}`), params);
    expect(await response.json()).toMatchObject({ is_active: false, jobStatus: { state: "inactive", redirected: false, sourceAvailability: "unverified" } });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

});
