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

import { query, queryOne } from "@/server/db/neon";
import { checkJobDuplicate, checkJobDuplicatesBatch } from "@/server/services/jobDuplicateGuard";
import { createJob, createJobs } from "@/server/repositories/jobsRepository";

const EXISTING = {
  id: "job-1",
  title: "Existing Job",
  company: "Existing Co",
  location: "Remote",
  apply_url: "https://company.com/apply/1",
  source_url: null,
  source: "manual",
  created_at: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  // getJsonbColumns() caches its result at module scope after the first
  // call in this file (any test), so later tests can't rely on call-order
  // position to distinguish "the jsonb-columns lookup" from "the real
  // insert" - dispatch by SQL text instead, which is robust either way.
  (query as any).mockImplementation((sql: string) => {
    if (sql.includes("information_schema.columns")) return Promise.resolve([]);
    return Promise.resolve([]);
  });
});

describe("createJob", () => {
  it("inserts a genuinely new job and returns status: created", async () => {
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: "company.com/apply/2" });
    (queryOne as any).mockResolvedValue({ id: "job-2", title: "New Job" });

    const outcome = await createJob({ title: "New Job", apply_url: "https://company.com/apply/2" });

    expect(outcome).toEqual({ status: "created", job: { id: "job-2", title: "New Job" } });
    expect(queryOne).toHaveBeenCalledTimes(1);
  });

  it("does not attempt an INSERT when a duplicate is found first", async () => {
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: true, fingerprint: "company.com/apply/1", existing: EXISTING });

    const outcome = await createJob({ title: "Duplicate Attempt", apply_url: "https://company.com/apply/1" });

    expect(outcome).toEqual({ status: "duplicate", existing: EXISTING, fingerprint: "company.com/apply/1" });
    expect(queryOne).not.toHaveBeenCalled();
  });

  it("converts a unique-violation race on insert into a clean duplicate result instead of throwing", async () => {
    (checkJobDuplicate as any)
      .mockResolvedValueOnce({ isDuplicate: false, fingerprint: "company.com/apply/1" }) // pre-check missed it (race)
      .mockResolvedValueOnce({ isDuplicate: true, fingerprint: "company.com/apply/1", existing: EXISTING }); // recheck after violation
    (queryOne as any).mockRejectedValue({ code: "23505", message: "duplicate key value violates unique constraint" });

    const outcome = await createJob({ title: "Race", apply_url: "https://company.com/apply/1" });

    expect(outcome).toEqual({ status: "duplicate", existing: EXISTING, fingerprint: "company.com/apply/1" });
  });

  it("rethrows a non-unique-violation insert error", async () => {
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: null });
    (queryOne as any).mockRejectedValue({ code: "42703", message: "column does not exist" });

    await expect(createJob({ title: "Broken" })).rejects.toMatchObject({ code: "42703" });
  });

  it("skips the duplicate check entirely when the job has no apply_url or source_url", async () => {
    (queryOne as any).mockResolvedValue({ id: "job-3", title: "No Link" });

    const outcome = await createJob({ title: "No Link" });

    expect(checkJobDuplicate).not.toHaveBeenCalled();
    expect(outcome.status).toBe("created");
  });
});

describe("createJobs", () => {
  it("excludes duplicate rows from the INSERT while inserting new ones", async () => {
    (checkJobDuplicatesBatch as any).mockResolvedValue([
      { isDuplicate: true, fingerprint: "a", existing: EXISTING },
      { isDuplicate: false, fingerprint: "b" },
    ]);
    (query as any).mockImplementation((sql: string) => {
      if (sql.includes("information_schema.columns")) return Promise.resolve([]);
      if (sql.includes("INSERT INTO jobs")) return Promise.resolve([{ id: "job-new", title: "New" }]);
      return Promise.resolve([]);
    });

    const result = await createJobs([
      { title: "Dup", apply_url: "https://x.com/a" },
      { title: "New", apply_url: "https://x.com/b" },
    ]);

    expect(result.inserted).toEqual([{ id: "job-new", title: "New" }]);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].existing).toEqual(EXISTING);
  });

  it("returns an empty result without querying when every row is a duplicate", async () => {
    (checkJobDuplicatesBatch as any).mockResolvedValue([{ isDuplicate: true, fingerprint: "a", existing: EXISTING }]);

    const result = await createJobs([{ title: "Dup", apply_url: "https://x.com/a" }]);

    expect(result.inserted).toEqual([]);
    expect(result.duplicates).toHaveLength(1);
  });
});
