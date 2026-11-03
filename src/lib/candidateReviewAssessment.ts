type Assessment = {
  tier: "strong" | "adjacent" | "stretch" | "reject";
  reason: string;
  hardGates: string[];
};

/** An AI rejection is evidence for a reviewer, not a rejection by a human. */
export function assessmentForHumanReview(assessment: Assessment) {
  const notRecommended = assessment.tier === "reject";
  return {
    // The existing review table accepts the three fit tiers or NULL. Do not
    // disguise an AI rejection as Stretch or write an unsupported tier.
    aiTier: notRecommended ? null : assessment.tier,
    aiReason: notRecommended
      ? `AI assessment: not recommended. ${assessment.reason}`
      : assessment.reason,
    hardGates: notRecommended
      ? [...new Set([...assessment.hardGates, "AI did not recommend this pairing; a human reviewer must decide."])]
      : assessment.hardGates,
  };
}
