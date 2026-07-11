import { describe, it, expect } from "vitest";

describe("AI routing module placeholder", () => {
  it("loads without crash", async () => {
    const { estimateCost } = await import("@/lib/ai/pricing");
    const cost = estimateCost("anthropic", "claude-sonnet-4-6", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });
});
