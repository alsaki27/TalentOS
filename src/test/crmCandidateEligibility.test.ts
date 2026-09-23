import { describe, expect, it } from "vitest";
import {
  crmRecruiterApplicationStage,
  isCrmRecruiterCandidate,
} from "@/lib/crmCandidateEligibility";

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

describe("isCrmRecruiterCandidate", () => {
  it("requires the account to be active and the pipeline stage to be Actively Applying", () => {
    expect(isCrmRecruiterCandidate("active", "applying")).toBe(true);
    expect(isCrmRecruiterCandidate("ACTIVE", "APPLYING")).toBe(true);
  });

  it.each([
    ["active", "not_started"],
    ["active", "paused"],
    ["placed", "applying"],
    [null, "applying"],
  ])("rejects status %s with pipeline stage %s", (status, pipelineStage) => {
    expect(isCrmRecruiterCandidate(status, pipelineStage)).toBe(false);
  });
});
