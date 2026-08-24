import { describe, it, expect } from "vitest";
import { computeFinalScores } from "@/lib/ai/application-agents/finalResumeScoring";

const requirementAnalysis = [
  { requirement: "AutoCAD", category: "tool", sourceEvidence: ["base.skills[0]"], status: "supported_by_resume", safeToAdd: true },
  { requirement: "Vetro FiberMap", category: "tool", sourceEvidence: ["sot:Vetro FiberMap"], status: "supported_but_not_surfaced", safeToAdd: true },
  { requirement: "PE License", category: "credential", sourceEvidence: [], status: "hard_blocker", safeToAdd: false },
];

describe("computeFinalScores", () => {
  it("scores ATS from supported coverage on the final text", () => {
    const full = computeFinalScores({
      finalText: "Designed routes in AutoCAD and managed fiber designs with Vetro FiberMap",
      requirementAnalysis: requirementAnalysis as any,
      review: null,
    });
    // Both supported requirements surfaced, SoT-backed one weighs 1.5x.
    expect(full.supportedCoverage).toBe(1);
    expect(full.atsScore).toBe(10);
  });

  it("docks ATS for missed supported requirements and never credits unsupported", () => {
    const partial = computeFinalScores({
      finalText: "Managed fiber designs",
      requirementAnalysis: requirementAnalysis as any,
      review: null,
    });
    expect(partial.supportedCoverage).toBe(0);
    expect(partial.atsScore).toBe(0);
  });

  it("caps role fit when disposition is reject and hard blockers exist", () => {
    const scores = computeFinalScores({
      finalText: "Great ATS keywords everywhere AutoCAD Vetro",
      requirementAnalysis: requirementAnalysis as any,
      review: { atsScore: 9, recruiterScore: 8, roleFitScore: 9, truthfulnessRisk: 0, disposition: "reject" },
    });
    expect(scores.atsScore).toBe(10); // high ATS cannot rescue role fit
    expect(scores.roleFitScore).toBeLessThanOrEqual(4);
  });

  it("penalizes recruiter score for page overflow", () => {
    const overflow = computeFinalScores({
      finalText: "x",
      requirementAnalysis: [],
      review: { recruiterScore: 8 },
      pageFit: { pageCount: 2, contentUtilization: 1, bottomWhitespaceInches: 0, overflow: true, readable: true, recommendation: "trim" },
    });
    expect(overflow.recruiterScore).toBe(7);
  });

  it("derives truth score from truthfulnessRisk", () => {
    const scores = computeFinalScores({
      finalText: "x",
      requirementAnalysis: [],
      review: { truthfulnessRisk: 2.5 },
    });
    expect(scores.truthScore).toBe(7.5);
  });

  it("falls back to reviewer ATS when no classified requirements exist", () => {
    const scores = computeFinalScores({
      finalText: "x",
      requirementAnalysis: [],
      review: { atsScore: 8.4, roleFitScore: 7, recruiterScore: 7 },
    });
    expect(scores.atsScore).toBe(8.4);
    expect(scores.supportedCoverage).toBeNull();
  });

  it("returns sane defaults with no inputs at all", () => {
    const scores = computeFinalScores({ finalText: "" });
    expect(scores.atsScore).toBe(5);
    expect(scores.roleFitScore).toBe(5);
    expect(scores.recruiterScore).toBe(5);
    expect(scores.truthScore).toBe(10);
  });
});
