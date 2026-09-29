// Phase 4 (2026-09-28): Final Polish's AI call is skipped when
// ai_runtime_config.final_polish_skip_when_clean is on AND Hiring Panel
// returned zero requiredEdits AND page fit already passes AND the
// deterministic QA module reports ok:true. Any one condition failing must
// fall back to the real AI call - these tests pin exactly that contract.

import { describe, it, expect, vi } from "vitest";
import type { AiProvider } from "@/lib/ai/provider";
import type { AgentContext } from "@/lib/ai/application-agents/types";

const mockQueryOne = vi.fn();
vi.mock("@/server/db/neon", () => ({
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
  query: vi.fn().mockResolvedValue([]),
  queryOne: (...args: any[]) => mockQueryOne(...args),
}));

// Page-fit is a REAL jsPDF render, not a mock - a sparse draft measures well
// under the 82% utilization floor and would recommend "expand", not "pass".
// This content is sized generously (3 roles, full bullet counts, realistic
// bullet length) specifically to render as a genuinely full one-page resume.
const LONG_BULLET = (n: number) =>
  `Delivered accomplishment number ${n} with quantified results, cross-functional collaboration, measurable technical impact, stakeholder communication, and process improvements across the organization and its regional partner teams, while mentoring junior staff and documenting standard operating procedures for long-term maintainability.`;

const BASE_EXPERIENCE = [
  { title: "GIS Analyst", company: "Acme Corp", location: "Remote", startDate: "2022-01", endDate: null, bullets: Array.from({ length: 7 }, (_, i) => LONG_BULLET(i)) },
  { title: "GIS Technician", company: "Beta LLC", location: "Austin, TX", startDate: "2019-06", endDate: "2021-12", bullets: Array.from({ length: 6 }, (_, i) => LONG_BULLET(10 + i)) },
];

const CLEAN_BASE_CONTENT = {
  summary: "Experienced GIS analyst with a track record of delivering accurate spatial data products for infrastructure planning teams.",
  skills: ["ArcGIS", "AutoCAD", "Python", "SQL"],
  experience: BASE_EXPERIENCE,
  education: [{ degree: "B.S. GIS", school: "State University", graduationDate: "2021" }],
};

const CLEAN_DRAFT = {
  summary: "Experienced GIS analyst tailored for the role, with a track record of delivering accurate spatial data products for infrastructure planning teams.",
  skills: [{ title: "Core", skills: ["ArcGIS", "AutoCAD", "Python", "SQL"] }],
  experience: BASE_EXPERIENCE.map((role) => ({ ...role, evidenceIds: [] })),
  education: [{ degree: "B.S. GIS", school: "State University", field: null, graduationDate: "2021" }],
  certifications: [],
  projects: [],
  changeLog: [],
  missingRequirements: [],
  excludedKeywords: [],
  truthRisks: [],
};

const JOB_ANALYSIS = { title: "GIS Analyst", company: "Acme Corp", requirementAnalysis: [] };

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    applicationId: "app-1",
    candidateId: "cand-1",
    job: { id: "job-1", title: "GIS Analyst", company: "Acme Corp", description: "Role", rawDescription: null, employmentType: null, seniorityLevel: null, salaryRange: null, location: null },
    baseResume: { id: "res-1", title: null, content: CLEAN_BASE_CONTENT, skills: [], experience: [], education: [], certifications: [] } as any,
    evidence: [],
    verifiedSkills: [],
    sourceOfTruth: null,
    previousOutputs: {
      application_job_lens: { id: "a1", automationId: "application_job_lens", sequenceNumber: 1, schemaVersion: "v1", contentHash: "h", data: JOB_ANALYSIS, createdAt: "" },
      application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "v1", contentHash: "h", data: CLEAN_DRAFT, createdAt: "" },
      application_hiring_panel: {
        id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "v1", contentHash: "h",
        data: { atsScore: 9, recruiterScore: 9, roleFitScore: 9, requiredEdits: [] },
        createdAt: "",
      },
    },
    ...overrides,
  } as AgentContext;
}

function mockProvider(): { provider: AiProvider; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify({ ...CLEAN_DRAFT, appliedIssueIds: [], rejectedIssueIds: [], unresolvedWarnings: [], finalQaScore: 9, exportReady: true }) }],
    stopReason: "end_turn",
  });
  return { provider: { send }, send };
}

describe("runFinalPolish — conditional skip (Phase 4)", () => {
  it("calls the AI normally when the flag is off (default)", async () => {
    mockQueryOne.mockResolvedValue({ final_polish_skip_when_clean: false });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    await runFinalPolish({}, provider, makeContext());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("skips the AI call when the flag is on and the draft is genuinely clean", async () => {
    mockQueryOne.mockResolvedValue({ final_polish_skip_when_clean: true });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    const result = await runFinalPolish({}, provider, makeContext());

    expect(send).not.toHaveBeenCalled();
    // Post-processing still ran on the synthesized output: identity is still
    // locked to the base resume, and page fit was still freshly measured.
    expect(result.experience[0].title).toBe("GIS Analyst");
    expect(result.experience[0].company).toBe("Acme Corp");
    expect(result.summary).toBe(CLEAN_DRAFT.summary);
  });

  it("falls back to a real AI call when Hiring Panel has non-empty requiredEdits", async () => {
    mockQueryOne.mockResolvedValue({ final_polish_skip_when_clean: true });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    const ctx = makeContext({
      previousOutputs: {
        ...makeContext().previousOutputs,
        application_hiring_panel: {
          id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "v1", contentHash: "h",
          data: { atsScore: 9, recruiterScore: 9, roleFitScore: 9, requiredEdits: [{ issueId: "1", description: "fix something", severity: "minor" }] },
          createdAt: "",
        },
      },
    });
    await runFinalPolish({}, provider, ctx);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls back to a real AI call when the draft has an identity mismatch against the base resume (deterministic QA fails)", async () => {
    mockQueryOne.mockResolvedValue({ final_polish_skip_when_clean: true });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    const driftedDraft = {
      ...CLEAN_DRAFT,
      experience: [{ ...CLEAN_DRAFT.experience[0], title: "Completely Different Title" }],
    };
    const ctx = makeContext({
      previousOutputs: {
        ...makeContext().previousOutputs,
        application_resume_forge: { id: "a2", automationId: "application_resume_forge", sequenceNumber: 1, schemaVersion: "v1", contentHash: "h", data: driftedDraft, createdAt: "" },
      },
    });
    await runFinalPolish({}, provider, ctx);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls back to a real AI call when the DB lookup for the flag fails (never breaks Final Polish)", async () => {
    mockQueryOne.mockRejectedValue(new Error("DB unavailable"));
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    await runFinalPolish({}, provider, makeContext());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("skips the AI call when the workflow is tagged with the final_polish_skip pipelineVariant, even though the global flag is off", async () => {
    // Phase 0 A/B seam: a workflow can opt into the skip individually (via
    // config_snapshot.pipelineVariant) for canary testing without flipping
    // final_polish_skip_when_clean for all traffic.
    mockQueryOne.mockResolvedValue({ final_polish_skip_when_clean: false });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    const result = await runFinalPolish({}, provider, makeContext({ pipelineVariant: "final_polish_skip" }));

    expect(send).not.toHaveBeenCalled();
    expect(result.experience[0].title).toBe("GIS Analyst");
  });

  it("still falls back to a real AI call for a variant-tagged workflow when the draft isn't actually clean", async () => {
    mockQueryOne.mockResolvedValue({ final_polish_skip_when_clean: false });
    const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
    const { provider, send } = mockProvider();
    const ctx = makeContext({
      pipelineVariant: "final_polish_skip",
      previousOutputs: {
        ...makeContext().previousOutputs,
        application_hiring_panel: {
          id: "a3", automationId: "application_hiring_panel", sequenceNumber: 2, schemaVersion: "v1", contentHash: "h",
          data: { atsScore: 9, recruiterScore: 9, roleFitScore: 9, requiredEdits: [{ issueId: "1", description: "fix something", severity: "minor" }] },
          createdAt: "",
        },
      },
    });
    await runFinalPolish({}, provider, ctx);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
