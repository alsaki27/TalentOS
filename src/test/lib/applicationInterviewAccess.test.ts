import { describe, expect, it } from "vitest";
import { canAccessInterviewDetails, effectiveApplicationStage } from "@/lib/applicationInterviewAccess";

describe("application interview detail access", () => {
  it.each([
    ["applied", false],
    ["replied", false],
    ["interview", true],
    ["offer", true],
    ["rejected", true],
    ["withdrawn", true],
    ["closed", false],
  ])("maps %s to the correct access state", (status, allowed) => {
    expect(canAccessInterviewDetails(status)).toBe(allowed);
  });

  it("uses the same legacy effective-stage rule as the candidate profile", () => {
    expect(effectiveApplicationStage("in_progress", "interview", "applied")).toBe("interview");
    expect(canAccessInterviewDetails("in_progress", "interview", "applied")).toBe(true);
    expect(effectiveApplicationStage("applied", "interview", "interview")).toBe("applied");
    expect(canAccessInterviewDetails("applied", "interview", "interview")).toBe(false);
  });
});
