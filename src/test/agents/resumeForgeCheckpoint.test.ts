// Resume Forge makes up to 4 sequential provider calls per attempt since Job
// Lens was folded into it. These cover the guards that stop a provider
// fallover or a re-dispatched attempt from re-running the job-analysis half,
// and the failure wording for our own stage time budget.

import { describe, it, expect, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "@/lib/ai/application-agents/types";

vi.mock("@/server/db/neon", () => ({
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const JOB_ONLY = {
  title: "Engineer", company: "Acme", location: "Remote",
  requiredSkills: [], preferredSkills: [], tools: [], methodologies: [], certifications: [],
  seniority: null, domain: null, atsKeywords: [], responsibilities: [],
  evidenceRequirements: [], prohibitedUnsupportedClaims: [], ambiguities: [], rawSummary: "",
};
const REQUIREMENTS = { requirementAnalysis: [] };
const DRAFT = {
  summary: null, skills: [], experience: [], education: [],
  certifications: [], projects: [], changeLog: [],
  missingRequirements: [], excludedKeywords: [], truthRisks: [],
};
const text = (v: unknown) => ({ content: [{ type: "text", text: JSON.stringify(v) }], stopReason: "end_turn" });

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    applicationId: "app-1",
    candidateId: "cand-1",
    job: { id: "job-1", title: "Engineer", company: "Acme", description: "Engineering role", rawDescription: null, employmentType: null, seniorityLevel: null, salaryRange: null, location: null },
    baseResume: { id: "res-1", title: null, content: {}, skills: [], experience: [], education: [], certifications: [] },
    evidence: [],
    verifiedSkills: [],
    previousOutputs: {},
    sourceOfTruth: null,
    ...overrides,
  } as AgentContext;
}

async function analysisFromFreshRun() {
  const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
  const provider: AiProvider = {
    send: vi.fn()
      .mockResolvedValueOnce(text(JOB_ONLY))
      .mockResolvedValueOnce(text(REQUIREMENTS))
      .mockResolvedValue(text(DRAFT)),
  };
  return (await runResumeForge({}, provider, makeContext())).jobAnalysis;
}

describe("Resume Forge job-analysis reuse", () => {
  it("does not repeat job analysis when the next provider route takes over after the draft call fails", async () => {
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const ctx = makeContext();
    const onJobAnalysis = vi.fn().mockResolvedValue(undefined);
    ctx.onJobAnalysis = onJobAnalysis;

    const routeA: AiProvider = {
      send: vi.fn()
        .mockResolvedValueOnce(text(JOB_ONLY))
        .mockResolvedValueOnce(text(REQUIREMENTS))
        .mockRejectedValueOnce(new Error("Request timed out")),
    };
    await expect(runResumeForge({}, routeA, ctx)).rejects.toThrow("timed out");
    expect(onJobAnalysis).toHaveBeenCalledTimes(1);

    // Same ctx, as callWithUsageTracking re-invokes the agent on the next route.
    const routeB: AiProvider = { send: vi.fn().mockResolvedValue(text(DRAFT)) };
    const result = await runResumeForge({}, routeB, ctx);
    expect(routeB.send).toHaveBeenCalledTimes(1); // draft only
    expect(result.jobAnalysis.title).toBe("Engineer");
    expect(onJobAnalysis).toHaveBeenCalledTimes(1);
  });

  it("reuses a checkpoint from an earlier attempt when job and base resume match", async () => {
    const { runResumeForge, JOB_ANALYSIS_CHECKPOINT_ID } = await import("@/lib/ai/application-agents/resumeForge");
    const analysis = await analysisFromFreshRun();
    const ctx = makeContext({
      previousOutputs: {
        [JOB_ANALYSIS_CHECKPOINT_ID]: { data: { jobId: "job-1", baseResumeId: "res-1", analysis } } as any,
      },
    });
    const provider: AiProvider = { send: vi.fn().mockResolvedValue(text(DRAFT)) };
    await runResumeForge({}, provider, ctx);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("ignores a checkpoint computed for a different base resume (retry can switch it)", async () => {
    const { runResumeForge, JOB_ANALYSIS_CHECKPOINT_ID } = await import("@/lib/ai/application-agents/resumeForge");
    const analysis = await analysisFromFreshRun();
    const ctx = makeContext({
      previousOutputs: {
        [JOB_ANALYSIS_CHECKPOINT_ID]: { data: { jobId: "job-1", baseResumeId: "other-resume", analysis } } as any,
      },
    });
    const provider: AiProvider = {
      send: vi.fn()
        .mockResolvedValueOnce(text(JOB_ONLY))
        .mockResolvedValueOnce(text(REQUIREMENTS))
        .mockResolvedValue(text(DRAFT)),
    };
    await runResumeForge({}, provider, ctx);
    expect(provider.send).toHaveBeenCalledTimes(3);
  });
});

describe("classifyWorkflowFailure - stage time budget", () => {
  it("describes our own stage timeout as a time limit, not a provider connection issue", async () => {
    const { classifyWorkflowFailure } = await import("@/lib/ai/application-agents/workflowFailureClassifier");
    const result = classifyWorkflowFailure("Agent stage timed out after 365000ms");
    expect(result?.category).toBe("infra_transient");
    expect(result?.likelyRetriable).toBe(true);
    expect(result?.reason).toContain("time limit");
    expect(result?.reason).not.toContain("connection issue");
  });
});
