export const APPLICATION_STAGES = [
  "in_ai_pipeline",
  "ready_for_review",
  "ready_for_application",
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
  "on_hold",
  "closed",
] as const;

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export function isApplicationStage(value: unknown): value is ApplicationStage {
  return typeof value === "string" && (APPLICATION_STAGES as readonly string[]).includes(value);
}
