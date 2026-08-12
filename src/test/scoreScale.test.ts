import { describe, expect, it } from "vitest";
import { formatScoreOutOfTen, normalizeScoreOutOfTen } from "@/lib/scoreScale";

describe("pipeline QA score scale", () => {
  it("keeps canonical decimal scores", () => {
    expect(normalizeScoreOutOfTen(9.34)).toBe(9.3);
    expect(formatScoreOutOfTen(9)).toBe("9.0");
  });

  it("converts historical percentage-style scores", () => {
    expect(normalizeScoreOutOfTen(93)).toBe(9.3);
    expect(formatScoreOutOfTen("92")).toBe("9.2");
  });

  it("rejects invalid and ambiguous values", () => {
    expect(normalizeScoreOutOfTen(15)).toBeNull();
    expect(normalizeScoreOutOfTen(101)).toBeNull();
    expect(normalizeScoreOutOfTen(-1)).toBeNull();
    expect(normalizeScoreOutOfTen("not-a-score")).toBeNull();
  });
});
