// Integration coverage: createJob()/createJobs() must still INSERT a
// content-duplicate row (never silently drop a real job - see
// jobContentDuplicateGuard.ts for why), but mark it is_active = false with
// an auditable pointer back to the original, reusing the is_active flag
// every existing candidate-facing query already filters on rather than
// requiring any other part of the codebase to learn about a new field.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/services/jobDuplicateGuard", () => ({
  checkJobDuplicate: vi.fn(),
  checkJobDuplicatesBatch: vi.fn(),
}));

vi.mock("@/server/services/jobContentDuplicateGuard", () => ({
  checkContentDuplicate: vi.fn(),
  checkContentDuplicatesBatch: vi.fn(),
}));

import { query, queryOne } from "@/server/db/neon";
import { checkJobDuplicate, checkJobDuplicatesBatch } from "@/server/services/jobDuplicateGuard";
import { checkContentDuplicate, checkContentDuplicatesBatch } from "@/server/services/jobContentDuplicateGuard";
import { createJob, createJobs } from "@/server/repositories/jobsRepository";

const ORIGINAL = {
  id: "job-linkedin-1",
  title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
  company: "GuidePoint Security",
  location: "Remote",
  apply_url: "https://www.linkedin.com/jobs/view/4430748287",
  source_url: null,
  source: "apify:linkedin",
  created_at: "2026-09-10T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  (query as any).mockImplementation((sql: string) => {
    if (sql.includes("information_schema.columns")) return Promise.resolve([]);
    return Promise.resolve([]);
  });
  (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: null });
});

describe("createJob — cross-platform content duplicate", () => {
  it("still INSERTS the row (never silently drops a real job) but marks it is_active=false with an audit trail", async () => {
    (checkContentDuplicate as any).mockResolvedValue({
      isContentDuplicate: true,
      contentIdentityKey: "guidepoint security::application security engineer mid atlantic region remote in va md pa nc de nj or dc",
      existing: ORIGINAL,
    });
    (queryOne as any).mockImplementation((sql: string, values: any[]) => {
      const cols = sql.match(/INSERT INTO jobs \(([^)]+)\)/)?.[1].split(", ") ?? [];
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = values[i]));
      return Promise.resolve({ id: "job-indeed-2", ...row });
    });

    const outcome = await createJob({
      title: "Application Security Engineer - Mid-Atlantic region (Remote in VA, MD, PA, NC, DE, NJ, or DC)",
      company: "GuidePoint Security",
      location: "Remote",
      apply_url: "https://www.indeed.com/viewjob?jk=8763525f8fdfc1b6",
      is_active: true,
    });

    expect(outcome.status).toBe("created"); // inserted, not blocked - data is never lost
    if (outcome.status === "created") {
      expect(outcome.job.is_active).toBe(false);
      expect(outcome.job.content_duplicate_of).toBe("job-linkedin-1");
      expect(outcome.job.content_duplicate_reason).toContain("job-linkedin-1");
    }
  });

  it("leaves is_active untouched when no content duplicate is found", async () => {
    (checkContentDuplicate as any).mockResolvedValue({ isContentDuplicate: false, contentIdentityKey: "some::key" });
    (queryOne as any).mockImplementation((sql: string, values: any[]) => {
      const cols = sql.match(/INSERT INTO jobs \(([^)]+)\)/)?.[1].split(", ") ?? [];
      const row: Record<string, unknown> = {};
      cols.forEach((c, i) => (row[c] = values[i]));
      return Promise.resolve({ id: "job-new", ...row });
    });

    const outcome = await createJob({ title: "Brand New Role", company: "Some Co", is_active: true });

    expect(outcome.status).toBe("created");
    if (outcome.status === "created") expect(outcome.job.is_active).toBe(true);
  });

  it("does not call the content-duplicate check at all when a fingerprint duplicate already short-circuits", async () => {
    (checkJobDuplicate as any).mockResolvedValue({
      isDuplicate: true,
      fingerprint: "indeed:8763525f8fdfc1b6",
      existing: ORIGINAL,
    });

    const outcome = await createJob({
      title: "Application Security Engineer",
      company: "GuidePoint Security",
      apply_url: "https://www.indeed.com/viewjob?jk=8763525f8fdfc1b6",
    });

    expect(outcome.status).toBe("duplicate");
    expect(checkContentDuplicate).not.toHaveBeenCalled();
  });
});

describe("createJobs — cross-platform content duplicate", () => {
  it("inserts the whole batch but flags the content-duplicate row's is_active=false", async () => {
    (checkJobDuplicatesBatch as any).mockResolvedValue([
      { isDuplicate: false, fingerprint: "indeed:8763525f8fdfc1b6" },
    ]);
    (checkContentDuplicatesBatch as any).mockResolvedValue([
      { isContentDuplicate: true, contentIdentityKey: "guidepoint security::application security engineer", existing: ORIGINAL },
    ]);
    (query as any).mockImplementation((sql: string) => {
      if (sql.includes("information_schema.columns")) return Promise.resolve([]);
      if (sql.includes("INSERT INTO jobs")) {
        return Promise.resolve([{ id: "job-dailyremote-3", is_active: false, content_duplicate_of: "job-linkedin-1" }]);
      }
      return Promise.resolve([]);
    });

    const result = await createJobs([
      { title: "Application Security Engineer", company: "GuidePoint Security", apply_url: "https://dailyremote.com/remote-job/x-5163929" },
    ]);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0].is_active).toBe(false);
    expect(result.inserted[0].content_duplicate_of).toBe("job-linkedin-1");
  });
});
