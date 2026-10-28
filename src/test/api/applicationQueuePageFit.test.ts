// Regression coverage for the Application Queue's "not real-time" gap: the
// existing 6s active-workflows poller never refreshes page_fit_metrics, so
// an already-open Queue page never saw a resume edit saved from Falood
// Studio reflected in the overflow badge. This endpoint is what the new
// page-fit poller (application-queue/page.tsx) calls to pick it up live.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ query: mocks.query }));
vi.mock("@/lib/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/application-queue/page-fit/route";

function req(ids: string) {
  return new NextRequest(`https://talentos.test/api/application-queue/page-fit?ids=${ids}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ context: { profile: { user_id: "ae-1" } }, response: null });
});

describe("GET /api/application-queue/page-fit", () => {
  it("requires an authenticated session", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ context: null, response: new Response(null, { status: 401 }) });

    const res = await GET(req("app-1"));

    expect(res.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("queries only the requested application ids and returns their fresh page-fit fields", async () => {
    const rows = [
      { id: "app-1", one_page_fit_score: 90, page_fit_metrics: { pageCount: 1, overflow: false } },
      { id: "app-2", one_page_fit_score: 40, page_fit_metrics: { pageCount: 2, overflow: true } },
    ];
    mocks.query.mockResolvedValue(rows);

    const res = await GET(req("app-1,app-2"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items).toEqual(rows);
    const [sql, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("= ANY($1::uuid[])");
    expect(params).toEqual([["app-1", "app-2"]]);
  });

  it("returns an empty list without querying the database when no ids are given", async () => {
    const res = await GET(req(""));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.items).toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("caps the id list at 200 instead of forwarding an unbounded array to the query", async () => {
    mocks.query.mockResolvedValue([]);
    const manyIds = Array.from({ length: 250 }, (_, i) => `app-${i}`).join(",");

    await GET(req(manyIds));

    const [, params] = mocks.query.mock.calls[0];
    expect((params[0] as string[]).length).toBe(200);
  });
});
