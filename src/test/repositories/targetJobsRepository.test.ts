// Regression coverage for upsertTargetJobByCandidateAndJob's generated SQL.
//
// Context: the ON CONFLICT DO UPDATE SET clause used to unconditionally append
// "updated_at = NOW()", but target_jobs has no updated_at column (unlike most
// other tables in this schema). Postgres validates the DO UPDATE SET target
// list at parse time, so this broke every upsert with a 500 — even on a fresh
// INSERT that never actually hits the conflict path. This guards against that
// column reference reappearing.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { queryOneMock } = vi.hoisted(() => ({
  queryOneMock: vi.fn().mockResolvedValue({ id: "target-job-1" }),
}));

vi.mock("@/server/db", () => ({
  isNeon: () => true,
}));

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: queryOneMock,
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {},
}));

import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";

describe("upsertTargetJobByCandidateAndJob", () => {
  beforeEach(() => {
    queryOneMock.mockClear();
  });

  it("does not reference a non-existent updated_at column on target_jobs", async () => {
    await upsertTargetJobByCandidateAndJob("candidate-1", "job-1", {
      raw_description: "some JD text",
      created_by: "user-1",
    });

    expect(queryOneMock).toHaveBeenCalledTimes(1);
    const [sql] = queryOneMock.mock.calls[0];
    expect(sql).not.toMatch(/updated_at/i);
  });
});
