// Hard test: quality gate logic.
// Tests every branch: auto-pass, review, fail, edge cases.

import { describe, it, expect } from "vitest";
import { evaluateQualityGate } from "@/lib/ai/application-agents/qualityGate";
import type { ReviewScoreV1 } from "@/lib/ai/application-agents/schemas";

function makeReview(overrides: Partial<ReviewScoreV1> = {}): ReviewScoreV1 {
  return {
    atsScore: 8,
    recruiterScore: 7,
    roleFitScore: 7,
    truthfulnessRisk: 2,
    formattingIssues: [],
    requiredEdits: [],
    optionalEdits: [],
    passFail: "pass",
    overallComment: "",
    ...overrides,
  };
}

describe("evaluateQualityGate", () => {
  it("auto-passes when all scores are high and passFail is pass", async () => {
    const result = await evaluateQualityGate(makeReview(), "app-1");
    expect(result.passed).toBe(true);
    expect(result.action).toBe("auto");
    expect(result.reason).toBeNull();
  });

  it("fails when ATS score is below minimum (4)", async () => {
    const result = await evaluateQualityGate(makeReview({ atsScore: 3 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("fail");
    expect(result.reason).toContain("ATS score");
  });

  it("fails when recruiter score is below minimum (4)", async () => {
    const result = await evaluateQualityGate(makeReview({ recruiterScore: 2 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("fail");
  });

  it("fails when role-fit score is below minimum (4)", async () => {
    const result = await evaluateQualityGate(makeReview({ roleFitScore: 3 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("fail");
  });

  it("fails when truthfulness risk is at max threshold (7)", async () => {
    const result = await evaluateQualityGate(makeReview({ truthfulnessRisk: 7 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("fail");
    expect(result.reason).toContain("Truthfulness risk");
  });

  it("fails when truthfulness risk exceeds max (8)", async () => {
    const result = await evaluateQualityGate(makeReview({ truthfulnessRisk: 8 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("fail");
  });

  it("requires review when ATS score is below auto-pass threshold (6)", async () => {
    const result = await evaluateQualityGate(makeReview({ atsScore: 5 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("review");
  });

  it("requires review when role-fit score is below auto-pass threshold (6)", async () => {
    const result = await evaluateQualityGate(makeReview({ roleFitScore: 5 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("review");
  });

  it("requires review when passFail is 'fail' even with decent scores", async () => {
    const result = await evaluateQualityGate(makeReview({ passFail: "fail", atsScore: 7, roleFitScore: 7 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("review");
  });

  it("requires review when passFail is 'review'", async () => {
    const result = await evaluateQualityGate(makeReview({ passFail: "review" }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("review");
  });

  it("boundary: atsScore at exactly minimum (4) passes the fail check but may need review", async () => {
    const result = await evaluateQualityGate(makeReview({ atsScore: 4, roleFitScore: 7 }), "app-1");
    expect(result.passed).toBe(false); // below review threshold (6)
    expect(result.action).toBe("review");
  });

  it("boundary: recruiter score exactly at minimum (4) is not a hard fail", async () => {
    const result = await evaluateQualityGate(makeReview({ recruiterScore: 4, atsScore: 7, roleFitScore: 7 }), "app-1");
    expect(result.passed).toBe(true); // all other scores good
    expect(result.action).toBe("auto");
  });

  it("boundary: truthfulness risk exactly below max (6) does not fail", async () => {
    const result = await evaluateQualityGate(makeReview({ truthfulnessRisk: 6, atsScore: 7, roleFitScore: 7 }), "app-1");
    expect(result.passed).toBe(true);
  });

  it("defaults to review when no condition is clearly met (edge case)", async () => {
    const result = await evaluateQualityGate(makeReview({ passFail: "review", atsScore: 9, roleFitScore: 9 }), "app-1");
    expect(result.passed).toBe(false);
    expect(result.action).toBe("review");
  });
});
