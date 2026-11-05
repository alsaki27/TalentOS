import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/neon", () => ({
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue({ total: 0 }),
  execute: vi.fn(),
}));

import { query, queryOne } from "@/server/db/neon";
import { listApplicationQueue } from "@/server/repositories/applicationsRepository";
import { parseQueueSort } from "@/lib/applicationQueueFilters";

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

    expect(countAndStatsSql).toHaveLength(1);
    expect(countAndStatsSql[0]).toContain('AS "ae_review"');
    expect(countAndStatsSql[0]).toContain('AS "failed"');
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

  it("uses the filtered view count and a shared cutoff for a half-hour activity window", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ all: 4, ae_review: 2, failed: 1 });
    const before = Date.now();
    const result = await listApplicationQueue({ view: "ae_review", timeWindowMinutes: 30 });
    const [rowsSql, rowsParams] = vi.mocked(query).mock.calls[0];
    const [countsSql, countsParams] = vi.mocked(queryOne).mock.calls[0];
    const cutoff = Date.parse(String(rowsParams?.[12]));
    expect(cutoff).toBeGreaterThanOrEqual(before - 30 * 60_000);
    expect(cutoff).toBeLessThanOrEqual(Date.now() - 30 * 60_000);
    expect(countsParams).toEqual(rowsParams?.slice(0, -2));
    expect(rowsSql).toContain("review_entry.pending_since >= settings.cutoff");
    expect(countsSql).toContain("w.updated_at >= settings.cutoff");
    expect(result.total).toBe(2);
    expect(result.stats).toMatchObject({ all: 4, pendingAeReview: 2, failed: 1 });
  });

  it.each([
    [undefined, "DESC"],
    ["ae_review_pending_newest", "DESC"],
    ["ae_review_pending", "ASC"],
    ["unknown", "DESC"],
  ])("sorts AE review entries for %s before pagination (%s)", async (requestedSort, direction) => {
    await listApplicationQueue({ page: 2, pageSize: 25, sort: parseQueueSort(requestedSort) });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain(`ORDER BY CASE WHEN COALESCE(a.application_stage, a.ae_stage) = 'ready_for_review' THEN 0 ELSE 1 END,
      review_entry.pending_since ${direction} NULLS LAST`);
    expect(sql).toMatch(/a\.id ASC\s+OFFSET \$16 LIMIT \$17/);
    expect(params?.slice(-2)).toEqual([25, 25]);
    // Re-entering review starts a new wait; a same-stage update must not.
    expect(sql).toContain("h.to_stage = 'ready_for_review'");
    expect(sql).toContain("h.from_stage IS DISTINCT FROM h.to_stage");
    expect(sql).toContain("ORDER BY h.changed_at DESC LIMIT 1");
    expect(sql).toMatch(/a\.ae_stage_updated_at,\s*CASE WHEN a\.application_stage = 'ready_for_review' THEN a\.application_stage_changed_at END,\s*a\.created_at/);
  });

  it("changes only row ordering when selecting oldest instead of newest", async () => {
    const filters = { view: "ae_review", stage: "ready_for_review", candidateId: "candidate-1", owner: "ae-1", fitScoreBand: "8_10", timeWindowMinutes: 30 };
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T01:00:00Z"));
    try {
      await listApplicationQueue({ ...filters, sort: "ae_review_pending_newest" });
      await listApplicationQueue({ ...filters, sort: "ae_review_pending" });
      const rows = vi.mocked(query).mock.calls;
      const counts = vi.mocked(queryOne).mock.calls;
      expect(rows[0][1]).toEqual(rows[1][1]);
      expect(rows[0][0].replace("pending_since DESC NULLS LAST", "pending_since ASC NULLS LAST")).toBe(rows[1][0]);
      expect(counts[0]).toEqual(counts[1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the current canonical stage for pending membership, falling back for legacy tickets", async () => {
    await listApplicationQueue({ view: "ae_review", stage: "ready_for_review" });
    const [rowsSql] = vi.mocked(query).mock.calls[0];
    const [countsSql] = vi.mocked(queryOne).mock.calls[0];
    for (const sql of [rowsSql, countsSql]) {
      expect(sql).toContain("COALESCE(a.application_stage, a.ae_stage) = 'ready_for_review'");
      expect(sql).toContain("($8 = '' OR COALESCE(a.application_stage, a.ae_stage) = $8)");
      expect(sql).not.toContain("AND a.ae_stage = 'ready_for_review'");
    }
  });

  it.each(["final_score", "average_score"] as const)("retains both score directions for %s", async (sort) => {
    for (const direction of ["asc", "desc"] as const) {
      await listApplicationQueue({ sort, sortDirection: direction });
      const [sql] = vi.mocked(query).mock.calls.at(-1)!;
      expect(sql).toContain(`ORDER BY ${sort === "final_score" ? "workflow_score" : "average_score"} ${direction.toUpperCase()} NULLS LAST`);
    }
  });
});
