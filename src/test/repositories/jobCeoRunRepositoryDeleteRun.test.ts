// Regression coverage for the Adzuna recovery-queue plan's Phase 1 fix
// (2026-10-25): deleteRun() used to let job_ceo_staging's ON DELETE CASCADE
// foreign key (to job_ceo_runs) permanently destroy every no_description
// row for the run being deleted — including the raw Adzuna payload those
// rows exist specifically to preserve. It now detaches them (run_id = NULL)
// before anything else runs, so neither its own explicit DELETE nor the
// cascade can reach them.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
}));

import { deleteRun } from "@/server/repositories/jobCeoRunRepository";

const runId = "11111111-1111-1111-1111-111111111111";

describe("jobCeoRunRepository.deleteRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
  });

  it("detaches no_description rows (run_id = NULL) as its very first action", async () => {
    await deleteRun(runId);

    expect(mocks.execute.mock.calls[0][0]).toMatch(
      /UPDATE job_ceo_staging SET run_id = NULL WHERE run_id = \$1 AND stage = 'no_description'/
    );
    expect(mocks.execute.mock.calls[0][1]).toEqual([runId]);
  });

  it("orders the detach before the staging delete, and the staging delete before the run delete", async () => {
    await deleteRun(runId);

    const executedSql = mocks.execute.mock.calls.map((call) => call[0] as string);
    const detachIdx = executedSql.findIndex((sql) => sql.includes("run_id = NULL"));
    const stagingDeleteIdx = executedSql.findIndex((sql) => /DELETE FROM job_ceo_staging WHERE run_id = \$1/.test(sql));
    const runDeleteIdx = executedSql.findIndex((sql) => /DELETE FROM job_ceo_runs WHERE id = \$1/.test(sql));

    expect(detachIdx).toBeGreaterThanOrEqual(0);
    expect(stagingDeleteIdx).toBeGreaterThan(detachIdx);
    expect(runDeleteIdx).toBeGreaterThan(stagingDeleteIdx);
  });

  it("still deletes logged jobs and releases their dedup signatures when present (no regression)", async () => {
    mocks.query
      .mockResolvedValueOnce([{ logged_job_id: "job-1" }])
      .mockResolvedValueOnce([{ dedup_signature: "id:adzuna:1" }]);

    await deleteRun(runId);

    const executedSql = mocks.execute.mock.calls.map((call) => call[0] as string);
    expect(executedSql.some((sql) => sql.includes("DELETE FROM jobs WHERE id IN"))).toBe(true);
    expect(executedSql.some((sql) => sql.includes("DELETE FROM job_ceo_seen_signatures WHERE signature IN"))).toBe(true);
  });

  it("does not fail when there are no logged jobs or dedup signatures to clean up", async () => {
    await expect(deleteRun(runId)).resolves.toBeUndefined();
  });
});
