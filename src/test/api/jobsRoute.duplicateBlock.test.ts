// Coverage for the highest-traffic interactive job-creation path: the admin
// "Add Job" form (POST /api/jobs). Confirms a real apply-link duplicate is
// blocked with a 409 carrying the documented payload shape, and a
// genuinely new job is created normally.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  createJob: vi.fn(),
  syncCompanyDirectoryFromJobs: vi.fn().mockResolvedValue(undefined),
  logActivity: vi.fn().mockResolvedValue(undefined),
  triggerWebhooks: vi.fn(),
  notifyInteractiveDuplicateBlocked: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
}));
vi.mock("@/server/repositories/jobsRepository", () => ({
  createJob: mocks.createJob,
}));
vi.mock("@/lib/companyDirectory", () => ({
  syncCompanyDirectoryFromJobs: mocks.syncCompanyDirectoryFromJobs,
}));
vi.mock("@/lib/activity", () => ({
  logActivity: mocks.logActivity,
}));
vi.mock("@/lib/webhookEngine", () => ({
  triggerWebhooks: mocks.triggerWebhooks,
}));
vi.mock("@/lib/jobDuplicateNotify", () => ({
  notifyInteractiveDuplicateBlocked: mocks.notifyInteractiveDuplicateBlocked,
}));
vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/jobs/route";

const context = { profile: { user_id: "user-1", display_name: "Test Admin", email: "admin@test.com" } };

function req(body: Record<string, unknown>) {
  return new NextRequest("https://talentos.test/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context, response: null });
});

describe("POST /api/jobs — duplicate blocking", () => {
  it("blocks a job whose apply link already exists, with a 409 and the documented payload", async () => {
    const existing = { id: "job-1", title: "Existing Role", company: "Existing Co", created_at: "2026-01-01T00:00:00Z" };
    mocks.createJob.mockResolvedValue({ status: "duplicate", existing, fingerprint: "company.com/job/1" });

    const res = await POST(req({ title: "New Title, Same Link", company: "Some Co", apply_url: "https://company.com/job/1" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("duplicate_job");
    expect(body.existingJob.id).toBe("job-1");
    expect(body.attempted.title).toBe("New Title, Same Link");
    expect(mocks.notifyInteractiveDuplicateBlocked).toHaveBeenCalledTimes(1);
    expect(mocks.logActivity).not.toHaveBeenCalled();
  });

  it("creates a genuinely new job normally", async () => {
    const created = { id: "job-2", title: "Brand New Role", company: "New Co" };
    mocks.createJob.mockResolvedValue({ status: "created", job: created });

    const res = await POST(req({ title: "Brand New Role", company: "New Co", apply_url: "https://company.com/job/2" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.id).toBe("job-2");
    expect(mocks.notifyInteractiveDuplicateBlocked).not.toHaveBeenCalled();
    expect(mocks.logActivity).toHaveBeenCalledWith(expect.objectContaining({ type: "create", entityId: "job-2" }));
  });
});
