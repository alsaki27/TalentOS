import { describe, expect, it } from "vitest";
import { missingQualificationFitDisplay } from "@/lib/qualificationFitDisplay";

describe("missingQualificationFitDisplay", () => {
  it("labels a completed pre-scoring workflow as legacy and explains that it is not backfilled", () => {
    const result = missingQualificationFitDisplay("completed", null);

    expect(result.label).toBe("Fit: legacy");
    expect(result.title).toContain("not recalculated automatically");
  });

  it("flags a missing scorecard when the workflow was created with scoring enabled", () => {
    const result = missingQualificationFitDisplay("completed", "qualification-fit-v1");

    expect(result.label).toBe("Fit: scorecard missing");
    expect(result.tone).toBe("badge-warning");
  });

  it.each(["failed", "cancelled"])("does not imply scoring ran when workflow is %s", (status) => {
    expect(missingQualificationFitDisplay(status, "qualification-fit-v1").label)
      .toBe("Fit: not calculated");
  });

  it.each(["queued", "running", "waiting"])("keeps an active %s workflow pending", (status) => {
    expect(missingQualificationFitDisplay(status, "qualification-fit-v1").label)
      .toBe("Fit: pending");
  });
});
