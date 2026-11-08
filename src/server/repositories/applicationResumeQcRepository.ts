import { query, queryOne } from "@/server/db/neon";

export const RESUME_QC_STATUSES = ["qualified", "doubt", "unqualified"] as const;
export type ResumeQcStatus = typeof RESUME_QC_STATUSES[number];

export interface ResumeQcActor {
  userId: string;
  name: string;
}

export function isResumeQcStatus(value: unknown): value is ResumeQcStatus {
  return typeof value === "string" && RESUME_QC_STATUSES.includes(value as ResumeQcStatus);
}

export async function getApplicationResumeQcDetails(applicationId: string) {
  const application = await queryOne<{ id: string; stage: string | null }>(
    `SELECT id, COALESCE(application_stage, ae_stage) AS stage
       FROM applications
      WHERE id = $1::uuid`,
    [applicationId],
  );
  if (!application) return null;

  const [state, notes, events] = await Promise.all([
    queryOne<{ status: ResumeQcStatus; changed_at: string; changed_by_user_id: string | null; changed_by_name: string }>(
      `SELECT status, changed_at, changed_by_user_id, changed_by_name
         FROM application_resume_qc
        WHERE application_id = $1::uuid`,
      [applicationId],
    ),
    query(
      `SELECT stage, note, created_by_user_id, created_by_name, created_at,
              updated_by_user_id, updated_by_name, updated_at
         FROM application_resume_qc_notes
        WHERE application_id = $1::uuid
        ORDER BY CASE stage WHEN 'qualified' THEN 1 WHEN 'doubt' THEN 2 ELSE 3 END`,
      [applicationId],
    ),
    query(
      `SELECT id, event_type, from_status, to_status, note_stage, old_note, new_note,
              actor_user_id, actor_name, created_at
         FROM application_resume_qc_events
        WHERE application_id = $1::uuid
        ORDER BY created_at DESC, id DESC
        LIMIT 200`,
      [applicationId],
    ),
  ]);

  return {
    applicationId: application.id,
    applicationStage: application.stage,
    eligible: application.stage === "in_ai_pipeline" || application.stage === "ready_for_review" || application.stage === "ready_for_application",
    state,
    notes,
    events,
  };
}

export async function setApplicationResumeQcStatus(input: {
  applicationId: string;
  status: ResumeQcStatus;
  note?: string | null;
  actor: ResumeQcActor;
}) {
  const rows = await query<{ application_id: string; status: ResumeQcStatus; events_created: number }>(
    `WITH eligible AS (
       SELECT a.id
         FROM applications a
        WHERE a.id = $1::uuid
          AND COALESCE(a.application_stage, a.ae_stage) IN ('in_ai_pipeline', 'ready_for_review', 'ready_for_application')
        FOR UPDATE
     ), previous_status AS (
       SELECT qc.status
         FROM application_resume_qc qc
         JOIN eligible e ON e.id = qc.application_id
     ), previous_note AS (
       SELECT n.note
         FROM application_resume_qc_notes n
         JOIN eligible e ON e.id = n.application_id
        WHERE n.stage = $2::text
     ), state_write AS (
       INSERT INTO application_resume_qc
         (application_id, status, changed_by_user_id, changed_by_name, changed_at)
       SELECT e.id, $2::text, $4::uuid, $5::text, now()
         FROM eligible e
       ON CONFLICT (application_id) DO UPDATE
         SET status = EXCLUDED.status,
             changed_by_user_id = EXCLUDED.changed_by_user_id,
             changed_by_name = EXCLUDED.changed_by_name,
             changed_at = EXCLUDED.changed_at
       WHERE application_resume_qc.status IS DISTINCT FROM EXCLUDED.status
       RETURNING application_id, status
     ), note_write AS (
       INSERT INTO application_resume_qc_notes
         (application_id, stage, note, created_by_user_id, created_by_name,
          created_at, updated_by_user_id, updated_by_name, updated_at)
       SELECT e.id, $2::text, btrim($3::text), $4::uuid, $5::text,
              now(), $4::uuid, $5::text, now()
         FROM eligible e
        WHERE NULLIF(btrim($3::text), '') IS NOT NULL
       ON CONFLICT (application_id, stage) DO UPDATE
         SET note = EXCLUDED.note,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_by_name = EXCLUDED.updated_by_name,
             updated_at = EXCLUDED.updated_at
       WHERE application_resume_qc_notes.note IS DISTINCT FROM EXCLUDED.note
       RETURNING application_id, stage, note
     ), stage_event AS (
       INSERT INTO application_resume_qc_events
         (application_id, event_type, from_status, to_status, note_stage,
          old_note, new_note, actor_user_id, actor_name, created_at)
       SELECT e.id, 'stage_changed', ps.status, $2::text, $2::text,
              pn.note, COALESCE(nw.note, pn.note), $4::uuid, $5::text, now()
         FROM eligible e
         LEFT JOIN previous_status ps ON true
         LEFT JOIN previous_note pn ON true
         LEFT JOIN note_write nw ON nw.application_id = e.id
        WHERE ps.status IS DISTINCT FROM $2::text
       RETURNING id
     ), note_event AS (
       INSERT INTO application_resume_qc_events
         (application_id, event_type, from_status, to_status, note_stage,
          old_note, new_note, actor_user_id, actor_name, created_at)
       SELECT e.id,
              CASE WHEN pn.note IS NULL THEN 'note_created' ELSE 'note_updated' END,
              ps.status, $2::text, $2::text, pn.note, nw.note, $4::uuid, $5::text, now()
         FROM eligible e
         JOIN note_write nw ON nw.application_id = e.id
         LEFT JOIN previous_status ps ON true
         LEFT JOIN previous_note pn ON true
       RETURNING id
     )
     SELECT e.id AS application_id,
            COALESCE(sw.status, qc.status) AS status,
            ((SELECT COUNT(*) FROM stage_event) + (SELECT COUNT(*) FROM note_event))::int AS events_created
       FROM eligible e
       LEFT JOIN state_write sw ON sw.application_id = e.id
       LEFT JOIN application_resume_qc qc ON qc.application_id = e.id`,
    [input.applicationId, input.status, input.note ?? null, input.actor.userId, input.actor.name],
  );
  return rows[0] ?? null;
}

export async function updateApplicationResumeQcNote(input: {
  applicationId: string;
  stage: ResumeQcStatus;
  note: string;
  actor: ResumeQcActor;
}) {
  const rows = await query<{ application_id: string; status: ResumeQcStatus | null; stage: ResumeQcStatus; note: string | null; events_created: number }>(
    `WITH eligible AS (
       SELECT a.id
         FROM applications a
        WHERE a.id = $1::uuid
          AND COALESCE(a.application_stage, a.ae_stage) IN ('in_ai_pipeline', 'ready_for_review', 'ready_for_application')
        FOR UPDATE
     ), current_status AS (
       SELECT qc.status
         FROM application_resume_qc qc
         JOIN eligible e ON e.id = qc.application_id
     ), previous_note AS (
       SELECT n.note
         FROM application_resume_qc_notes n
         JOIN eligible e ON e.id = n.application_id
        WHERE n.stage = $2::text
     ), note_write AS (
       INSERT INTO application_resume_qc_notes
         (application_id, stage, note, created_by_user_id, created_by_name,
          created_at, updated_by_user_id, updated_by_name, updated_at)
       SELECT e.id, $2::text, btrim($3::text), $4::uuid, $5::text,
              now(), $4::uuid, $5::text, now()
         FROM eligible e
        WHERE NULLIF(btrim($3::text), '') IS NOT NULL
       ON CONFLICT (application_id, stage) DO UPDATE
         SET note = EXCLUDED.note,
             updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_by_name = EXCLUDED.updated_by_name,
             updated_at = EXCLUDED.updated_at
       WHERE application_resume_qc_notes.note IS DISTINCT FROM EXCLUDED.note
       RETURNING application_id, stage, note
     ), note_delete AS (
       DELETE FROM application_resume_qc_notes n
        USING eligible e
        WHERE n.application_id = e.id
          AND n.stage = $2::text
          AND NULLIF(btrim($3::text), '') IS NULL
       RETURNING n.application_id, n.stage, n.note
     ), note_event AS (
       INSERT INTO application_resume_qc_events
         (application_id, event_type, from_status, to_status, note_stage,
          old_note, new_note, actor_user_id, actor_name, created_at)
       SELECT e.id,
              CASE WHEN pn.note IS NULL THEN 'note_created' ELSE 'note_updated' END,
              cs.status, cs.status, $2::text, pn.note, nw.note, $4::uuid, $5::text, now()
         FROM eligible e
         JOIN note_write nw ON nw.application_id = e.id
         LEFT JOIN current_status cs ON true
         LEFT JOIN previous_note pn ON true
       UNION ALL
       SELECT e.id, 'note_deleted', cs.status, cs.status, $2::text,
              nd.note, NULL, $4::uuid, $5::text, now()
         FROM eligible e
         JOIN note_delete nd ON nd.application_id = e.id
         LEFT JOIN current_status cs ON true
       RETURNING id
     )
     SELECT e.id AS application_id,
            cs.status,
            $2::text AS stage,
            CASE WHEN NULLIF(btrim($3::text), '') IS NULL THEN NULL
                 ELSE COALESCE(nw.note, pn.note) END AS note,
            (SELECT COUNT(*) FROM note_event)::int AS events_created
       FROM eligible e
       LEFT JOIN current_status cs ON true
       LEFT JOIN note_write nw ON nw.application_id = e.id
       LEFT JOIN previous_note pn ON true`,
    [input.applicationId, input.stage, input.note, input.actor.userId, input.actor.name],
  );
  return rows[0] ?? null;
}
