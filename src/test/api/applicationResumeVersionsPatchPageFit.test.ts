// Regression coverage for the Application Queue's stale "2-page overflow"
// badge: this PATCH route is what Falood Studio's saveDraft() calls when an
// AE manually edits a resume. It must re-measure page_fit_metrics from the
// content actually being saved, deterministically and with no AI tokens,
// instead of leaving whatever was stored before the edit - see
// resumePageFitMeasurement.ts.

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
  DESTRUCTIVE_MANAGER_ROLES: ["admin", "manager"],
}));
vi.mock("@/lib/activity", () => ({ logActivity: mocks.logActivity }));
vi.mock("@/lib/falood/resumePageFitMeasurement", () => ({
  measureResumePageFitMetrics: mocks.measureResumePageFitMetrics,
}));

import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/application-resume-versions/[id]/route";

const NEW_CONTENT = { header: { fullName: "Candidate" }, skills: [], experience: [], education: [] };
const FRESH_PAGE_FIT = { pageCount: 1, contentUtilization: 0.9, overflow: false, readable: true, recommendation: "pass" };

function req(id: string, body: unknown) {
  return new NextRequest(`https://talentos.test/api/application-resume-versions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({
    context: { profile: { user_id: "ae-1", display_name: "AE One" } },
    response: null,
  });
  mocks.queryOne.mockResolvedValue({ id: "rv-1", content: NEW_CONTENT, page_fit_metrics: FRESH_PAGE_FIT });
});

describe("PATCH /api/application-resume-versions/[id] - page fit recompute", () => {
  it("re-measures and saves fresh page_fit_metrics when content is edited and saved", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(FRESH_PAGE_FIT);

    const res = await PATCH(req("rv-1", { content: NEW_CONTENT }), { params: { id: "rv-1" } });

    expect(res.status).toBe(200);
    expect(mocks.measureResumePageFitMetrics).toHaveBeenCalledWith(NEW_CONTENT);
    const [sql, values] = mocks.queryOne.mock.calls[0];
    expect(sql).toContain("page_fit_metrics");
    expect(values).toContain(FRESH_PAGE_FIT);
  });

  it("leaves page_fit_metrics out of the SET clause when measurement fails, rather than nulling a previously-good value", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(undefined);

    const res = await PATCH(req("rv-1", { content: NEW_CONTENT }), { params: { id: "rv-1" } });

    expect(res.status).toBe(200);
    const [sql] = mocks.queryOne.mock.calls[0];
    expect(sql).not.toContain("page_fit_metrics");
  });

  it("does not call the measurer at all for a save that doesn't touch content (e.g. status-only)", async () => {
    const res = await PATCH(req("rv-1", { status: "in_review" }), { params: { id: "rv-1" } });

    expect(res.status).toBe(200);
    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
    const [sql] = mocks.queryOne.mock.calls[0];
    expect(sql).not.toContain("page_fit_metrics");
  });
});
