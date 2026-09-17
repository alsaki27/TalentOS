/**
 * Application stages that make an active TalentOS candidate actionable from
 * the CRM recruiter workflow.
 *
 * `application_stage` is the canonical lifecycle field when it contains one
 * of these recruiter-facing stages. TalentOS also has operational stages such
 * as `in_ai_pipeline` and `ready_for_review`; for those legacy/intermediate
 * values, the user-facing `status` remains the source of truth. Terminal
 * canonical stages block a stale legacy status from re-entering CRM.
 */
export const CRM_RECRUITER_APPLICATION_STAGES = [
  "applied",
  "screening",
  "interview",
  "offer",
] as const;

/** Maximum age of an application shown in the CRM recruiter workflow. */
export const CRM_RECRUITER_APPLICATION_RECENCY_DAYS = 15;

export type CrmRecruiterApplicationStage =
  (typeof CRM_RECRUITER_APPLICATION_STAGES)[number];

export const CRM_RECRUITER_LEGACY_STATUSES = [
  ...CRM_RECRUITER_APPLICATION_STAGES,
  "replied",
] as const;

export const CRM_RECRUITER_BLOCKING_STAGES = [
  "rejected",
  "withdrawn",
  "closed",
  "on_hold",
] as const;

const CRM_RECRUITER_LEGACY_STATUS_SET = new Set<string>(CRM_RECRUITER_LEGACY_STATUSES);
const CRM_RECRUITER_BLOCKING_STAGE_SET = new Set<string>(CRM_RECRUITER_BLOCKING_STAGES);

function normalizeStage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

/**
 * Returns the CRM-facing application stage, or null when the application is
 * not eligible for the recruiter workflow.
 */
export function crmRecruiterApplicationStage(
  applicationStage: unknown,
  status: unknown,
): CrmRecruiterApplicationStage | null {
  const canonical = normalizeStage(applicationStage);
  if (
    canonical &&
    CRM_RECRUITER_APPLICATION_STAGES.includes(
      canonical as CrmRecruiterApplicationStage,
    )
  ) {
    return canonical as CrmRecruiterApplicationStage;
  }
  if (
    canonical &&
    CRM_RECRUITER_BLOCKING_STAGE_SET.has(canonical)
  ) {
    return null;
  }

  const legacy = normalizeStage(status);
  if (!legacy || !CRM_RECRUITER_LEGACY_STATUS_SET.has(legacy)) return null;
  return legacy === "replied"
    ? "screening"
    : (legacy as CrmRecruiterApplicationStage);
}
