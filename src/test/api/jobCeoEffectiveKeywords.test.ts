// Coverage for GET /api/job-ceo/effective-keywords — the token-authenticated
// read path that lets a scheduled script (agency source ingesters,
// openjobdata_ingest.py) get "today's effective keyword set" (static role
// library + DB custom groups) without a staff session, which the existing
// /api/job-agent/keyword-groups and /api/job-ceo/keyword-groups routes both
// require and a GitHub Actions job cannot present.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/server/db/neon", () => ({ query: mocks.query }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/job-ceo/effective-keywords/route";

function req(qs = "") {
  return new NextRequest(`https://talentos.test/api/job-ceo/effective-keywords${qs}`, {
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOB_CEO_INGEST_SECRET = "test-secret";
  mocks.query.mockResolvedValue([
    { id: "kg-1", label: "Custom telecom", keywords: ["telecom lease consultant", "wireless tower leasing"] },
  ]);
});

describe("GET /api/job-ceo/effective-keywords", () => {
  it("rejects with 401 when the bearer secret is missing or wrong", async () => {
    const res = await GET(new NextRequest("https://talentos.test/api/job-ceo/effective-keywords"));
    expect(res.status).toBe(401);
  });

  it("rejects with 401 when JOB_CEO_INGEST_SECRET is unset (fails closed)", async () => {
    delete process.env.JOB_CEO_INGEST_SECRET;
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns every static role group by default, plus custom groups from the DB", async () => {
    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.groups.A.label).toBe("OSP / Fiber");
    expect(Array.isArray(body.groups.A.titles)).toBe(true);
    expect(body.groups.A.titles.length).toBeGreaterThan(0);
    // Every documented group id (A–R at time of writing) should be present.
    expect(Object.keys(body.groups).length).toBeGreaterThanOrEqual(18);

    expect(body.custom).toEqual([
      { id: "kg-1", label: "Custom telecom", keywords: ["telecom lease consultant", "wireless tower leasing"] },
    ]);
  });

  it("restricts to the requested role_group ids", async () => {
    const res = await GET(req("?role_group=A,C"));
    const body = await res.json();
    expect(Object.keys(body.groups).sort()).toEqual(["A", "C"]);
  });

  it("degrades to static groups (200, empty custom, error surfaced) when the DB is unreachable", async () => {
    mocks.query.mockRejectedValue(new Error("connection refused"));
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.custom).toEqual([]);
    expect(body.custom_groups_error).toContain("connection refused");
    expect(Object.keys(body.groups).length).toBeGreaterThan(0);
  });

  it("parses a JSON-string keywords column the same as an already-array column", async () => {
    mocks.query.mockResolvedValue([{ id: "kg-2", label: "Legacy row", keywords: '["fiber splicer"]' }]);
    const res = await GET(req());
    const body = await res.json();
    expect(body.custom).toEqual([{ id: "kg-2", label: "Legacy row", keywords: ["fiber splicer"] }]);
  });
});
