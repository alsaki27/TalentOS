// Regression coverage for the Application Queue's stale "2-page overflow"
// badge: updateApplicationResumeVersion() is the shared repository function
// behind the resume-drafts PATCH route and the suggestion bulk-apply flow.
// It must re-measure page_fit_metrics itself whenever content changes,
// rather than trusting a caller that (today) never supplies one - see
// resumePageFitMeasurement.ts and applicationResumeVersionsRepository.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
  measureResumePageFitMetrics: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({
  query: mocks.query,
  queryOne: mocks.queryOne,
  execute: mocks.execute,
}));
vi.mock("@/lib/falood/resumePageFitMeasurement", () => ({
  measureResumePageFitMetrics: mocks.measureResumePageFitMetrics,
}));

import { updateApplicationResumeVersion } from "@/server/repositories/applicationResumeVersionsRepository";

const NEW_CONTENT = { header: { fullName: "Candidate" }, skills: [], experience: [], education: [] };
const FRESH_PAGE_FIT = { pageCount: 1, contentUtilization: 0.9, overflow: false, readable: true, recommendation: "pass" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryOne.mockResolvedValue({ id: "rv-1" });
});

describe("updateApplicationResumeVersion - page fit recompute", () => {
  it("persists the freshly measured page_fit_metrics when content is part of the update", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(FRESH_PAGE_FIT);

    await updateApplicationResumeVersion("rv-1", { content: NEW_CONTENT });

    expect(mocks.measureResumePageFitMetrics).toHaveBeenCalledWith(NEW_CONTENT);
    const [sql, values] = mocks.queryOne.mock.calls[0];
    expect(sql).toContain("page_fit_metrics");
    expect(values).toContain(FRESH_PAGE_FIT);
  });

  it("leaves page_fit_metrics out of the update when measurement fails, instead of nulling it", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(undefined);

    await updateApplicationResumeVersion("rv-1", { content: NEW_CONTENT });

    const [sql] = mocks.queryOne.mock.calls[0];
    expect(sql).not.toContain("page_fit_metrics");
  });

  it("overrides an explicit caller-supplied page_fit_metrics when content also changes (server measurement wins)", async () => {
    mocks.measureResumePageFitMetrics.mockReturnValue(FRESH_PAGE_FIT);
    const staleCallerValue = { pageCount: 2, overflow: true };

    await updateApplicationResumeVersion("rv-1", { content: NEW_CONTENT, page_fit_metrics: staleCallerValue });

    const [, values] = mocks.queryOne.mock.calls[0];
    expect(values).toContain(FRESH_PAGE_FIT);
    expect(values).not.toContain(staleCallerValue);
  });

  it("does not touch page_fit_metrics or call the measurer when content is not part of the update", async () => {
    await updateApplicationResumeVersion("rv-1", { status: "approved" });

    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
    const [sql] = mocks.queryOne.mock.calls[0];
    expect(sql).not.toContain("page_fit_metrics");
  });

  it("still honors an explicit page_fit_metrics when content is absent (unchanged pre-existing behavior)", async () => {
    const explicitValue = { pageCount: 1, overflow: false };

    await updateApplicationResumeVersion("rv-1", { page_fit_metrics: explicitValue });

    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
    const [sql, values] = mocks.queryOne.mock.calls[0];
    expect(sql).toContain("page_fit_metrics");
    expect(values).toContain(explicitValue);
  });
});
