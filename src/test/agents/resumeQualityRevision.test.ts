import { describe, expect, it, vi } from "vitest";
import { buildResumeForgePrompt, buildResumeForgeMissedRetryPrompt } from "@/lib/ai/application-agents/prompts/resumeForge";
import { buildHiringPanelPrompt } from "@/lib/ai/application-agents/prompts/hiringPanel";
import { buildFinalPolishPrompt } from "@/lib/ai/application-agents/prompts/finalPolish";
import { projectJobAnalysisForDraft } from "@/lib/ai/application-agents/promptProjections";
import { runDeterministicQa } from "@/lib/ai/application-agents/deterministicQa";
import { applyFinalReadinessChecks } from "@/lib/ai/application-agents/finalResumeReadiness";
import type { AgentContext } from "@/lib/ai/application-agents/types";

vi.mock("@/server/db/neon", () => ({
  execute: vi.fn().mockResolvedValue({ rowCount: 1 }),
  query: vi.fn().mockResolvedValue([]), queryOne: vi.fn().mockResolvedValue(null),
}));

const role = (i: number, count: number) => ({
  title: i ? "GIS Intern" : "GIS Analyst", company: `Employer ${i}`, location: "Austin",
  startDate: i ? "2022-01" : "2023-01", endDate: i ? "2022-12" : null,
  bullets: Array.from({ length: count }, (_, n) => `Prepared ArcGIS dataset ${n + 1} for a documented survey.`), evidenceIds: [],
});
const analysis = {
  title: "GIS Analyst", company: "Hiring Co", location: "Austin", seniority: "Junior", domain: "GIS",
  requiredSkills: [], preferredSkills: [], tools: [], methodologies: [], certifications: [],
  atsKeywords: [], responsibilities: [], evidenceRequirements: [], prohibitedUnsupportedClaims: [],
  ambiguities: [], rawSummary: "", requirementAnalysis: [],
};
const response = (data: unknown) => ({ content: [{ type: "text", text: JSON.stringify(data) }], stopReason: "end_turn" });
const finalFields = { appliedIssueIds: [], rejectedIssueIds: [], unresolvedWarnings: [], finalQaScore: 8, exportReady: true };
const fit = { pageCount: 1, contentUtilization: 0.8, bottomWhitespaceInches: 1, overflow: false, readable: true, recommendation: "pass" as const };

describe("concise resume regression - mocked providers, actual guards and PDF renderer", () => {
  it.each(Array.from({ length: 10 }, (_, i) => [i % 5 + 1, Math.floor(i / 5) + 1]))(
    "preserves %i selected bullets across %i roles through Forge and Polish without quota padding",
    async (bulletCount, roleCount) => {
      const base = { skills: [{ title: "GIS", skills: ["ArcGIS"] }], experience: Array.from({ length: roleCount }, (_, i) => role(i, 7)), education: [] };
      const draft = { summary: null, skills: base.skills, experience: Array.from({ length: roleCount }, (_, i) => role(i, bulletCount)), education: [], certifications: [], projects: [], changeLog: [], missingRequirements: [], excludedKeywords: [], truthRisks: [] };
      const ctx = {
        applicationId: "test-app", candidateId: "test-candidate",
        job: { id: "test-job", title: "GIS Analyst", company: "Hiring Co", description: "Prepare ArcGIS survey datasets.", job_analysis: null },
        baseResume: { id: "test-base", content: base, skills: [], experience: [], education: [] },
        evidence: [], verifiedSkills: [], sourceOfTruth: null, previousOutputs: {},
      } as unknown as AgentContext;
      const send = vi.fn().mockResolvedValueOnce(response(analysis))
        .mockResolvedValueOnce(response({ requirementAnalysis: [] })).mockResolvedValue(response(draft));
      const { runResumeForge } = await import("@/lib/ai/application-agents/resumeForge");
      const forged = await runResumeForge({}, { send } as any, ctx);
      expect(forged.draft.experience.map((r) => r.bullets.length)).toEqual(Array(roleCount).fill(bulletCount));
      const originalBase = JSON.stringify(base);
      ctx.previousOutputs = {
        application_job_lens: { data: analysis },
        application_resume_forge: { data: forged.draft },
        application_hiring_panel: { data: { requiredEdits: [], roleFitScore: 8, recruiterScore: 8, atsScore: 8, truthfulnessRisk: 0 } },
      } as any;
      const { runFinalPolish } = await import("@/lib/ai/application-agents/finalPolish");
      const polished = await runFinalPolish({}, { send: vi.fn().mockResolvedValue(response({ ...draft, ...finalFields })) } as any, ctx);
      expect(polished.experience.map((r) => r.bullets.length)).toEqual(Array(roleCount).fill(bulletCount));
      expect(polished.experience.map((r) => [r.title, r.company, r.startDate, r.endDate])).toEqual(base.experience.map((r) => [r.title, r.company, r.startDate, r.endDate]));
      expect(polished.pageFit?.pageCount).toBe(1);
      expect(JSON.stringify(base)).toBe(originalBase);
    },
  );
});

describe("evidence reaches every reviewer", () => {
  const base = { content: { skills: ["ArcGIS"], experience: [{ ...role(0, 1), bullets: ["x".repeat(13000), "TAIL-EVIDENCE: created ArcGIS survey maps"] }], education: [] } };
  const job = { title: "GIS Analyst", company: "Hiring Co", description_text: "Senior GIS Administrator requires 5 years of enterprise ownership." };
  it("preserves late source evidence and the actual JD without broken JSON slices", () => {
    const forge = buildResumeForgePrompt(job, base, [], analysis);
    const review = buildHiringPanelPrompt(job, base, {}, analysis);
    const polish = buildFinalPolishPrompt(job, base, {}, {}, analysis);
    for (const prompt of [forge, review, polish]) {
      expect(prompt).toContain("TAIL-EVIDENCE");
      expect(prompt).not.toMatch(/minimum 6 bullets|8-15 distinct|8 to 15 distinct/);
    }
    expect(forge).toContain(job.description_text);
    expect(review).toContain(job.description_text);
    expect(review).toContain("professional ownership");
  });
  it("preserves requirement evidence and handles null rows and false-like safeToAdd strings", () => {
    const projected = projectJobAnalysisForDraft({ requirementAnalysis: [null, { requirement: "ArcGIS", sourceEvidence: ["base.experience[0].bullets[1]", null], notes: "Internship only", safeToAdd: "false" }] });
    expect(projected.requirementAnalysis).toHaveLength(1);
    expect(projected.requirementAnalysis[0]).toMatchObject({ sourceEvidence: ["base.experience[0].bullets[1]"], notes: "Internship only", safeToAdd: false });
  });
  it("gives coverage retry the original source for resolving its pointers", () => {
    const prompt = buildResumeForgeMissedRetryPrompt([{ requirement: "ArcGIS", sourceEvidence: ["base.experience[0].bullets[1]"] }], {}, { baseContent: base.content, confirmedSkills: ["SQL"], verifiedSkills: [] });
    expect(prompt).toContain("TAIL-EVIDENCE");
    expect(prompt).toContain("skills OR");
    expect(prompt).toContain("leave the claim absent");
  });
  it("recognizes grouped base skills and legacy object bullets as evidence", () => {
    const draft = { summary: null, skills: [{ title: "GIS", skills: ["ArcGIS", "SQL"] }], experience: [role(0, 2)], education: [], certifications: [] };
    const result = runDeterministicQa({ draft, baseResumeContent: { skills: [{ title: "GIS", skills: ["ArcGIS"] }], experience: [{ ...role(0, 1), bullets: undefined, bulletPoints: [{ text: "Queried SQL survey tables." }] }] }, jobAnalysis: null, pageFit: fit });
    expect(result.facts.skillsOutsidePool).toEqual([]);
    expect(result.warnings.some((w) => w.check === "bullet_count")).toBe(false);
  });
});

describe("final readiness is based on measured output", () => {
  const makeFinal = () => ({ ...finalFields, summary: null, skills: [], experience: [role(0, 1)], education: [], certifications: [], projects: [], pageFit: { ...fit }, unresolvedWarnings: [] as string[] });
  it.each([null, { ...fit, pageCount: 2, overflow: false }, { ...fit, readable: false }])("keeps the draft but blocks export readiness for invalid/unavailable PDF metrics %j", (pageFit) => {
    const final = { ...makeFinal(), pageFit };
    applyFinalReadinessChecks(final, {}, { hardFailures: [] });
    expect(final.exportReady).toBe(false);
    expect(final.experience).toHaveLength(1);
  });
  it("blocks a rejected critical edit even when the model also lists it as applied", () => {
    const final = { ...makeFinal(), appliedIssueIds: ["claim-1"], rejectedIssueIds: [{ issueId: "claim-1", reason: "Keep it" }] };
    applyFinalReadinessChecks(final, { requiredEdits: [{ issueId: "claim-1", severity: "critical" }] }, { hardFailures: [] });
    expect(final.exportReady).toBe(false);
  });
  it("never promotes a draft the model explicitly marked not ready", () => {
    const final = { ...makeFinal(), exportReady: false };
    applyFinalReadinessChecks(final, {}, { hardFailures: [] });
    expect(final.exportReady).toBe(false);
  });
  it("retains readiness for a measured clean final resume", () => {
    const final = makeFinal();
    applyFinalReadinessChecks(final, {}, { hardFailures: [] });
    expect(final.exportReady).toBe(true);
    expect(final.unresolvedWarnings).toEqual([]);
  });
});
