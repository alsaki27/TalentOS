// Regression coverage for claimRecoveryRetryBatch's query shape — the
// actual eligibility logic (backoff timing, max attempts, age window) lives
// in SQL, so this pins the exact parameters sent rather than re-deriving
// the SQL's behavior in JS.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
}));

import { claimRecoveryRetryBatch } from "@/server/repositories/jobCeoStagingRepository";

describe("claimRecoveryRetryBatch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes maxAttempts, eligibleWindowDays, and limit as positional parameters", async () => {
    await claimRecoveryRetryBatch(3, 14, 10);

    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(params).toEqual([3, 14, 10]);
    expect(sql).toMatch(/stage = 'no_description'/);
    expect(sql).toMatch(/source_url IS NOT NULL/);
    expect(sql).toMatch(/recovery_retry_count < \$1/);
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/);
  });

  it("claims via claimed_at/claim_expires_at, the same columns normal stage-claiming uses", async () => {
    await claimRecoveryRetryBatch(3, 14, 10);
    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/claimed_at = NOW\(\)/);
    expect(sql).toMatch(/claim_expires_at = NOW\(\) \+ INTERVAL '5 minutes'/);
  });
});
