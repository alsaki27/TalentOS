// Coverage for a representative bulk-import path (ATS pull). Confirms a
// duplicate row (by apply-link fingerprint) is excluded from the insert and
// counted as skipped, while a genuinely new row is inserted, matching the
// same createJobs() contract every bulk-import route now shares.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  fetchAtsJobs: vi.fn(),
  createJobs: vi.fn(),
  syncCompanyDirectoryFromJobs: vi.fn().mockResolvedValue(undefined),
  notifyBatchDuplicateSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
  MASTER_DATA_MANAGER_ROLES: ["admin", "manager"],
}));
vi.mock("@/lib/atsFetchers", () => ({
  fetchAtsJobs: mocks.fetchAtsJobs,
}));
vi.mock("@/server/repositories/jobsRepository", () => ({
  createJobs: mocks.createJobs,
}));
vi.mock("@/lib/companyDirectory", () => ({
  syncCompanyDirectoryFromJobs: mocks.syncCompanyDirectoryFromJobs,
}));
vi.mock("@/lib/jobDuplicateNotify", () => ({
  notifyBatchDuplicateSummary: mocks.notifyBatchDuplicateSummary,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/import/ats/route";

function req(body: Record<string, unknown>) {
  return new NextRequest("https://talentos.test/api/import/ats", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "user-1" } }, response: null });
});

describe("POST /api/import/ats — duplicate blocking", () => {
  it("excludes a duplicate row from the insert while inserting a genuinely new one", async () => {
    mocks.fetchAtsJobs.mockResolvedValue([
      { title: "Already Known Role", company: "Acme", apply_url: "https://acme.com/jobs/1" },
      { title: "Brand New Role", company: "Acme", apply_url: "https://acme.com/jobs/2" },
    ]);
    const existing = { id: "job-1", title: "Already Known Role (older wording)", company: "Acme", created_at: "2026-01-01T00:00:00Z" };
    mocks.createJobs.mockResolvedValue({
      inserted: [{ id: "job-2", title: "Brand New Role", company: "Acme" }],
      duplicates: [{ input: { title: "Already Known Role", company: "Acme", apply_url: "https://acme.com/jobs/1" }, existing, fingerprint: "acme.com/jobs/1" }],
    });

    const res = await POST(req({ provider: "greenhouse", token: "acme" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(1);
    expect(mocks.notifyBatchDuplicateSummary).toHaveBeenCalledTimes(1);
    const summaryArg = mocks.notifyBatchDuplicateSummary.mock.calls[0][0];
    expect(summaryArg.duplicates[0].existing.id).toBe("job-1");
  });

  it("imports every row and sends no summary when nothing is a duplicate", async () => {
    mocks.fetchAtsJobs.mockResolvedValue([{ title: "New Role", company: "Acme", apply_url: "https://acme.com/jobs/3" }]);
    mocks.createJobs.mockResolvedValue({ inserted: [{ id: "job-3", title: "New Role", company: "Acme" }], duplicates: [] });

    const res = await POST(req({ provider: "greenhouse", token: "acme" }));
    const body = await res.json();

    expect(body.imported).toBe(1);
    expect(body.skipped).toBe(0);
    expect(mocks.notifyBatchDuplicateSummary).not.toHaveBeenCalled();
  });
});
