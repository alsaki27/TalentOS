import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  queryOne: vi.fn(),
  logActivity: vi.fn(),
  triggerWebhooks: vi.fn(),
  scrapeJobLocationFromPosting: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  APPLICATION_WORKER_ROLES: ["admin", "manager", "application_engineer"],
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne }));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/webhookEngine", () => ({ triggerWebhooks: mocks.triggerWebhooks }));
vi.mock("@/lib/jobLocationScraper", () => ({ scrapeJobLocationFromPosting: mocks.scrapeJobLocationFromPosting }));

import { POST } from "@/app/api/falood/applications/[id]/job-location/route";

const sessionId = "c7b9ad93-393e-4e42-8935-4365f91ec28a";
const versionId = "d89a2a5e-612f-4ce0-a6dd-4e9d4fafbdc4";
const jobId = "8c8df8cf-df77-4a1a-b96b-e44017f5b70b";
const params = { params: { id: sessionId } };
const userContext = { profile: { user_id: "staff-1", display_name: "Test Staff", email: "staff@example.com" } };
const linkedJob = {
  job_id: jobId,
  title: "Software Engineer",
  company: "Example Co",
  location: null,
  source_url: "https://jobs.example.com/role/1",
  apply_url: "https://jobs.example.com/role/1/apply",
};

function request() {
  return new NextRequest(`https://talentos.test/api/falood/applications/${sessionId}/job-location`, { method: "POST" });
}

describe("POST /api/falood/applications/[id]/job-location", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ context: userContext, response: null });
    mocks.logActivity.mockResolvedValue(undefined);
    mocks.triggerWebhooks.mockResolvedValue([]);
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM falood_saved_applications")) return { name: `application_resume_version:${versionId}` };
      if (sql.includes("FROM application_resume_versions arv")) return linkedJob;
      if (sql.startsWith("UPDATE jobs")) return { id: jobId, title: linkedJob.title, location: "Newark, New Jersey, United States" };
      return null;
    });
    mocks.scrapeJobLocationFromPosting.mockResolvedValue({
      ok: true,
      location: "Newark, New Jersey, United States",
      method: "schema_jobposting",
      sourceHost: "jobs.example.com",
    });
  });

  it("scrapes and persists a verified location only while the job location is blank", async () => {
    const response = await POST(request(), params);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, data: { location: "Newark, New Jersey, United States", alreadySaved: false } });
    expect(mocks.scrapeJobLocationFromPosting).toHaveBeenCalledWith({
      title: linkedJob.title,
      company: linkedJob.company,
      sourceUrl: linkedJob.source_url,
      applyUrl: linkedJob.apply_url,
    });
    const updateCall = mocks.queryOne.mock.calls.find(([sql]) => String(sql).startsWith("UPDATE jobs"));
    expect(updateCall?.[0]).toContain("NULLIF(BTRIM(location), '') IS NULL");
    expect(updateCall?.[1]).toContain("Newark, New Jersey, United States");
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({
      entityId: jobId,
      metadata: { fields: ["location"], sourceHost: "jobs.example.com", extractionMethod: "schema_jobposting" },
    }));
  });

  it("does not write when no explicit location was found", async () => {
    mocks.scrapeJobLocationFromPosting.mockResolvedValue({
      ok: false,
      reason: "no_explicit_location",
      message: "TalentOS could not verify an explicit job location on the posting or apply page. The job location was left blank.",
    });

    const response = await POST(request(), params);
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toMatch(/left blank/);
    expect(mocks.queryOne.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE jobs"))).toBe(false);
  });

  it("returns a location another staff member saved without scraping or overwriting it", async () => {
    mocks.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM falood_saved_applications")) return { name: `application_resume_version:${versionId}` };
      if (sql.includes("FROM application_resume_versions arv")) return { ...linkedJob, location: "Austin, Texas, United States" };
      return null;
    });

    const response = await POST(request(), params);
    expect(await response.json()).toMatchObject({ success: true, data: { location: "Austin, Texas, United States", alreadySaved: true } });
    expect(mocks.scrapeJobLocationFromPosting).not.toHaveBeenCalled();
    expect(mocks.queryOne.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE jobs"))).toBe(false);
  });

  it("rejects unauthenticated requests before reading or changing job data", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ context: null, response: new Response(null, { status: 401 }) });
    const response = await POST(request(), params);
    expect(response.status).toBe(401);
    expect(mocks.queryOne).not.toHaveBeenCalled();
    expect(mocks.scrapeJobLocationFromPosting).not.toHaveBeenCalled();
  });
});
