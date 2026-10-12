// AI-usage reduction: QA Bouncer previously called AI on every staged job
// unconditionally, only falling back to its own regex classifier if the AI call
// failed. The existing regex classifier is confident enough on two cases to skip
// the AI call entirely - an obvious false-positive-industry title (e.g. "Software
// Engineer") and 3+ strong target-industry keyword matches - without touching the
// AI call used for everything else (thin/ambiguous signal).

import { describe, it, expect, vi } from "vitest";
import { runQaBouncer } from "@/lib/ai/job-agents/qaBouncer";
import type { AiProvider } from "@/lib/ai/provider";
import type { JobCeoAgentContext, StagedJob } from "@/lib/ai/job-agents/types";

function makeProvider(): AiProvider & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify({ keep: true, score: 99, tier: "best", reason: "AI verdict" }) }],
      stopReason: "end_turn",
    }),
  };
}

function ctxFor(stagedJob: Partial<StagedJob>): JobCeoAgentContext {
  return { runId: "run-1", previousOutputs: { stagedJob } };
}

describe("runQaBouncer — regex pre-filter short-circuit", () => {
  it("skips the AI call for an obvious false-positive-industry title", async () => {
    const provider = makeProvider();
    const verdict = await runQaBouncer({}, provider, ctxFor({ title: "Senior Software Engineer", description_text: "Build web apps." }));

    expect(provider.send).not.toHaveBeenCalled();
    expect(verdict.keep).toBe(false);
    expect(verdict.tier).toBe("skip");
    expect(verdict.reason).toContain("False positive match");
  });

  it("skips the AI call when 3+ strong target-industry keywords match", async () => {
    const provider = makeProvider();
    const verdict = await runQaBouncer(
      {},
      provider,
      ctxFor({ title: "OSP Design Engineer", description_text: "Fiber route design, outside plant construction, and GIS mapping for telecom infrastructure." })
    );

    expect(provider.send).not.toHaveBeenCalled();
    expect(verdict.keep).toBe(true);
    expect(verdict.tier).toBe("best");
  });

  it("still calls AI for an ambiguous case (thin/weak signal) and returns the AI verdict", async () => {
    const provider = makeProvider();
    const verdict = await runQaBouncer(
      {},
      provider,
      ctxFor({ title: "Field Engineer", description_text: "General engineering role, details TBD, fiber mentioned once." })
    );

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(verdict.score).toBe(99);
    expect(verdict.reason).toBe("AI verdict");
  });

  it("falls back to the regex verdict (not a second regex computation) when AI fails on an ambiguous case", async () => {
    const provider: AiProvider = { send: vi.fn().mockRejectedValue(new Error("timeout")) };
    const verdict = await runQaBouncer(
      {},
      provider,
      ctxFor({ title: "Field Engineer", description_text: "General engineering role, details TBD, fiber mentioned once." })
    );

    expect(verdict.tier).toBe("medium");
    expect(verdict.keep).toBe(true);
  });
});
