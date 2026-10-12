// Coverage for GET /api/candidates — specifically the default placed/dropped
// exclusion: most day-to-day work happens on the still-active roster, so
// those two pipeline stages are hidden unless a tick box opts one back in,
// or the stage dropdown asks for exactly one stage explicitly. No coverage
// existed for this route before.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));

vi.mock("@/server/db/neon", () => ({ query: mocks.query, queryOne: mocks.queryOne }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/candidates/route";

function req(qs = "") {
  return new NextRequest(`https://talentos.test/api/candidates${qs}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue({ total: 0 });
});

describe("GET /api/candidates", () => {
  it("hides placed and dropped by default, with no stage filter applied", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    const [dataSql, dataParams] = mocks.query.mock.calls[0];
    const [countSql, countParams] = mocks.queryOne.mock.calls[0];
    // $6 is now the has_contract filter (migration 117), which pushed
    // offset/limit/hidden-stages each one slot further right than before.
    expect(dataSql).toContain("c.pipeline_stage <> ALL($9::text[])");
    expect(countSql).toContain("pipeline_stage <> ALL($7::text[])");
    // pipelineStage ($5) is the 5th positional param in both queries.
    expect(dataParams[4]).toBe("");
    expect(countParams[4]).toBe("");
    expect(dataParams[8]).toEqual(["placed", "dropped"]);
    expect(countParams[6]).toEqual(["placed", "dropped"]);
  });

  it("opting one group back in only un-hides that group", async () => {
    await GET(req("?showPlaced=1"));
    expect(mocks.query.mock.calls[0][1][8]).toEqual(["dropped"]);

    vi.clearAllMocks();
    mocks.query.mockResolvedValue([]);
    mocks.queryOne.mockResolvedValue({ total: 0 });

    await GET(req("?showDropped=1"));
    expect(mocks.query.mock.calls[0][1][8]).toEqual(["placed"]);
  });

  it("un-hides both when both boxes are ticked", async () => {
    await GET(req("?showPlaced=1&showDropped=1"));
    expect(mocks.query.mock.calls[0][1][8]).toEqual([]);
  });

  it("an explicit single-stage filter is not blocked by the default exclusion, even with both boxes unticked", async () => {
    await GET(req("?pipelineStage=placed"));
    const [, params] = mocks.query.mock.calls[0];
    // pipelineStage itself ($5) carries the explicit choice; the SQL's
    // "$5 <> '' OR ..." short-circuits the hidden-stages check once this is set.
    expect(params[4]).toBe("placed");
  });
});
