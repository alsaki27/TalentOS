// Hard test: pricing table, routing service.
// Tests cost estimation, edge cases, and provider name resolution.

import { describe, it, expect } from "vitest";
import { estimateCost, listPricingModels } from "@/lib/ai/pricing";

describe("pricing table", () => {
  it("estimates anthropic claude-sonnet-4-6 cost correctly", () => {
    const cost = estimateCost("anthropic", "claude-sonnet-4-6", 1000, 500);
    expect(cost).toBeCloseTo(0.003 * 1 + 0.015 * 0.5, 5);
  });

  it("estimates openai gpt-4o-mini cost correctly", () => {
    const cost = estimateCost("openai", "gpt-4o-mini", 2000, 1000);
    expect(cost).toBeCloseTo(0.0005 * 2 + 0.0015 * 1, 5);
  });

  it("returns null for unknown model", () => {
    const cost = estimateCost("anthropic", "claude-unknown-model", 100, 50);
    expect(cost).toBeNull();
  });

  it("returns null for unknown provider", () => {
    const cost = estimateCost("unknown_provider", "some-model", 100, 50);
    expect(cost).toBeNull();
  });

  it("returns null when no tokens provided", () => {
    const cost = estimateCost("anthropic", "claude-sonnet-4-6", null, null);
    expect(cost).toBeNull();
  });

  it("handles zero input tokens", () => {
    const cost = estimateCost("nvidia", "moonshotai/kimi-k2.6", 0, 100);
    expect(cost).toBeGreaterThan(0);
  });

  it("estimates glm-4-plus cost correctly", () => {
    const cost = estimateCost("glm", "glm-4-plus", 1000, 1000);
    expect(cost).toBeCloseTo(0.001 * 1 + 0.001 * 1, 5);
  });

  it("returns valid model list from listPricingModels", () => {
    const models = listPricingModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty("provider");
    expect(models[0]).toHaveProperty("model");
    expect(models[0]).toHaveProperty("inputPer1kUsd");
    expect(models[0]).toHaveProperty("outputPer1kUsd");
  });

  it("handles case-insensitive model matching", () => {
    const cost1 = estimateCost("openai", "GPT-4O", 100, 50);
    const cost2 = estimateCost("openai", "gpt-4o", 100, 50);
    expect(cost1).toBe(cost2);
  });

  it("handles null model gracefully", () => {
    const cost = estimateCost("anthropic", null, 100, 50);
    expect(cost).toBeNull();
  });
});
