import type { ApplicationRow } from "@/server/repositories/applicationsRepository";

export function buildAppliedApplicationUpdates(
  current: Pick<ApplicationRow, "applied_at" | "completed_at" | "ae_applied_at" | "ae_stage" | "application_stage">,
  actor: { userId: string; name: string | null },
  now: string,
): Partial<ApplicationRow> {
  const previouslyApplied = (current.application_stage ?? current.ae_stage) === "applied";
  const appliedAt = current.applied_at ?? (previouslyApplied ? current.ae_applied_at : null) ?? now;
  const stageChanged = current.ae_stage !== "applied" || current.application_stage !== "applied";

  return {
    status: "applied",
    ae_stage: "applied",
    application_stage: "applied",
    applied_at: appliedAt,
    completed_at: current.completed_at ?? appliedAt,
    ...(stageChanged && {
      ae_stage_updated_at: now,
      ae_stage_updated_by_user_id: actor.userId,
      ae_stage_updated_by_name: actor.name,
      application_stage_changed_at: now,
      application_stage_changed_by_user_id: actor.userId,
      application_stage_changed_by_name: actor.name,
    }),
    ...(stageChanged && !previouslyApplied && {
      ae_applied_at: appliedAt,
      ae_applied_by_user_id: actor.userId,
      ae_applied_by_name: actor.name,
    }),
  };
}
