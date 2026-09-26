import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, queryOneMock, executeMock, transactionMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  queryOneMock: vi.fn(),
  executeMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({
  query: queryMock,
  queryOne: queryOneMock,
  execute: executeMock,
  sql: () => ({ transaction: transactionMock }),
}));

import {
  claimNextPendingWorkflow,
  claimWorkflowById,
  closeOrphanedStageRuns,
} from "@/server/repositories/applicationAiWorkflowRepository";

describe("application AI workflow stale-claim recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue([]);
    executeMock.mockResolvedValue({ rowCount: 0 });
    transactionMock.mockImplementation(async (callback) => {
      const descriptors = callback({ query: (text: string, params: unknown[]) => ({ text, params }) });
      return descriptors.map((descriptor: { text: string }) => descriptor.text.includes("UPDATE application_ai_workflows") ? [] : []);
    });
  });

  it("does not reclaim a live lease solely because its heartbeat is stale", async () => {
    await claimNextPendingWorkflow();

    const [lockQuery, claimQuery] = transactionMock.mock.calls[0]?.[0]({ query: (text: string, params: unknown[]) => ({ text, params }) });
    expect(claimQuery.text).toMatch(
      /WHERE \(status = 'running'\s+AND \(claim_expires_at IS NULL OR claim_expires_at < NOW\(\)\)\s+AND \(heartbeat_at IS NULL OR heartbeat_at < NOW\(\)/,
    );
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(lockQuery.text).toContain("pg_advisory_xact_lock");
    expect(claimQuery.text).toMatch(/active_count/);
    expect(claimQuery.text.match(/SELECT n FROM active_count/g)).toHaveLength(2);
  });

  it("serializes manual claims and applies the concurrency cap to stale running claims", async () => {
    await claimWorkflowById("workflow-id");

    expect(transactionMock).toHaveBeenCalledTimes(1);
    const callback = transactionMock.mock.calls[0]?.[0];
    const descriptors = callback({ query: (text: string, params: unknown[]) => ({ text, params }) });
    expect(descriptors[0].text).toContain("pg_advisory_xact_lock");
    expect(descriptors[1].text).toMatch(/ac\.n < c\.workflow_max_concurrency/);
  });

  it("does not close an in-flight stage while its workflow lease is still valid", async () => {
    await closeOrphanedStageRuns();

    const sql = executeMock.mock.calls[0]?.[0] as string;
    expect(sql).toMatch(/w\.claim_expires_at IS NULL OR w\.claim_expires_at < NOW\(\)/);
    expect(sql).toMatch(/AND \(w\.heartbeat_at IS NULL OR w\.heartbeat_at < NOW\(\)/);
  });
});
