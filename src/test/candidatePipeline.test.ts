import { describe, expect, it } from "vitest";
import {
  CANDIDATE_PIPELINE_STAGES,
  isCandidatePipelineStage,
} from "@/lib/candidatePipeline";

describe("candidate pipeline stages", () => {
  it("includes Paused as a valid operational stage", () => {
    expect(CANDIDATE_PIPELINE_STAGES.paused).toBe("Paused");
    expect(isCandidatePipelineStage("paused")).toBe(true);
  });

  it("rejects arbitrary stage values", () => {
    expect(isCandidatePipelineStage("on_hold")).toBe(false);
    expect(isCandidatePipelineStage(null)).toBe(false);
    expect(isCandidatePipelineStage(42)).toBe(false);
  });
});

