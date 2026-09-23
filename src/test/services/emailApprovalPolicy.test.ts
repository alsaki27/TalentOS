import { describe, it, expect } from "vitest";
import { decideStatusWrite, normalizeMinimumScore, type EmailTriagePolicy } from "@/server/services/emailApprovalPolicy";

describe("normalizeMinimumScore", () => {
  it("treats a 0-10 scale value as the intended threshold (numeric(3,1) can't store 0.85 directly)", () => {
    expect(normalizeMinimumScore("8.5", 0.85)).toBeCloseTo(0.85);
    expect(normalizeMinimumScore(8.5, 0.85)).toBeCloseTo(0.85);
  });
  it("treats an already-fractional value as-is", () => {
    expect(normalizeMinimumScore("0.9", 0.85)).toBeCloseTo(0.9);
    expect(normalizeMinimumScore(0.9, 0.85)).toBeCloseTo(0.9);
  });
  it("falls back to the default for 0, null, undefined, or non-numeric input - Neon returns numeric columns as strings", () => {
    expect(normalizeMinimumScore("0", 0.85)).toBe(0.85);
    expect(normalizeMinimumScore(0, 0.85)).toBe(0.85);
    expect(normalizeMinimumScore(null, 0.85)).toBe(0.85);
    expect(normalizeMinimumScore(undefined, 0.85)).toBe(0.85);
    expect(normalizeMinimumScore("not-a-number", 0.85)).toBe(0.85);
    expect(normalizeMinimumScore(-1, 0.85)).toBe(0.85);
  });
});

describe("decideStatusWrite", () => {
  const riskBased: EmailTriagePolicy = { policy: "risk_based", threshold: 0.85, isActive: true, loadedFrom: "config" };
  const alwaysHuman: EmailTriagePolicy = { policy: "always_human", threshold: 0.85, isActive: true, loadedFrom: "config" };
  const auto: EmailTriagePolicy = { policy: "auto", threshold: 0.85, isActive: true, loadedFrom: "config" };
  const riskBasedInactive: EmailTriagePolicy = { policy: "risk_based", threshold: 0.85, isActive: false, loadedFrom: "config" };

  it("skips when there's no matched application or no stage target, regardless of policy", () => {
    expect(decideStatusWrite(auto, { category: "interview_invite", confidence: 0.99, hasMatchedApplication: false, stageTarget: "interview" }).action).toBe("skip");
    expect(decideStatusWrite(auto, { category: "recruiter_reply", confidence: 0.99, hasMatchedApplication: true, stageTarget: null }).action).toBe("skip");
  });

  it("fails closed: a disabled agent always proposes, never auto-writes, regardless of policy or confidence", () => {
    const result = decideStatusWrite(riskBasedInactive, { category: "offer", confidence: 0.99, hasMatchedApplication: true, stageTarget: "offer" });
    expect(result).toEqual({ action: "propose", rule: "agent_inactive" });
  });

  it("always_human always proposes, regardless of confidence", () => {
    expect(decideStatusWrite(alwaysHuman, { category: "offer", confidence: 0.99, hasMatchedApplication: true, stageTarget: "offer" }).action).toBe("propose");
    expect(decideStatusWrite(alwaysHuman, { category: "offer", confidence: 1.0, hasMatchedApplication: true, stageTarget: "offer" }).action).toBe("propose");
  });

  it("auto always auto-writes when there's a stage target and a matched application, regardless of confidence", () => {
    expect(decideStatusWrite(auto, { category: "interview_invite", confidence: 0.01, hasMatchedApplication: true, stageTarget: "interview" }).action).toBe("auto_write");
  });

  it("risk_based auto-writes an eligible category at or above threshold", () => {
    expect(decideStatusWrite(riskBased, { category: "interview_invite", confidence: 0.85, hasMatchedApplication: true, stageTarget: "interview" }).action).toBe("auto_write");
    expect(decideStatusWrite(riskBased, { category: "rejection", confidence: 0.9, hasMatchedApplication: true, stageTarget: "rejected" }).action).toBe("auto_write");
    expect(decideStatusWrite(riskBased, { category: "offer", confidence: 0.85, hasMatchedApplication: true, stageTarget: "offer" }).action).toBe("auto_write");
  });

  it("risk_based proposes an eligible category below threshold", () => {
    const result = decideStatusWrite(riskBased, { category: "interview_invite", confidence: 0.84, hasMatchedApplication: true, stageTarget: "interview" });
    expect(result).toEqual({ action: "propose", rule: "risk_based_below_threshold" });
  });

  it("risk_based proposes a stage-target category that isn't in AUTO_WRITE_CATEGORIES (scheduling), even at high confidence", () => {
    const result = decideStatusWrite(riskBased, { category: "scheduling", confidence: 0.99, hasMatchedApplication: true, stageTarget: "interview" });
    expect(result).toEqual({ action: "propose", rule: "risk_based_ineligible_category" });
  });

  it("application_confirmation uses its own fixed 0.9 bar under risk_based, independent of the configured threshold", () => {
    const lowThreshold: EmailTriagePolicy = { policy: "risk_based", threshold: 0.5, isActive: true, loadedFrom: "config" };
    expect(decideStatusWrite(lowThreshold, { category: "application_confirmation", confidence: 0.6, hasMatchedApplication: true, stageTarget: "applied" }).action).toBe("propose");
    expect(decideStatusWrite(lowThreshold, { category: "application_confirmation", confidence: 0.9, hasMatchedApplication: true, stageTarget: "applied" }).action).toBe("auto_write");
  });

  it("respects an admin-lowered or admin-raised threshold under risk_based", () => {
    const lenient: EmailTriagePolicy = { policy: "risk_based", threshold: 0.5, isActive: true, loadedFrom: "config" };
    const strict: EmailTriagePolicy = { policy: "risk_based", threshold: 0.99, isActive: true, loadedFrom: "config" };
    expect(decideStatusWrite(lenient, { category: "offer", confidence: 0.6, hasMatchedApplication: true, stageTarget: "offer" }).action).toBe("auto_write");
    expect(decideStatusWrite(strict, { category: "offer", confidence: 0.9, hasMatchedApplication: true, stageTarget: "offer" }).action).toBe("propose");
  });
});
