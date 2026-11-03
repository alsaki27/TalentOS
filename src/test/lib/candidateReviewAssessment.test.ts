import { describe, expect, it } from "vitest";
import { assessmentForHumanReview } from "@/lib/candidateReviewAssessment";

describe("assessmentForHumanReview", () => {
  it.each(["strong", "adjacent", "stretch"] as const)("preserves the %s assessment", tier => {
    expect(assessmentForHumanReview({ tier, reason: "Evidence", hardGates: ["License unclear"] }))
      .toEqual({ aiTier: tier, aiReason: "Evidence", hardGates: ["License unclear"] });
  });
  it("keeps an AI rejection visible without making it a human rejection or an invalid database tier", () => {
    const assessment = { tier: "reject" as const, reason: "Different profession", hardGates: ["License unclear"] };
    const review = assessmentForHumanReview(assessment);
    expect(review.aiTier).toBeNull();
    expect(review.aiReason).toBe("AI assessment: not recommended. Different profession");
    expect(review.hardGates).toContain("License unclear");
    expect(review.hardGates).toContain("AI did not recommend this pairing; a human reviewer must decide.");
    expect(assessment.hardGates).toEqual(["License unclear"]);
  });
});
