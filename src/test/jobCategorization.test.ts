import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/ai/routing", () => ({
  callWithUsageTracking: vi.fn(),
}));

vi.mock("@/server/db/neon", () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@/server/repositories/jobsRepository", () => ({
  updateJob: vi.fn(),
}));

import { callWithUsageTracking } from "@/lib/ai/routing";
import { execute } from "@/server/db/neon";
import { updateJob } from "@/server/repositories/jobsRepository";
import { categorizeOneJob, type PendingJob } from "@/lib/ai/jobCategorization";

function pendingJob(overrides: Partial<PendingJob> = {}): PendingJob {
  return {
    id: "job-1",
    title: "GIS Specialist",
    description_text: "Seeking a GIS Specialist experienced in ArcGIS Pro and FME.",
    job_function: null,
    industries: null,
    company_description: null,
    salary_range: null,
    notes: null,
    raw_source_payload: null,
    description_html: null,
    ...overrides,
  };
}

/** Wires callWithUsageTracking to actually invoke the wrapped fn (unlike a
 * bypass mock) against a fake provider that returns the given raw text, so
 * categorizeOneJob's real buildPrompt/parseAiJson logic runs. Returns a
 * getter for the exact prompt text the fake provider was sent, so tests can
 * assert on what actually got built without re-implementing buildPrompt. */
function mockAiReturns(text: string): { promptText: () => string } {
  let captured = "";
  (callWithUsageTracking as any).mockImplementation(async (_automationId: string, _ctx: any, fn: any) => {
    const provider = {
      send: vi.fn().mockImplementation((opts: any) => {
        captured = opts.messages[0].content[0].text;
        return Promise.resolve({ content: [{ type: "text", text }], stopReason: "end_turn" });
      }),
    };
    const result = await fn(provider);
    return { result, providerName: "test-provider" };
  });
  return { promptText: () => captured };
}

const combinedJobOnlyFields = {
  title: "GIS Specialist", company: "Pacific Pros", location: "Los Angeles, CA",
  requiredSkills: ["ArcGIS Pro"], preferredSkills: [], tools: ["FME"], methodologies: [],
  certifications: [], seniority: null, domain: "GIS", atsKeywords: ["ArcGIS Pro"],
  responsibilities: [], evidenceRequirements: [], prohibitedUnsupportedClaims: [], ambiguities: [],
  rawSummary: "GIS role.",
};
const combinedCategorizationFields = {
  tags: ["GIS", "ArcGIS"], confidence: 85,
  salary_min: 60000, salary_max: 80000, salary_currency: "USD", salary_period: "year",
  work_authorization: "unspecified", work_authorization_evidence: null,
};

describe("categorizeOneJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (updateJob as any).mockResolvedValue({});
    (execute as any).mockResolvedValue(undefined);
  });

  it("builds one prompt combining job-only-lens instructions and categorization instructions, with exactly one final JSON instruction", async () => {
    const ai = mockAiReturns(JSON.stringify({ ...combinedJobOnlyFields, ...combinedCategorizationFields }));
    await categorizeOneJob(pendingJob());

    expect(callWithUsageTracking).toHaveBeenCalledWith("job_categorization", undefined, expect.any(Function));
    const prompt = ai.promptText();
    // Job-only-lens field definitions (shared verbatim with prompts/jobLens.ts).
    expect(prompt).toMatch(/requiredSkills/);
    expect(prompt).toMatch(/atsKeywords/);
    // Categorization-specific additions.
    expect(prompt).toMatch(/work_authorization/);
    expect(prompt).toMatch(/salary_min/);
    // The shared prompt's own closer must not appear twice - only the final combined one.
    expect((prompt.match(/Return ONLY valid JSON/g) ?? []).length).toBe(1);
  });

  it("persists categorization fields via updateJob AND caches the job-only analysis via a separate execute() call, on a fully valid response", async () => {
    mockAiReturns(JSON.stringify({ ...combinedJobOnlyFields, ...combinedCategorizationFields }));
    const { ok, result } = await categorizeOneJob(pendingJob());

    expect(ok).toBe(true);
    expect(result?.tags).toEqual(["GIS", "ArcGIS"]);

    expect(updateJob).toHaveBeenCalledWith("job-1", expect.objectContaining({
      category_status: "done",
      category_tags: ["GIS", "ArcGIS"],
      job_category: "GIS",
      salary_min: 60000,
      work_authorization: "unspecified",
    }));

    const jobAnalysisCall = (execute as any).mock.calls.find((c: any[]) => String(c[0]).includes("job_analysis = $1"));
    expect(jobAnalysisCall).toBeDefined();
    const cachedPayload = JSON.parse(jobAnalysisCall[1][0]);
    expect(cachedPayload.title).toBe("GIS Specialist");
    expect(cachedPayload.requiredSkills).toEqual(["ArcGIS Pro"]);
    expect(cachedPayload).not.toHaveProperty("requirementAnalysis");
  });

  it("still succeeds at categorization when the job-only-analysis half is missing required fields, recording job_analysis_error separately instead of failing the whole call", async () => {
    // Only the categorization fields are present - title/company/etc missing,
    // so JobAnalysisSchema.parse() will reject it as job-only analysis.
    mockAiReturns(JSON.stringify(combinedCategorizationFields));
    const { ok, result } = await categorizeOneJob(pendingJob());

    expect(ok).toBe(true);
    expect(result?.tags).toEqual(["GIS", "ArcGIS"]);
    expect(updateJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ category_status: "done" }));

    const errorCall = (execute as any).mock.calls.find((c: any[]) => String(c[0]).includes("job_analysis_error"));
    expect(errorCall).toBeDefined();
    expect(errorCall[1][1]).toBe("job-1");
  });

  it("fails the whole call (markFailed) when the AI response isn't valid JSON at all", async () => {
    mockAiReturns("not json at all");
    const { ok, status } = await categorizeOneJob(pendingJob());

    expect(ok).toBe(false);
    expect(status).toBe("failed");
    expect(updateJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ category_status: "failed" }));
  });

  it("falls back to notes when description_text is empty, instead of silently analyzing nothing", async () => {
    const ai = mockAiReturns(JSON.stringify({ ...combinedJobOnlyFields, ...combinedCategorizationFields }));
    await categorizeOneJob(pendingJob({
      description_text: null,
      notes: "UNIQUE-NOTES-MARKER: seeking a GIS Specialist with ArcGIS Pro experience.",
    }));

    expect(ai.promptText()).toMatch(/UNIQUE-NOTES-MARKER/);
  });

  it("falls back to raw_source_payload.description when neither description_text nor notes is set", async () => {
    const ai = mockAiReturns(JSON.stringify({ ...combinedJobOnlyFields, ...combinedCategorizationFields }));
    await categorizeOneJob(pendingJob({
      description_text: null,
      notes: null,
      raw_source_payload: { description: "UNIQUE-PAYLOAD-MARKER: full JD text from the import payload." },
    }));

    expect(ai.promptText()).toMatch(/UNIQUE-PAYLOAD-MARKER/);
  });
});
