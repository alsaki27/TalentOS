import { describe, expect, it } from "vitest";
import { crmRecruiterApplicationStage } from "@/lib/crmCandidateEligibility";

describe("crmRecruiterApplicationStage", () => {
  it.each(["applied", "screening", "interview", "offer"])(
    "accepts canonical stage %s",
    (stage) => {
      expect(crmRecruiterApplicationStage(stage, "in_progress")).toBe(stage);
    },
  );

  it("maps the legacy replied status to Screening when no canonical stage exists", () => {
    expect(crmRecruiterApplicationStage(null, "replied")).toBe("screening");
  });

  it("prefers an allowed canonical stage over the legacy status", () => {
    expect(crmRecruiterApplicationStage("interview", "applied")).toBe("interview");
  });

  it("uses the user-facing status during intermediate operational stages", () => {
    expect(crmRecruiterApplicationStage("in_ai_pipeline", "screening")).toBe("screening");
    expect(crmRecruiterApplicationStage("ready_for_review", "offer")).toBe("offer");
  });

  it("does not let a stale legacy status override a terminal canonical stage", () => {
    expect(crmRecruiterApplicationStage("rejected", "replied")).toBeNull();
  });

  it("rejects unsupported or empty application states", () => {
    expect(crmRecruiterApplicationStage(null, "assigned")).toBeNull();
    expect(crmRecruiterApplicationStage("", "  ")).toBeNull();
  });
});
