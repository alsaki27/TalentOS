// Regression coverage for the Application Queue's stale "2-page overflow"
// badge: application_resume_versions.page_fit_metrics was never recomputed
// after a manual edit (e.g. in Falood Studio), only ever set once by the AI
// finalization pipeline. measureResumePageFitMetrics() is the shared,
// deterministic (no AI tokens) helper the save paths now call to keep it
// fresh - see resumePageFitMeasurement.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  renderResumePdfWithMetrics: vi.fn(),
  normalizeResumeContentForExport: vi.fn((c: unknown) => c),
  mapMetricsToPageFit: vi.fn(),
}));

vi.mock("@/lib/falood/skarionPdfDocument", () => ({
  renderResumePdfWithMetrics: mocks.renderResumePdfWithMetrics,
}));
vi.mock("@/lib/falood/resumeDocumentAdapters", () => ({
  normalizeResumeContentForExport: mocks.normalizeResumeContentForExport,
}));
vi.mock("@/lib/falood/pageFitThresholds", () => ({
  mapMetricsToPageFit: mocks.mapMetricsToPageFit,
}));

import { measureResumePageFitMetrics } from "@/lib/falood/resumePageFitMeasurement";

const SAMPLE_CONTENT = { header: { fullName: "Test Candidate" }, skills: [], experience: [], education: [] };
const SAMPLE_METRICS = { pageCount: 1, contentUtilization: 0.9, bottomWhitespaceInches: 0.5, overflow: false, readable: true };
const SAMPLE_PAGE_FIT = { ...SAMPLE_METRICS, recommendation: "pass" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.normalizeResumeContentForExport.mockImplementation((c: unknown) => c);
});

describe("measureResumePageFitMetrics", () => {
  it("returns the mapped, freshly measured page fit for real content", () => {
    mocks.renderResumePdfWithMetrics.mockReturnValue({ doc: {}, metrics: SAMPLE_METRICS });
    mocks.mapMetricsToPageFit.mockReturnValue(SAMPLE_PAGE_FIT);

    const result = measureResumePageFitMetrics(SAMPLE_CONTENT);

    expect(mocks.normalizeResumeContentForExport).toHaveBeenCalledWith(SAMPLE_CONTENT);
    expect(mocks.renderResumePdfWithMetrics).toHaveBeenCalledWith(SAMPLE_CONTENT);
    expect(mocks.mapMetricsToPageFit).toHaveBeenCalledWith(SAMPLE_METRICS);
    expect(result).toEqual(SAMPLE_PAGE_FIT);
  });

  it("returns undefined (leave the stored value alone) when rendering throws, instead of erasing it", () => {
    mocks.renderResumePdfWithMetrics.mockImplementation(() => {
      throw new Error("jsPDF choked on legacy content shape");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = measureResumePageFitMetrics(SAMPLE_CONTENT);

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns undefined for null/non-object content without calling the renderer", () => {
    expect(measureResumePageFitMetrics(null)).toBeUndefined();
    expect(measureResumePageFitMetrics(undefined)).toBeUndefined();
    expect(measureResumePageFitMetrics("not an object")).toBeUndefined();
    expect(mocks.renderResumePdfWithMetrics).not.toHaveBeenCalled();
  });

  it("returns undefined when mapMetricsToPageFit itself has nothing to map", () => {
    mocks.renderResumePdfWithMetrics.mockReturnValue({ doc: {}, metrics: null });
    mocks.mapMetricsToPageFit.mockReturnValue(null);

    expect(measureResumePageFitMetrics(SAMPLE_CONTENT)).toBeUndefined();
  });
});
