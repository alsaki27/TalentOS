// Coverage for GET /api/job-ceo/seen-external-ids — lets a source-enumerating
// script skip re-fetching a job's detail page when it already knows (from a
// prior run) that the job's signature is already recorded, rather than
// discovering that only after paying for the HTTP request.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/server/db/neon", () => ({ query: mocks.query }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/job-ceo/seen-external-ids/route";

function req(qs: string) {
  return new NextRequest(`https://talentos.test/api/job-ceo/seen-external-ids${qs}`, {
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOB_CEO_INGEST_SECRET = "test-secret";
});

describe("GET /api/job-ceo/seen-external-ids", () => {
  it("rejects with 401 when the bearer secret is missing or wrong", async () => {
    const res = await GET(new NextRequest("https://talentos.test/api/job-ceo/seen-external-ids?source=actalent"));
    expect(res.status).toBe(401);
  });

  it("requires a source query param", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("rejects a source containing LIKE-wildcard characters", async () => {
    const res = await GET(req("?source=act%25alent"));
    expect(res.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("strips the id:{source}: prefix and returns the bare external_job_ids", async () => {
    mocks.query.mockResolvedValue([
      { signature: "id:actalent:jp-006260691" },
      { signature: "id:actalent:jp-006274238" },
    ]);
    const res = await GET(req("?source=actalent"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.source).toBe("actalent");
    expect(body.count).toBe(2);
    expect(body.external_job_ids.sort()).toEqual(["jp-006260691", "jp-006274238"]);

    // Confirms the query actually scopes by source prefix, not a bare LIKE '%'.
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ["id:actalent:%"]);
  });

  it("lower-cases the source before building the prefix", async () => {
    mocks.query.mockResolvedValue([]);
    await GET(req("?source=Actalent"));
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), ["id:actalent:%"]);
  });

  it("returns an empty list rather than erroring when nothing has been seen yet", async () => {
    mocks.query.mockResolvedValue([]);
    const res = await GET(req("?source=broadstaff"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.external_job_ids).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("returns 500 with the error message when the query fails", async () => {
    mocks.query.mockRejectedValue(new Error("connection refused"));
    const res = await GET(req("?source=actalent"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("connection refused");
  });
});
