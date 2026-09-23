import { describe, it, expect } from "vitest";
import {
  deriveDisposition,
  buildDataDrivenReasons,
  applyDispositionRules,
} from "@/lib/ai/application-agents/disposition";
import { ReviewScoreSchema } from "@/lib/ai/application-agents/schemas";

const analysis = {
  requirementAnalysis: [
    { requirement: "AutoCAD", category: "tool", sourceEvidence: ["base.skills[0]"], status: "supported_by_resume", safeToAdd: true },
    { requirement: "PE License", category: "credential", sourceEvidence: [], status: "hard_blocker", safeToAdd: false },
    { requirement: "Security clearance", category: "clearance", sourceEvidence: [], status: "unsupported", safeToAdd: false },
  ],
};

describe("deriveDisposition", () => {
  it("rejects on any hard blocker regardless of passFail", () => {
    expect(deriveDisposition("pass", analysis as any)).toBe("reject");
    expect(deriveDisposition("review", analysis as any)).toBe("reject");
  });

  it("maps passFail when no blockers exist", () => {
    const clean = { requirementAnalysis: [] };
    expect(deriveDisposition("pass", clean)).toBe("pursue");
    expect(deriveDisposition("review", clean)).toBe("review");
    expect(deriveDisposition("fail", clean)).toBe("reject");
  });

  it("deprioritizes on unsupported required credentials", () => {
    const withCred = {
      requirementAnalysis: [
        { requirement: "PE License", category: "credential", sourceEvidence: [], status: "unsupported", safeToAdd: false },
      ],
    };
    expect(deriveDisposition("pass", withCred as any)).toBe("deprioritize");
    expect(deriveDisposition("review", withCred as any)).toBe("deprioritize");
  });

  it("ignores unsupported skills/tools (not credentials)", () => {
    const withSkill = {
      requirementAnalysis: [
        { requirement: "AutoCAD", category: "tool", sourceEvidence: [], status: "unsupported", safeToAdd: false },
      ],
    };
    expect(deriveDisposition("pass", withSkill as any)).toBe("pursue");
  });
});

describe("buildDataDrivenReasons", () => {
  it("names hard blockers and unsupported credentials specifically", () => {
    const reasons = buildDataDrivenReasons(analysis as any);
    expect(reasons.some((r) => r.includes("PE License"))).toBe(true);
    expect(reasons.some((r) => r.includes("Security clearance"))).toBe(true);
  });

  it("returns empty when nothing is gated", () => {
    expect(buildDataDrivenReasons({ requirementAnalysis: [] })).toEqual([]);
    expect(buildDataDrivenReasons(null)).toEqual([]);
  });
});

describe("applyDispositionRules", () => {
  const baseReview = ReviewScoreSchema.parse({
    atsScore: 9,
    recruiterScore: 8,
    roleFitScore: 8,
    truthfulnessRisk: 0,
    passFail: "pass",
    disposition: "pursue",
    dispositionReasons: [],
  });

  it("forces reject with reasons when a hard blocker exists", () => {
    if ("error" in baseReview) throw new Error(baseReview.error);
    const result = applyDispositionRules(baseReview, analysis as any);
    expect(result.disposition).toBe("reject");
    expect(result.dispositionReasons.length).toBeGreaterThan(0);
    expect(result.dispositionReasons.some((r) => r.includes("PE License"))).toBe(true);
  });

  it("keeps model reasons and de-dupes with data reasons", () => {
    if ("error" in baseReview) throw new Error(baseReview.error);
    const withReasons = { ...baseReview, dispositionReasons: ["Weak credential fit"] };
    const result = applyDispositionRules(withReasons, analysis as any);
    expect(result.dispositionReasons).toContain("Weak credential fit");
    expect(result.dispositionReasons.filter((r) => r.includes("PE License")).length).toBe(1);
  });
});
