import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/falood/applications/route";
import { formatPageFitSummary } from "@/lib/scoreScale";

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  execute: vi.fn(),
  getCurrentUserContext: vi.fn(),
  measureResumePageFitMetrics: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUserContext: mocks.getCurrentUserContext }));
vi.mock("@/server/db/neon", () => ({ queryOne: mocks.queryOne, execute: mocks.execute }));
vi.mock("@/server/lib/waitUntil", () => ({ backgroundDispatch: (promise: Promise<unknown>) => promise }));
vi.mock("@/lib/falood/resumePageFitMeasurement", () => ({
  measureResumePageFitMetrics: mocks.measureResumePageFitMetrics,
}));

const VERSION = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";
const RESUME = {
  personalInfo: { fullName: "Test Candidate" },
  summary: "Revised summary",
  skills: { mode: "simple", simple: [], categorized: [] },
  pageFormat: "letter",
  fontSize: 10,
};
const EXISTING = { header: { fullName: "Test Candidate" }, formatting: { fontSize: 12 } };

function patch(body: unknown) {
  return PATCH(new NextRequest(`https://talentos.test/api/falood/applications?id=${SESSION}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentUserContext.mockResolvedValue({ profile: { user_id: "staff-id" } });
  mocks.queryOne.mockResolvedValueOnce({ id: VERSION, content: EXISTING })
    .mockResolvedValueOnce({ id: SESSION, name: `application_resume_version:${VERSION}`, resumeVersionId: VERSION });
});

describe("saving page fit from a linked Tailor Studio", () => {
  it.each([
    [[0.83], "1 page · 83% filled"],
    [[0.98, 0.31], "2 pages · last page 31% filled · overflow"],
    [[0.98, 0.97, 0.19], "3 pages · last page 19% filled · overflow"],
  ])("commits the preview measurements with the saved content (%j)", async (fills, label) => {
    const response = await patch({ resumeData: RESUME, pageUtilizations: fills });
    expect(response.status).toBe(200);
    expect((await response.json()).data.resumeVersionId).toBe(VERSION);
    const [sql, parameters] = mocks.queryOne.mock.calls[1];
    expect(sql).toContain("WITH saved AS (UPDATE falood_saved_applications");
    expect(sql).toContain("UPDATE application_resume_versions");
    expect(sql).toContain("FROM saved");
    expect(parameters.slice(-3)).toEqual(["staff-id", "human_falood_studio_save", VERSION]);
    expect(JSON.parse(parameters.at(-6))).toMatchObject({ summary: { text: RESUME.summary }, formatting: EXISTING.formatting });
    const metrics = JSON.parse(parameters.at(-5));
    expect(metrics).toMatchObject({ pageCount: fills.length, pageUtilizations: fills, overflow: fills.length > 1 });
    expect(formatPageFitSummary(metrics)).toBe(label);
    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
  });

  it("clears the old badge when Studio sends an invalid measurement", async () => {
    const response = await patch({ resumeData: RESUME, pageUtilizations: [2] });
    expect(response.status).toBe(200);
    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
    const [, parameters] = mocks.queryOne.mock.calls[1];
    expect(parameters.slice(-5, -3)).toEqual([null, null]);
  });

  it("uses the existing PDF measurement for a legacy client", async () => {
    const legacy = { pageCount: 2, contentUtilization: 0.79, overflow: true };
    mocks.measureResumePageFitMetrics.mockReturnValue(legacy);
    expect((await patch({ resumeData: RESUME })).status).toBe(200);
    const [, parameters] = mocks.queryOne.mock.calls[1];
    expect(parameters.slice(-5, -3)).toEqual([JSON.stringify(legacy), 79]);
  });

  it("does not acknowledge a failed linked write", async () => {
    mocks.queryOne.mockReset().mockResolvedValueOnce({ id: VERSION, content: EXISTING })
      .mockRejectedValueOnce(new Error("write failed"));
    const response = await patch({ resumeData: RESUME, pageUtilizations: [0.9] });
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
    expect(mocks.queryOne).toHaveBeenCalledTimes(2);
  });

  it("preserves the separate base resume sync", async () => {
    mocks.queryOne.mockReset().mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: SESSION, name: `base_resume:${VERSION}` })
      .mockResolvedValueOnce({ content: EXISTING });
    expect((await patch({ resumeData: RESUME, pageUtilizations: [0.9] })).status).toBe(200);
    expect(mocks.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE base_resumes"), expect.any(Array));
    expect(mocks.measureResumePageFitMetrics).not.toHaveBeenCalled();
  });

  it("leaves page fit alone for chat-only requests", async () => {
    mocks.queryOne.mockReset().mockResolvedValueOnce({ id: SESSION, name: `application_resume_version:${VERSION}` });
    expect((await patch({ chatHistory: [] })).status).toBe(200);
    expect(mocks.queryOne).toHaveBeenCalledTimes(1);
    expect(mocks.queryOne.mock.calls[0][0]).not.toContain("page_fit_metrics");
  });
});
