const lifecycleStages = new Set([
  "screening", "replied", "interview", "offer", "rejected", "withdrawn", "on_hold", "closed",
]);

const interviewAccessibleStages = new Set(["interview", "offer", "rejected", "withdrawn"]);

export const EFFECTIVE_APPLICATION_STAGE_SQL = `CASE
  WHEN a.application_stage IN ('on_hold', 'closed') THEN a.application_stage
  WHEN a.status IN ('applied', 'screening', 'replied', 'interview', 'offer', 'rejected', 'withdrawn', 'on_hold', 'closed') THEN a.status
  ELSE COALESCE(a.application_stage, a.ae_stage, a.status)
END`;

export const APPLICATION_INTERVIEW_ACCESS_SQL = `(${EFFECTIVE_APPLICATION_STAGE_SQL}) IN ('interview', 'offer', 'rejected', 'withdrawn')`;

export function effectiveApplicationStage(
  status: string | null | undefined,
  canonicalStage?: string | null,
  aeStage?: string | null,
) {
  const currentStatus = status?.toLowerCase() ?? "";
  const canonical = canonicalStage?.toLowerCase() ?? "";
  const ae = aeStage?.toLowerCase() ?? "";
  if (canonical === "on_hold" || canonical === "closed") return canonical;
  if (currentStatus === "applied" || lifecycleStages.has(currentStatus)) return currentStatus;
  return canonical || ae || currentStatus;
}

export function canAccessInterviewDetails(
  status: string | null | undefined,
  canonicalStage?: string | null,
  aeStage?: string | null,
) {
  return interviewAccessibleStages.has(effectiveApplicationStage(status, canonicalStage, aeStage));
}
