import { execute } from "@/server/db/neon";

export type ExtensionActivityType =
  | "job_added"
  | "job_duplicate"
  | "candidate_logged"
  | "resume_edited"
  | "application_reviewed"
  | "application_applied";

export async function recordExtensionActivity(input: {
  actorUserId: string;
  extensionKeyId?: string | null;
  eventType: ExtensionActivityType;
  jobId?: string | null;
  applicationId?: string | null;
  candidateId?: string | null;
  baseResumeId?: string | null;
  resumeVersionId?: string | null;
  matchScore?: number | null;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const values = [
    input.actorUserId,
    input.extensionKeyId ?? null,
    input.eventType,
    input.jobId ?? null,
    input.applicationId ?? null,
    input.candidateId ?? null,
    input.baseResumeId ?? null,
    input.resumeVersionId ?? null,
    input.matchScore ?? null,
    input.idempotencyKey ?? null,
    JSON.stringify(input.metadata ?? {}),
  ];

  try {
    await execute(
      `INSERT INTO extension_activity_events
       (actor_user_id, actor_display_name, actor_email, extension_key_id, event_type, job_id, application_id,
        candidate_id, base_resume_id, resume_version_id, match_score,
        idempotency_key, metadata)
     VALUES (
       $1,
       (SELECT NULLIF(display_name, '') FROM profiles WHERE user_id = $1),
       (SELECT email FROM profiles WHERE user_id = $1),
       $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb
     )
     ON CONFLICT (extension_key_id, event_type, idempotency_key)
       WHERE idempotency_key IS NOT NULL DO NOTHING`,
      values,
    );
  } catch (error) {
    // Application deploys precede manually approved SQL migrations. Keep
    // existing extension activity logging available during that interval.
    const dbError = error as { code?: string; column?: string; message?: string };
    const missingSnapshotColumn = ["actor_display_name", "actor_email"].some(
      (column) => dbError.column === column || dbError.message?.includes(`column "${column}"`),
    );
    if (dbError.code !== "42703" || !missingSnapshotColumn) throw error;

    await execute(
      `INSERT INTO extension_activity_events
         (actor_user_id, extension_key_id, event_type, job_id, application_id,
          candidate_id, base_resume_id, resume_version_id, match_score,
          idempotency_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       ON CONFLICT (extension_key_id, event_type, idempotency_key)
         WHERE idempotency_key IS NOT NULL DO NOTHING`,
      values,
    );
  }
}
