/**
 * Candidate lifecycle stages.
 *
 * `status` remains the account/lifecycle field used by legacy integrations.
 * `pipeline_stage` is the operational stage shown to managers. A paused
 * candidate remains accessible and their existing email/application history
 * remains intact, but scheduled job-search automations must not select them.
 */
export const CANDIDATE_PIPELINE_STAGES = {
  not_started: "Not Started",
  applying: "Actively Applying",
  paused: "Paused",
  placed: "Placed",
  dropped: "Dropped",
} as const;

export type CandidatePipelineStage = keyof typeof CANDIDATE_PIPELINE_STAGES;

export const CANDIDATE_PIPELINE_STAGE_VALUES = Object.keys(
  CANDIDATE_PIPELINE_STAGES,
) as CandidatePipelineStage[];

export function isCandidatePipelineStage(value: unknown): value is CandidatePipelineStage {
  return typeof value === "string" && value in CANDIDATE_PIPELINE_STAGES;
}

export const CANDIDATE_STAGE_BADGE_CLASSES: Record<CandidatePipelineStage, string> = {
  not_started: "badge-waiting",
  applying: "badge-scheduled",
  paused: "badge-warning",
  placed: "badge-offer",
  dropped: "badge-closed",
};

