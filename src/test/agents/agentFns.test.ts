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

  it("falls back to the canonical job title when AI omits it", async () => {
    const provider = mockProvider(JSON.stringify({ company: "Acme" }));
    const { runJobLens } = await import("@/lib/ai/application-agents/jobLens");
    await expect(runJobLens({}, provider, makeContext())).resolves.toMatchObject({
      title: "Engineer",
      company: "Acme",
    });
  });
});

describe("runResumeForge", () => {
  it("validates valid resume draft output", async () => {
    const validDraft = {
      summary: "Experienced engineer",
      skills: [{ title: "Languages", skills: ["Go"] }],
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
    expect(result.skills[0]?.skills).toContain("Go");
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

  it("removes fabricated replacement roles and preserves legacy base identity and education month", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: null,
      skills: [],
      experience: [
        { title: "AutoCAD Drafter", company: "ALTERED COMPANY", startDate: "Wrong", endDate: "Wrong", bullets: ["Tailored first role"], evidenceIds: [] },
        { title: "Invented Engineer", company: "Invented Employer", startDate: "2025", endDate: "Present", bullets: ["Fabricated role"], evidenceIds: [] },
      ],
      education: [{ degree: "Master of Engineering Management", school: "WUST", field: null, graduationDate: "2019" }],
      certifications: [], projects: [], changeLog: [], missingRequirements: [], excludedKeywords: [], truthRisks: [],
    }));
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: {
          personalInfo: { fullName: "Najiur Rahman" },
          experience: [
            { title: "AutoCAD Drafter", company: { text: "SWOT Technologies" }, location: "Charlotte, NC", startDate: "May 2024", endDate: "Dec 2025", bullets: [{ text: "Base CAD bullet" }] },
            { title: { text: "Architectural Drafter" }, company: "Fiber-Grounded Ltd.", location: "Dhaka, Bangladesh", startDate: "Feb 2018", endDate: "Jan 2022", bullets: [{ text: "Base architecture bullet" }] },
          ],
          education: [{ degree: "Master of Engineering Management", school: "Washington University of Science and Technology (WUST)", graduationDate: "May 2024" }],
        },
      } as any,
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "abc", data: {}, createdAt: "" },
      },
    });

    const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
    const result = await runResumeForge({}, provider, ctx);

    expect(result.experience.map((entry) => [entry.title, entry.company])).toEqual([
      ["AutoCAD Drafter", "SWOT Technologies"],
      ["Architectural Drafter", "Fiber-Grounded Ltd."],
    ]);
    expect(result.experience[0]?.startDate).toBe("May 2024");
    expect(result.experience[1]?.bullets).toContain("Base architecture bullet");
    expect(result.education[0]?.school).toBe("Washington University of Science and Technology (WUST)");
    expect(result.education[0]?.graduationDate).toBe("May 2024");
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
      summary: "Final", skills: [{ title: "Languages", skills: ["Go"] }], experience: [], education: [],
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

  it("normalizes percentage-style QA and reasserts base employment and education facts", async () => {
    const provider = mockProvider(JSON.stringify({
      summary: null, skills: [],
      experience: [{ title: "Fake Role", company: "Fake Company", bullets: ["Fake bullet"], evidenceIds: [] }],
      education: [{ degree: "MEM", school: "WUST", graduationDate: "2019" }],
      certifications: [], projects: [], appliedIssueIds: [], rejectedIssueIds: [], unresolvedWarnings: [],
      finalQaScore: 93, exportReady: true,
    }));
    const baseExperience = [{ title: { text: "OSP Design Engineer" }, company: { value: "Bayshore Communication" }, location: "Tampa, FL", startDate: "Jan 2026", endDate: "Present", bullets: [{ text: "Designed OSP systems" }] }];
    const ctx = makeContext({
      baseResume: {
        id: "res-1", title: "Base", skills: [], experience: [], education: [], certifications: [],
        content: {
          experience: baseExperience,
          education: [{ degree: "Master of Engineering Management (MEM)", school: { text: "Washington University of Science and Technology (WUST)" }, graduationDate: "May 2024" }],
        },
      } as any,
      previousOutputs: {
        application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "JobAnalysisV1", contentHash: "a", data: {}, createdAt: "" },
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 2, schemaVersion: "ResumeDraftV1", contentHash: "b", data: { experience: baseExperience }, createdAt: "" },
        application_hiring_panel: { id: "a3", automationId: "application_hiring_panel", sequenceNumber: 3, schemaVersion: "ReviewScoreV1", contentHash: "c", data: {}, createdAt: "" },
      },
    });

    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const result = await runFinalPolish({}, provider, ctx);

    expect(result.finalQaScore).toBe(9.3);
    expect(result.experience).toHaveLength(1);
    expect(result.experience[0]).toMatchObject({
      title: "OSP Design Engineer",
      company: "Bayshore Communication",
      startDate: "Jan 2026",
      endDate: "Present",
    });
    expect(result.education[0]?.graduationDate).toBe("May 2024");
  });

  it("rejects ambiguous out-of-range QA scores", () => {
    const result = FinalResumeSchema.parse({
      summary: null, skills: [], experience: [], education: [], certifications: [], projects: [],
      appliedIssueIds: [], rejectedIssueIds: [], unresolvedWarnings: [], finalQaScore: 15, exportReady: false,
    });
    expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("finalQaScore") }));
  });
});
