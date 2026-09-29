// Regression tests for B2/B3 (2026-09-28): Final Polish and Hiring Panel
// used to send raw JSON.stringify(jobAnalysis/draft).slice(N), which
// truncated requirementAnalysis in ~40% of real runs (job analysis averages
// 8,911 chars against a 4,000-char Final Polish slice) and draft content in
// 98% of real runs (drafts average 10,510 chars against an 8,000-char Final
// Polish slice). These tests prove the projection never drops the fields
// each prompt actually depends on, regardless of input size.
import { describe, it, expect } from "vitest";
import { projectJobAnalysisForReview, projectDraftForReview } from "@/lib/ai/application-agents/promptProjections";

describe("projectJobAnalysisForReview", () => {
  it("keeps every requirementAnalysis row regardless of how large the job analysis is", () => {
    // A large rawSummary and many unrelated fields - the exact shape that
    // used to push requirementAnalysis past a fixed character slice.
    const manyRequirements = Array.from({ length: 60 }, (_, i) => ({
      requirement: `Requirement ${i}`,
      category: "skill",
      sourceEvidence: [`base.experience[0].bullets[${i}]`],
      status: i % 5 === 0 ? "hard_blocker" : "supported_by_resume",
      safeToAdd: i % 5 !== 0,
      notes: "x".repeat(200), // bulk that would have pushed later keys past a slice
    }));
    const jobAnalysis = {
      title: "Senior Engineer",
      company: "Acme",
      domain: "Infra",
      seniority: "Senior",
      rawSummary: "y".repeat(5000),
      atsKeywords: ["Kubernetes", "Go"],
      prohibitedUnsupportedClaims: ["PE license"],
      requirementAnalysis: manyRequirements,
    };

    const projected = projectJobAnalysisForReview(jobAnalysis);

    expect(projected.requirementAnalysis).toHaveLength(60);
    expect(projected.requirementAnalysis[59].text).toBe("Requirement 59");
    expect(projected.requirementAnalysis.filter((r) => r.status === "hard_blocker")).toHaveLength(12);
    expect(projected.atsKeywords).toEqual(["Kubernetes", "Go"]);
    expect(projected.prohibitedUnsupportedClaims).toEqual(["PE license"]);
    // The bulky, per-prompt-unused fields must not be present.
    expect(JSON.stringify(projected)).not.toContain("y".repeat(100));
  });

  it("degrades gracefully when requirementAnalysis is missing or malformed", () => {
    expect(projectJobAnalysisForReview({}).requirementAnalysis).toEqual([]);
    expect(projectJobAnalysisForReview(null).requirementAnalysis).toEqual([]);
    expect(projectJobAnalysisForReview({ requirementAnalysis: "not an array" }).requirementAnalysis).toEqual([]);
  });
});

describe("projectDraftForReview", () => {
  it("keeps every role's bullets and evidenceIds regardless of how large the draft is", () => {
    const manyRoles = Array.from({ length: 8 }, (_, i) => ({
      title: `Role ${i}`,
      company: `Company ${i}`,
      startDate: `202${i}-01`,
      endDate: "Present",
      evidenceIds: [`ev-${i}-a`, `ev-${i}-b`],
      bullets: Array.from({ length: 6 }, (_, j) => `LAST-BULLET-MARKER-${i}-${j} ` + "detailed accomplishment ".repeat(10)),
    }));
    const draft = {
      summary: "A tailored summary",
      skills: [{ name: "Core", skills: ["Go", "Kubernetes"] }],
      experience: manyRoles,
      education: [{ degree: "B.S.", school: "State U" }],
      certifications: ["CKA"],
      projects: [],
      // Bulky Resume-Forge-internal fields that must be dropped.
      changeLog: Array.from({ length: 50 }, () => "z".repeat(200)),
      missingRequirements: ["irrelevant"],
      excludedKeywords: ["irrelevant"],
      truthRisks: [],
    };

    const projected = projectDraftForReview(draft);

    expect(projected.experience).toHaveLength(8);
    // The very last bullet of the very last role - exactly what an 8,000-
    // char slice would have cut off under the old behavior.
    const lastRole = projected.experience[7] as any;
    expect(lastRole.bullets[5]).toMatch(/LAST-BULLET-MARKER-7-5/);
    expect(lastRole.evidenceIds).toEqual(["ev-7-a", "ev-7-b"]);
    expect(projected.education).toEqual(draft.education);
    expect(projected.certifications).toEqual(draft.certifications);
    // Resume-Forge-internal bookkeeping must not be forwarded.
    expect(JSON.stringify(projected)).not.toContain("z".repeat(100));
    expect((projected as any).changeLog).toBeUndefined();
    expect((projected as any).missingRequirements).toBeUndefined();
  });
});
