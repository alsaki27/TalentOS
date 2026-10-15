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

import { query, queryOne } from "@/server/db/neon";
import { checkJobDuplicate, checkJobDuplicatesBatch } from "@/server/services/jobDuplicateGuard";
import { createJob, createJobs, updateJob } from "@/server/repositories/jobsRepository";

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
    // One INSERT. The duplicate layers read through query(), not queryOne().
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

  it("still inserts a job with no links at all, and reports no duplicate", async () => {
    // The identity check is now always consulted, because a capture can carry an
    // employer ATS url even when apply_url/source_url are empty. With nothing to
    // look up it resolves to "not a duplicate" without reading the database.
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: null });
    (queryOne as any).mockResolvedValue({ id: "job-3", title: "No Link" });

    const outcome = await createJob({ title: "No Link" });

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

describe("eligibility-restriction detection (zero AI cost, wired at write time)", () => {
  it("createJob tags a job whose description_text contains a citizenship/clearance requirement", async () => {
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: null });
    (queryOne as any).mockResolvedValue({ id: "job-4", title: "Cleared Role" });

    await createJob({
      title: "Cleared Role",
      description_text: "Must be a U.S. citizen with an active Secret clearance to be considered.",
    });

    const [sql, values] = (queryOne as any).mock.calls[0];
    const cols = (sql as string).match(/INSERT INTO jobs \(([^)]+)\)/)![1].split(", ");
    const get = (col: string) => values[cols.indexOf(col)];

    expect(get("eligibility_restricted")).toBe(true);
    expect(get("requires_citizenship")).toBe(true);
    expect(get("citizenship_countries")).toEqual(["United States"]);
    expect(get("export_control_restricted")).toBe(true);
    expect(get("eligibility_restriction_evidence")).toBeTruthy();
  });

  it("createJob leaves the eligibility columns at their safe defaults for an ordinary posting", async () => {
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: null });
    (queryOne as any).mockResolvedValue({ id: "job-5", title: "GIS Technician" });

    await createJob({
      title: "GIS Technician",
      description_text: "Looking for a GIS Technician with ArcGIS experience. Full benefits.",
    });

    const [sql, values] = (queryOne as any).mock.calls[0];
    const cols = (sql as string).match(/INSERT INTO jobs \(([^)]+)\)/)![1].split(", ");
    const get = (col: string) => values[cols.indexOf(col)];

    expect(get("eligibility_restricted")).toBe(false);
    expect(get("requires_citizenship")).toBe(false);
    expect(get("citizenship_countries")).toBeNull();
    expect(get("export_control_restricted")).toBe(false);
  });

  it("createJob does not add eligibility columns at all when no description_text is provided", async () => {
    (checkJobDuplicate as any).mockResolvedValue({ isDuplicate: false, fingerprint: null });
    (queryOne as any).mockResolvedValue({ id: "job-6", title: "No Description" });

    await createJob({ title: "No Description" });

    const [sql] = (queryOne as any).mock.calls[0];
    expect(sql).not.toContain("eligibility_restricted");
  });

  it("updateJob recomputes eligibility columns when description_text is part of the update", async () => {
    (queryOne as any).mockResolvedValue({ id: "job-1" });

    await updateJob("job-1", { description_text: "This role requires ITAR compliance and a Top Secret clearance." });

    const [sql, values] = (queryOne as any).mock.calls[0];
    expect(sql).toContain("eligibility_restricted = $");
    expect(sql).toContain("export_control_restricted = $");
    const setClauseKeys = (sql as string).match(/SET (.+) WHERE/)![1].split(", ").map((kv) => kv.split(" = ")[0]);
    const get = (col: string) => values[setClauseKeys.indexOf(col)];
    expect(get("export_control_restricted")).toBe(true);
  });

  it("updateJob does not touch eligibility columns when the update has nothing to do with description_text", async () => {
    (queryOne as any).mockResolvedValue({ id: "job-1" });

    await updateJob("job-1", { job_category: "OSP", category_tags: ["OSP", "Fiber"] });

    const [sql] = (queryOne as any).mock.calls[0];
    expect(sql).not.toContain("eligibility_restricted");
  });
});
