import { describe, it, expect } from "vitest";
import { runDeterministicQa, bulletCountRuleForIndex } from "@/lib/ai/application-agents/deterministicQa";
import type { ResumeDraftV1 } from "@/lib/ai/application-agents/schemas";

function cleanDraft(overrides: Partial<ResumeDraftV1> = {}): ResumeDraftV1 {
  return {
    summary: "Experienced GIS analyst.",
    skills: [{ title: "Core", skills: ["ArcGIS", "AutoCAD"] }],
    experience: [
      {
        title: "GIS Analyst",
        company: "Acme Corp",
        location: "Remote",
        startDate: "2022-01",
        endDate: null,
        bullets: ["Bullet one", "Bullet two", "Bullet three", "Bullet four", "Bullet five", "Bullet six"],
        evidenceIds: [],
      },
    ],
    education: [{ degree: "B.S. GIS", school: "State University", field: null, graduationDate: "2021" }],
    certifications: [],
    projects: [],
    changeLog: [],
    missingRequirements: [],
    excludedKeywords: [],
    truthRisks: [],
    ...overrides,
  } as ResumeDraftV1;
}

const CLEAN_BASE_CONTENT = {
  summary: "Experienced GIS analyst.",
  skills: ["ArcGIS", "AutoCAD"],
  experience: [
    { title: "GIS Analyst", company: "Acme Corp", location: "Remote", startDate: "2022-01", endDate: null, bullets: ["Base bullet"] },
  ],
  education: [{ degree: "B.S. GIS", school: "State University", graduationDate: "2021" }],
};

const PASSING_PAGE_FIT = {
  pageCount: 1,
  contentUtilization: 0.9,
  bottomWhitespaceInches: 0.2,
  overflow: false,
  readable: true,
  recommendation: "pass" as const,
};

describe("runDeterministicQa", () => {
  it("reports ok:true with no hard failures for a clean, base-conformant resume", () => {
    const result = runDeterministicQa({
      draft: cleanDraft(),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: { requirementAnalysis: [] },
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(true);
    expect(result.hardFailures).toEqual([]);
  });

  it("flags identity drift as a hard failure when title/company differ from base", () => {
    const draft = cleanDraft({
      experience: [
        {
          title: "Senior GIS Lead",
          company: "Different Company",
          location: "Remote",
          startDate: "2022-01",
          endDate: null,
          bullets: ["a", "b", "c", "d", "e", "f"],
          evidenceIds: [],
        },
      ],
    });
    const result = runDeterministicQa({
      draft,
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(false);
    expect(result.hardFailures.some((f) => f.check === "identity_drift")).toBe(true);
    expect(result.facts.identityDrift.some((d) => d.includes("title"))).toBe(true);
    expect(result.facts.identityDrift.some((d) => d.includes("company"))).toBe(true);
  });

  it("flags missing education as a hard failure when the base resume has education", () => {
    const result = runDeterministicQa({
      draft: cleanDraft({ education: [] }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(false);
    expect(result.hardFailures.some((f) => f.check === "education_missing")).toBe(true);
  });

  it("flags a missing summary as a hard failure when the base resume has one", () => {
    const result = runDeterministicQa({
      draft: cleanDraft({ summary: null }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(false);
    expect(result.hardFailures.some((f) => f.check === "summary_missing")).toBe(true);
  });

  it("warns (does not hard-fail) when a summary exists but the base resume has none", () => {
    const result = runDeterministicQa({
      draft: cleanDraft({ summary: "Invented summary" }),
      baseResumeContent: { ...CLEAN_BASE_CONTENT, summary: undefined },
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.hardFailures).toEqual([]);
    expect(result.warnings.some((w) => w.check === "summary_invented")).toBe(true);
  });

  it("treats page overflow and the readability floor as hard failures", () => {
    const result = runDeterministicQa({
      draft: cleanDraft(),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: { pageCount: 2, contentUtilization: 1.1, bottomWhitespaceInches: 0, overflow: true, readable: false, recommendation: "trim" },
    });
    expect(result.ok).toBe(false);
    expect(result.hardFailures.map((f) => f.check).sort()).toEqual(["page_overflow", "readability_floor"]);
  });

  it("treats a null pageFit as neither pass nor fail (rendering unavailable)", () => {
    const result = runDeterministicQa({
      draft: cleanDraft(),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: null,
    });
    expect(result.hardFailures.some((f) => f.check === "page_overflow" || f.check === "readability_floor")).toBe(false);
  });

  it("warns (not hard-fails) on a bullet count outside the min-max range for that role position", () => {
    expect(bulletCountRuleForIndex(0)).toEqual({ min: 6, max: 7 });
    const result = runDeterministicQa({
      draft: cleanDraft({
        experience: [
          {
            title: "GIS Analyst", company: "Acme Corp", location: "Remote", startDate: "2022-01", endDate: null,
            bullets: ["only", "two"], evidenceIds: [],
          },
        ],
      }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(true); // bullet count is a warning, never a hard failure
    expect(result.warnings.some((w) => w.check === "bullet_count")).toBe(true);
    expect(result.facts.bulletCounts[0].withinRange).toBe(false);
  });

  it("warns (not hard-fails) on a duplicate skill across two different categories", () => {
    const result = runDeterministicQa({
      draft: cleanDraft({
        skills: [
          { title: "Core", skills: ["ArcGIS"] },
          { title: "Other", skills: ["arcgis"] }, // same skill, different casing, different category
        ],
      }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.check === "duplicate_skill")).toBe(true);
    expect(result.facts.duplicateSkills).toContain("arcgis");
  });

  it("flags (warns, never removes) a skill with no support anywhere in the allowed pool", () => {
    const result = runDeterministicQa({
      draft: cleanDraft({ skills: [{ title: "Core", skills: ["ArcGIS", "Quantum Computing"] }] }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(true); // v1 flags, never enforces
    expect(result.warnings.some((w) => w.check === "skill_outside_pool" && w.detail.includes("Quantum Computing"))).toBe(true);
    // ArcGIS is in the base resume's skills, so it must not be flagged.
    expect(result.facts.skillsOutsidePool).not.toContain("ArcGIS");
  });

  it("recognizes a skill supported only via Source of Truth / verified skills / evidence bank, not just the base resume", () => {
    const result = runDeterministicQa({
      draft: cleanDraft({ skills: [{ title: "Core", skills: ["Vetro FiberMap"] }] }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      sourceOfTruth: { confirmedSkills: ["Vetro FiberMap"] },
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.facts.skillsOutsidePool).toEqual([]);
  });

  it("surfaces missed supported requirements as a warning via the existing coverage engine", () => {
    const result = runDeterministicQa({
      draft: cleanDraft(),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: {
        requirementAnalysis: [
          { requirement: "Vetro FiberMap", category: "tool", sourceEvidence: ["sot:Vetro FiberMap"], status: "supported_but_not_surfaced", safeToAdd: true },
        ],
      },
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.warnings.some((w) => w.check === "requirement_coverage")).toBe(true);
    expect(result.facts.coverage).toHaveLength(1);
  });

  it("never mutates the input draft (validateEvidenceCitations mutates its argument, so this module must clone before calling it)", () => {
    const draft = cleanDraft({
      experience: [
        {
          title: "GIS Analyst", company: "Acme Corp", location: "Remote", startDate: "2022-01", endDate: null,
          bullets: ["a", "b", "c", "d", "e", "f"], evidenceIds: ["fabricated-id-not-in-evidence-bank"],
        },
      ],
    });
    const snapshot = JSON.parse(JSON.stringify(draft));
    runDeterministicQa({
      draft,
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      evidence: [{ id: "real-evidence-id" }],
      pageFit: PASSING_PAGE_FIT,
    });
    expect(draft).toEqual(snapshot);
  });

  it("flags a large draft with a word-count warning without affecting ok/hardFailures", () => {
    const longBullet = "Delivered a detailed accomplishment with quantified results and technical depth. ".repeat(20);
    const result = runDeterministicQa({
      draft: cleanDraft({
        experience: [
          { title: "GIS Analyst", company: "Acme Corp", location: "Remote", startDate: "2022-01", endDate: null, bullets: Array(6).fill(longBullet), evidenceIds: [] },
        ],
      }),
      baseResumeContent: CLEAN_BASE_CONTENT,
      jobAnalysis: null,
      pageFit: PASSING_PAGE_FIT,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.check === "word_budget")).toBe(true);
  });
});
