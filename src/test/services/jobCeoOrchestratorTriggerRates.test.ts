// Regression coverage for the Adzuna recovery-queue plan's Phase 4 fix
// (2026-10-25): the CEO Orchestrator's self-tuning trigger used to compute
// deepFetchFailureRate from run.kept_count/researched_count, which silently
// never crossed its own 0.3 threshold for Adzuna runs (those counters don't
// reconcile — researched_count routinely exceeds kept_count in production,
// making the old formula negative). computeOrchestratorTriggerRates derives
// both rates from job_ceo_staging's actual stage column instead.

import { describe, expect, it } from "vitest";
import { computeOrchestratorTriggerRates } from "@/server/services/jobCeoService";

function rows(counts: Record<string, number>) {
  return Object.entries(counts).map(([stage, count]) => ({ stage, count: String(count) }));
}

describe("computeOrchestratorTriggerRates", () => {
  it("matches the live Adzuna window this fix was built from (161 no_description / 242 total) — crosses the 0.3 trigger", () => {
    // Shape of the actual Oct 21-25 2026 Adzuna production data: 161
    // no_description, 48 qa_dropped, 32 logged, 1 error, 0 still transient.
    const { deepFetchFailureRate, qaDropRate } = computeOrchestratorTriggerRates(
      rows({ no_description: 161, qa_dropped: 48, logged: 32, error: 1 })
    );

    // 161 / (161 + 48 + 32) = 0.6694... — well above the 0.3 trigger, unlike
    // the old kept_count/researched_count formula, which could not cross it.
    expect(deepFetchFailureRate).toBeCloseTo(161 / 241, 4);
    expect(deepFetchFailureRate).toBeGreaterThan(0.3);
    // 48 / (48 + 32) = 0.6 exactly — right at, not over, the 0.6 QA trigger.
    expect(qaDropRate).toBeCloseTo(0.6, 4);
  });

  it("never goes negative or above 1, unlike the old counter-based formula (no kept_count/researched_count mismatch is possible here)", () => {
    const { deepFetchFailureRate, qaDropRate } = computeOrchestratorTriggerRates(
      rows({ no_description: 5, researched: 50, qa_passed: 10, qa_dropped: 2, matched: 1, logged: 30 })
    );
    expect(deepFetchFailureRate).toBeGreaterThanOrEqual(0);
    expect(deepFetchFailureRate).toBeLessThanOrEqual(1);
    expect(qaDropRate).toBeGreaterThanOrEqual(0);
    expect(qaDropRate).toBeLessThanOrEqual(1);
  });

  it("returns 0 for both rates when there is no data yet, instead of dividing by zero", () => {
    const { deepFetchFailureRate, qaDropRate } = computeOrchestratorTriggerRates([]);
    expect(deepFetchFailureRate).toBe(0);
    expect(qaDropRate).toBe(0);
  });

  it("counts a still-transient 'researched' row (not yet QA'd) as a Deep Fetch success, not a failure", () => {
    const { deepFetchFailureRate } = computeOrchestratorTriggerRates(rows({ researched: 5 }));
    expect(deepFetchFailureRate).toBe(0);
  });

  it("does not count qa_dropped against deepFetchFailureRate (those rows already passed Deep Fetch)", () => {
    const { deepFetchFailureRate } = computeOrchestratorTriggerRates(rows({ qa_dropped: 100 }));
    expect(deepFetchFailureRate).toBe(0);
  });

  it("does not count no_description rows against qaDropRate (those rows never reached QA)", () => {
    const { qaDropRate } = computeOrchestratorTriggerRates(rows({ no_description: 100 }));
    expect(qaDropRate).toBe(0);
  });
});
