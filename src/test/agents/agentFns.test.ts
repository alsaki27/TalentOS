// Hard test: each agent function, with a mocked AI provider returning
// valid/invalid/malformed JSON to verify schema validation catches bad output.

import { describe, it, expect, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "@/lib/ai/application-agents/types";
import { JobAnalysisSchema, ResumeDraftSchema, ReviewScoreSchema, FinalResumeSchema } from "@/lib/ai/application-agents/schemas";

function mockProvider(returnText: string): AiProvider {
  return {
    send: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: returnText }],
      stopReason: "end_turn",
    }),
  };
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    applicationId: "app-1",
    candidateId: "cand-1",
    job: { id: "job-1", title: "Engineer", company: "Acme", description: "Engineering role", rawDescription: null, employmentType: null, seniorityLevel: null, salaryRange: null, location: null },
    baseResume: { id: "res-1", title: null, content: {}, skills: [], experience: [], education: [], certifications: [] },
    evidence: [],
    verifiedSkills: [],
    previousOutputs: {},
    ...overrides,
  };
}

describe("runJobLens", () => {
  it("validates valid job analysis output from AI", async () => {
    const validAnalysis = {
      title: "Senior Engineer",
      company: "Acme Corp",
      location: "Remote",
      requiredSkills: ["Go", "Kubernetes"],
      preferredSkills: ["Python"],
      tools: ["Docker", "Git"],
      methodologies: ["Agile"],
      certifications: ["CKA"],
      seniority: "Senior",
      domain: "Infrastructure",
      atsKeywords: ["Go", "Kubernetes", "distributed"],
      responsibilities: ["Design systems"],
      evidenceRequirements: ["System design examples"],
      prohibitedUnsupportedClaims: ["No direct reports claim"],
      ambiguities: ["Team size unknown"],
      rawSummary: "Senior infra role",
    };
    const provider = mockProvider(JSON.stringify(validAnalysis));

    const { runJobLens } = await import("@/lib/ai/application-agents/jobLens");
    const result = await runJobLens({}, provider, makeContext());
    expect(result.title).toBe("Senior Engineer");
    expect(result.requiredSkills).toContain("Go");
    expect(provider.send).toHaveBeenCalledOnce();
  });

  it("throws on invalid JSON from AI", async () => {
    const provider = mockProvider("not json at all");
    const { runJobLens } = await import("@/lib/ai/application-agents/jobLens");
    await expect(runJobLens({}, provider, makeContext())).rejects.toThrow();
  });

  it("throws on missing title in AI output", async () => {
    const provider = mockProvider(JSON.stringify({ company: "Acme" }));
    const { runJobLens } = await import("@/lib/ai/application-agents/jobLens");
    await expect(runJobLens({}, provider, makeContext())).rejects.toThrow("output validation failed");
  });
});

describe("runResumeForge", () => {
  it("validates valid resume draft output", async () => {
    const validDraft = {
      summary: "Experienced engineer",
      skills: ["Go"],
      experience: [{ title: "Engineer", company: "C", bullets: ["Built things"], evidenceIds: [] }],
      education: [],
      certifications: [],
      projects: [],
      changeLog: [{ change: "Added Go", reason: "JD requires", evidenceId: "ev-1" }],
      missingRequirements: [],
      excludedKeywords: [],
      truthRisks: [],
    };
    const provider = mockProvider(JSON.stringify(validDraft));
    const ctx = makeContext({
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: { title: "Engineer", company: "Acme" }, createdAt: "" },
      },
    });

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, ctx);
    expect(result.skills).toContain("Go");
    expect(result.changeLog).toHaveLength(1);
  });

  it("rejects truth risks with invalid severity instead of filtering", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: null, skills: [], experience: [], education: [],
      certifications: [], projects: [], changeLog: [],
      missingRequirements: [], excludedKeywords: [],
      truthRisks: [{ risk: "Bad", severity: "extreme" }],
    }));
    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    await expect(runResumeForge({}, provider, makeContext())).rejects.toThrow();
  });
});

describe("runHiringPanel", () => {
  it("validates valid review score output", async () => {
    const provider = mockProvider(JSON.stringify({
      atsScore: 8, recruiterScore: 7, roleFitScore: 6, truthfulnessRisk: 2,
      formattingIssues: [], requiredEdits: [], optionalEdits: [],
      passFail: "pass", overallComment: "Good",
    }));
    const ctx = makeContext({
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 2, schemaVersion: "ResumeDraftV1", contentHash: "def", data: {}, createdAt: "" },
      },
    });
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    const result = await runHiringPanel({}, provider, ctx);
    expect(result.atsScore).toBe(8);
    expect(result.passFail).toBe("pass");
  });

  it("throws on missing required score", async () => {
    const provider = mockProvider(JSON.stringify({
      recruiterScore: 7, roleFitScore: 6,
    }));
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    await expect(runHiringPanel({}, provider, makeContext())).rejects.toThrow();
  });

  it("rejects atsScore above 10", async () => {
    const provider = mockProvider(JSON.stringify({
      atsScore: 15, recruiterScore: 7, roleFitScore: 6, passFail: "pass",
    }));
    const { runHiringPanel } = await import("@/lib/ai/application-agents/hiringPanel");
    await expect(runHiringPanel({}, provider, makeContext())).rejects.toThrow("must be 0-10");
  });
});

describe("runFinalPolish", () => {
  it("validates valid final resume output", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: "Final", skills: ["Go"], experience: [], education: [],
      certifications: [], projects: [], appliedIssueIds: ["r1"],
      rejectedIssueIds: [], unresolvedWarnings: [],
      finalQaScore: 9, exportReady: true,
    }));
    const ctx = makeContext({
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 2, schemaVersion: "ResumeDraftV1", contentHash: "def", data: {}, createdAt: "" },
        application_hiring_panel: { id: "a3", automationId: "application_hiring_panel", sequenceNumber: 3, schemaVersion: "ReviewScoreV1", contentHash: "ghi", data: {}, createdAt: "" },
      },
    });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const result = await runFinalPolish({}, provider, ctx);
    expect(result.exportReady).toBe(true);
    expect(result.finalQaScore).toBe(9);
  });
});
