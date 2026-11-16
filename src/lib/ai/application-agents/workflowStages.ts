import type { ApplicationAgentId } from "./types";

export const RESUME_EVIDENCE_VARIANT = "resume_evidence_v2";
export const LEGACY_RESUME_STAGES = ["application_resume_forge", "application_hiring_panel", "application_final_polish"] as const;
export const EVIDENCE_RESUME_STAGES = [
  ...LEGACY_RESUME_STAGES, "application_opportunity_reviewer", "application_release_editor",
] as const;

export function resumeStages(snapshot: unknown): readonly ApplicationAgentId[] {
  const variant = (snapshot as { pipelineVariant?: string } | null)?.pipelineVariant;
  return variant === RESUME_EVIDENCE_VARIANT ? EVIDENCE_RESUME_STAGES : LEGACY_RESUME_STAGES;
}

export function evidenceRouteId(agentId: ApplicationAgentId): string {
  return EVIDENCE_RESUME_STAGES.slice(3).some((id) => id === agentId)
    ? agentId
    : agentId + "_evidence_v2";
}
