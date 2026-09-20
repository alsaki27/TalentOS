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
  recordJobIdentities: vi.fn(),
}));

vi.mock("@/server/services/jobContentDuplicateGuard", () => ({
  checkContentDuplicate: vi.fn(),
  checkContentDuplicatesBatch: vi.fn(),
  recordDuplicateForReview: vi.fn(),
  CONTENT_IDENTITY_MATCH_SCORE: 0.95,
  TITLE_LOCATION_MATCH_SCORE: 0.85,
}));

import { query, queryOne } from "@/server/db/neon";
import { checkJobDuplicate, checkJobDuplicatesBatch } from "@/server/services/jobDuplicateGuard";
import { checkContentDuplicate, checkContentDuplicatesBatch, recordDuplicateForReview } from "@/server/services/jobContentDuplicateGuard";
import { createJob, createJobs, createJobFromParsedJD } from "@/server/repositories/jobsRepository";

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
      contentIdentityKey:
        "guidepoint security::application security engineer mid atlantic region remote in va md pa nc de nj or dc::remote",
      titleLocationKey: "application security engineer mid atlantic region remote in va md pa nc de nj or dc::remote",
      existing: ORIGINAL,
      score: 0.95,
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
    // The hide must be auditable/reversible: it is queued in job_duplicates,
    // keyed off the id the DB actually returned, not the pre-insert object.
    expect(recordDuplicateForReview).toHaveBeenCalledWith("job-linkedin-1", "job-indeed-2", 0.95);
  });

  it("does not queue anything for review when the row was not stored as a duplicate", async () => {
    (checkContentDuplicate as any).mockResolvedValue({ isContentDuplicate: false, contentIdentityKey: "a::b::c", titleLocationKey: "b::c" });
    (queryOne as any).mockResolvedValue({ id: "job-new", is_active: true, content_duplicate_of: null });

    await createJob({ title: "Brand New Role", company: "Some Co" });

    expect(recordDuplicateForReview).not.toHaveBeenCalled();
  });

  it("leaves is_active untouched when no content duplicate is found", async () => {
    (checkContentDuplicate as any).mockResolvedValue({ isContentDuplicate: false, contentIdentityKey: "a::b::c", titleLocationKey: "b::c" });
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
      {
        isContentDuplicate: true,
        contentIdentityKey: "guidepoint security::application security engineer::remote",
        titleLocationKey: "application security engineer::remote",
        existing: ORIGINAL,
        score: 0.95,
      },
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

describe("createJobFromParsedJD — no longer bypasses the content layer", () => {
  it("runs the content check and stamps both identity keys, like every other creator", async () => {
    // It used to carry its own INSERT with an explicit column list that omitted
    // content_identity_key, and never called the content guard at all - so every
    // pasted-JD job was permanently invisible to cross-platform matching, both as
    // a candidate and as something a later capture could match against.
    (checkContentDuplicate as any).mockResolvedValue({
      isContentDuplicate: false,
      contentIdentityKey: "acme::fiber engineer::austin",
      titleLocationKey: "fiber engineer::austin",
    });
    let insertedCols: string[] = [];
    (queryOne as any).mockImplementation((sql: string, values: any[]) => {
      insertedCols = sql.match(/INSERT INTO jobs \(([^)]+)\)/)?.[1].split(", ") ?? [];
      const row: Record<string, unknown> = {};
      insertedCols.forEach((c, i) => (row[c] = values[i]));
      return Promise.resolve({ id: "job-from-jd", ...row });
    });

    const outcome = await createJobFromParsedJD({
      title: "Fiber Engineer",
      company: "Acme",
      location: "Austin, TX",
      apply_url: "https://careers.acme.com/jobs/884213",
    });

    expect(checkContentDuplicate).toHaveBeenCalledTimes(1);
    expect(insertedCols).toContain("content_identity_key");
    expect(insertedCols).toContain("title_location_key");
    expect(outcome.status).toBe("created");
    if (outcome.status === "created") {
      expect(outcome.job.content_identity_key).toBe("acme::fiber engineer::austin");
      expect(outcome.job.title_location_key).toBe("fiber engineer::austin");
    }
  });

  it("is blocked by the exact-identity layer just like createJob", async () => {
    (checkJobDuplicate as any).mockResolvedValue({
      isDuplicate: true,
      fingerprint: "careers.acme.com:884213",
      existing: ORIGINAL,
    });

    const outcome = await createJobFromParsedJD({
      title: "Fiber Engineer",
      company: "Acme",
      apply_url: "https://careers.acme.com/jobs/884213",
    });

    expect(outcome.status).toBe("duplicate");
    expect(queryOne).not.toHaveBeenCalled();
  });
});
