// Phase 5 (2026-09-28): stopReason==="max_tokens" was never checked, so a
// truncated response's cut-off JSON just threw a generic SyntaxError,
// indistinguishable from genuinely malformed/hallucinated output.
import { describe, it, expect } from "vitest";
import { assertNotTruncated, classifyAiErrorCode } from "@/lib/ai/routing";

describe("assertNotTruncated", () => {
  it("throws a clearly-labeled error when stopReason is max_tokens", () => {
    expect(() => assertNotTruncated({ stopReason: "max_tokens" }, "Resume Forge (draft)")).toThrow(
      /truncated \(stopReason: max_tokens\)/
    );
  });

  it("does not throw for a normal completion", () => {
    expect(() => assertNotTruncated({ stopReason: "end_turn" }, "Resume Forge (draft)")).not.toThrow();
  });

  it("the thrown error is classified as invalid_output (retryable), not swallowed as unclassified", () => {
    try {
      assertNotTruncated({ stopReason: "max_tokens" }, "Hiring Panel");
      throw new Error("should have thrown");
    } catch (err) {
      expect(classifyAiErrorCode(err)).toBe("invalid_output");
    }
  });
});
