import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
  sql: () => ({ query: mocks.query, transaction: mocks.transaction }),
}));

vi.mock("@/server/security/secretCrypto", () => ({
  encryptSecret: vi.fn(),
  decryptSecret: vi.fn(),
  isEncryptionAvailable: () => false,
}));

import { reserveTokenAtomically } from "@/server/repositories/jobAgentTokenRepository";

describe("Apify token reservation serialization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.query.mockImplementation((text: string, params: unknown[] = []) => ({ __sql: { text, params } }));
    mocks.transaction.mockResolvedValue([[], []]);
  });

  test("takes the transaction-scoped allocator lock before selecting a token", async () => {
    await reserveTokenAtomically({
      reservationKey: "test-reservation",
      businessDate: "2026-11-01",
      amountUsd: 0.01,
    });

    const [statements] = mocks.transaction.mock.calls[0];
    expect(statements).toHaveLength(2);
    expect(statements[0].__sql.text).toContain("pg_advisory_xact_lock");
    expect(statements[1].__sql.text).toContain("FOR UPDATE OF t SKIP LOCKED");
    expect(statements[1].__sql.text).toContain("WITH expired AS");
  });
});
