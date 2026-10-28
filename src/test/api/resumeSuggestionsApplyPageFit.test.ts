// Regression coverage for the Application Queue's stale "2-page overflow"
// badge: this route applies an accepted/customized suggestion directly to
// application_resume_versions.content via raw SQL, bypassing the repository
// layer entirely. It must re-measure page_fit_metrics itself and COALESCE
// to the existing value when measurement can't run, rather than leaving a
// stale value in place - see resumePageFitMeasurement.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  requireCurrentUser: vi.fn(),
  logActivity: vi.fn(),
  measureResumePageFitMetrics: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/lib/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
  APPLICATION_WORKER_ROLES: ["admin", "manager", "application_engineer"],
}));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/falood/resumePageFitMeasurement", () => ({
  measureResumePageFitMetrics: mocks.measureResumePageFitMetrics,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/resume-suggestions/[id]/apply/route";

const SUGGESTION = {
  id: "sugg-1",
  application_resume_id: "rv-1",
  target_block_id: null,
  original_text: "Old summary text",
  suggested_text: "New summary text",
};
const CONTENT = { summary: { id: "s1", text: "Old summary text" } };
const FRESH_PAGE_FIT = { pageCount: 1, overflow: false, readable: true, recommendation: "pass" };

function req(id: string, body: unknown) {
  return new NextRequest(`https://talentos.test/api/resume-suggestions/${id}/apply`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({
    context: { profile: { user_id: "ae-1", display_name: "AE One" } },
    response: null,
  });
  mocks.execute.mockResolvedValue({ rowCount: 1 });
  mocks.queryOne.mockImplementation((sql: string) => {
    if (sql.includes("FROM resume_suggestions")) return Promise.resolve({ ...SUGGESTION });
    if (sql.includes("FROM application_resume_versions")) return Promise.resolve({ content: structuredClone(CONTENT) });
    throw new Error(`Unexpected queryOne call in this test: ${sql}`);
  });
});

describe("POST /api/resume-suggestions/[id]/apply - page fit recompute", () => {
  it("re-measures page fit from the post-replacement content and saves it alongside the accepted suggestion", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(FRESH_PAGE_FIT);

    const res = await POST(req("sugg-1", { decision: "accept" }), { params: { id: "sugg-1" } });

    expect(res.status).toBe(200);
    expect(mocks.measureResumePageFitMetrics).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.objectContaining({ text: "New summary text" }) })
    );
    const contentUpdateCall = mocks.execute.mock.calls.find(([sql]) => sql.includes("SET content"));
    expect(contentUpdateCall![0]).toContain("COALESCE($2::jsonb, page_fit_metrics)");
    expect(contentUpdateCall![1]).toEqual(expect.arrayContaining([FRESH_PAGE_FIT]));
  });

  it("passes null (not the stale value) so COALESCE preserves the existing column when measurement fails", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(undefined);

    const res = await POST(req("sugg-1", { decision: "accept" }), { params: { id: "sugg-1" } });

    expect(res.status).toBe(200);
    const contentUpdateCall = mocks.execute.mock.calls.find(([sql]) => sql.includes("SET content"));
    expect(contentUpdateCall![1]).toEqual(expect.arrayContaining([null]));
  });

  it("does not touch resume content or call the measurer when rejecting a suggestion", async () => {
    const res = await POST(req("sugg-1", { decision: "reject" }), { params: { id: "sugg-1" } });

    expect(res.status).toBe(200);
    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
    expect(mocks.execute.mock.calls.some(([sql]) => sql.includes("SET content"))).toBe(false);
  });
});
