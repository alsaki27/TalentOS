import { describe, expect, it } from "vitest";
import { missingQualificationFitDisplay, qualificationFitScoreText } from "@/lib/qualificationFitDisplay";

describe("missingQualificationFitDisplay", () => {
  it("labels a completed workflow with no stored scorecard clearly", () => {
    const result = missingQualificationFitDisplay("completed");

    expect(result.label).toBe("Fit: no scorecard");
    expect(result.title).toContain("No Qualification fit scorecard is stored");
  });

  it.each(["failed", "cancelled"])("does not imply scoring ran when workflow is %s", (status) => {
    expect(missingQualificationFitDisplay(status).label)
      .toBe("Fit: not calculated");
  });

  it.each(["queued", "running", "waiting"])("keeps an active %s workflow pending", (status) => {
    expect(missingQualificationFitDisplay(status).label)
      .toBe("Fit: pending");
  });
});

describe("qualificationFitScoreText", () => {
  it("formats a definitive score separately from a provisional range", () => {
    expect(qualificationFitScoreText(8.25, null)).toBe("8.3/10");
    expect(qualificationFitScoreText(null, { min: 3.25, max: 8.96 })).toBe("≥3.3/10");
  });

  it("returns a placeholder when no safe numeric result exists", () => {
    expect(qualificationFitScoreText(null, null)).toBe("—");
  });
});
