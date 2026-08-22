-- 21.2 Assign application(s) to an AE — WRITE, requires explicit confirmation.
-- Params: $ae_user_id, $akash_user_id, $reason, $due_date (nullable), $application_ids (uuid array).
-- Not a stage change by itself. Only also update application_stage/application_stage_history
-- if the stage is genuinely moving (e.g. in_ai_pipeline -> ready_for_review on pickup).

BEGIN;

UPDATE applications
SET assigned_to_user_id = $ae_user_id,
    assigned_by_user_id = $akash_user_id,
    assignment_note = $reason,
    assignment_due_at = $due_date
WHERE id = ANY($application_ids);

INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
SELECT $akash_user_id, 'assign_application', 'application', id,
       jsonb_build_object('assigned_to', $ae_user_id, 'reason', $reason)
FROM applications WHERE id = ANY($application_ids);

COMMIT;

-- Verification (run after commit):
-- SELECT id, assigned_to_user_id, assignment_note, assignment_due_at
-- FROM applications WHERE id = ANY($application_ids);
