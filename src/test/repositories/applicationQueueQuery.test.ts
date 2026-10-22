import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue({ total: 0 }),
  execute: vi.fn(),
}));

import { query, queryOne } from "@/server/db/neon";
import { listApplicationQueue } from "@/server/repositories/applicationsRepository";

describe("application queue query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (query as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue([]);
  });

  it("projects every workflow field referenced through the lateral alias", async () => {
    await listApplicationQueue({ page: 1, pageSize: 25 });

    const queryCalls = (query as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const dataQuery = queryCalls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("w.id as workflow_id") && sql.includes("FROM application_ai_workflows"));

    expect(dataQuery).toBeDefined();
    const workflowLateral = dataQuery?.match(
      /LEFT JOIN LATERAL \(\s*SELECT ([\s\S]*?)\s+FROM application_ai_workflows[\s\S]*?\) w ON true/i,
    );
    expect(workflowLateral).toBeDefined();

    const projectedColumns = new Set(
      workflowLateral?.[1].split(",").map((column) => column.trim().toLowerCase()) ?? [],
    );
    const referencedColumns = new Set(
      [...(dataQuery?.matchAll(/\bw\.([a-z_][a-z0-9_]*)/gi) ?? [])]
        .map((match) => match[1].toLowerCase()),
    );

    expect(referencedColumns.size).toBeGreaterThan(0);
    for (const column of referencedColumns) {
      expect(projectedColumns, `workflow alias column ${column} must be selected in its lateral query`)
        .toContain(column);
    }
  });

  it("applies the selected fit score band to rows, total, and queue counts", async () => {
    await listApplicationQueue({ page: 1, pageSize: 25, fitScoreBand: "8_10" });

    const dataSql = String((query as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    const countAndStatsSql = (queryOne as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map(([sql]) => String(sql));

    expect(dataSql).toContain("ROUND(COALESCE(");
    expect(dataSql).toContain("application_qualification_fit");
    expect(dataSql).toContain(">= 8");
    expect(dataSql).toContain("<= 10");

    expect(countAndStatsSql).toHaveLength(7);
    for (const sql of countAndStatsSql) {
      expect(sql).toContain("application_qualification_fit");
      expect(sql).toContain(">= 8");
      expect(sql).toContain("<= 10");
    }
  });

  it("can isolate queue rows without a numeric fit score", async () => {
    await listApplicationQueue({ page: 1, pageSize: 25, fitScoreBand: "no_score" });

    const dataSql = String((query as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);
    const countSql = String((queryOne as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]);

    expect(dataSql).toContain("IS NULL");
    expect(countSql).toContain("IS NULL");
    expect(countSql).toContain("application_qualification_fit");
  });
});
