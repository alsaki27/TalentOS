// Quality gate — decides whether a review passes, needs human review, or fails.

import type { ReviewScoreV1 } from "./schemas";

export interface QualityGateResult {
  passed: boolean;
  reason: string | null;
  action: "auto" | "review" | "fail";
}

const MIN_ATS_SCORE = 4;
const MIN_RECRUITER_SCORE = 4;
const MIN_ROLE_FIT_SCORE = 4;
const MAX_TRUTH_RISK = 7;
const REVIEW_ATS_THRESHOLD = 6;
const REVIEW_ROLE_FIT_THRESHOLD = 6;

export async function evaluateQualityGate(
  review: ReviewScoreV1,
  _applicationId: string
): Promise<QualityGateResult> {
  // Hard fail conditions
  if (review.atsScore < MIN_ATS_SCORE) {
    return {
      passed: false,
      reason: `ATS score (${review.atsScore}) below minimum (${MIN_ATS_SCORE})`,
      action: "fail",
    };
  }
  if (review.recruiterScore < MIN_RECRUITER_SCORE) {
    return {
      passed: false,
      reason: `Recruiter score (${review.recruiterScore}) below minimum (${MIN_RECRUITER_SCORE})`,
      action: "fail",
    };
  }
  if (review.roleFitScore < MIN_ROLE_FIT_SCORE) {
    return {
      passed: false,
      reason: `Role-fit score (${review.roleFitScore}) below minimum (${MIN_ROLE_FIT_SCORE})`,
      action: "fail",
    };
  }
  if (review.truthfulnessRisk >= MAX_TRUTH_RISK) {
    return {
      passed: false,
      reason: `Truthfulness risk (${review.truthfulnessRisk}) exceeds maximum (${MAX_TRUTH_RISK})`,
      action: "fail",
    };
  }

  // Review required
  if (review.atsScore < REVIEW_ATS_THRESHOLD || review.roleFitScore < REVIEW_ROLE_FIT_THRESHOLD || review.passFail === "fail") {
    return {
      passed: false,
      reason: `Scores below auto-pass threshold — human review required`,
      action: "review",
    };
  }

  // Auto-pass
  if (review.passFail === "pass" && review.atsScore >= REVIEW_ATS_THRESHOLD && review.roleFitScore >= REVIEW_ROLE_FIT_THRESHOLD) {
    return {
      passed: true,
      reason: null,
      action: "auto",
    };
  }

  // Default to review
  return {
    passed: false,
    reason: "Quality gate defaulted to review",
    action: "review",
  };
}
