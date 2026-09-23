-- Repair legacy records after 070. This is idempotent and keeps the legacy
-- columns synchronized until the application_stage-only cutover is complete.
UPDATE applications
SET status = 'applied',
    ae_stage = 'applied',
    application_stage = 'applied',
    applied_at = COALESCE(applied_at, ae_applied_at, updated_at, created_at, now()),
    completed_at = COALESCE(completed_at, applied_at, ae_applied_at, updated_at, created_at, now()),
    application_stage_changed_at = COALESCE(application_stage_changed_at, ae_stage_updated_at, updated_at, created_at, now()),
    application_stage_changed_by_user_id = COALESCE(application_stage_changed_by_user_id, ae_stage_updated_by_user_id, ae_applied_by_user_id),
    application_stage_changed_by_name = COALESCE(application_stage_changed_by_name, ae_stage_updated_by_name, ae_applied_by_name)
WHERE status = 'applied' OR ae_stage = 'applied' OR application_stage = 'applied';

UPDATE applications
SET application_stage = COALESCE(ae_stage, application_stage, CASE
      WHEN status = 'rejected' THEN 'rejected'
      WHEN status = 'withdrawn' THEN 'withdrawn'
      WHEN status = 'in_progress' THEN 'ready_for_review'
      WHEN status IN ('assigned', 'stacked') THEN 'ready_for_review'
      ELSE 'in_ai_pipeline'
    END),
    application_stage_changed_at = COALESCE(application_stage_changed_at, ae_stage_updated_at, updated_at, created_at),
    application_stage_changed_by_user_id = COALESCE(application_stage_changed_by_user_id, ae_stage_updated_by_user_id),
    application_stage_changed_by_name = COALESCE(application_stage_changed_by_name, ae_stage_updated_by_name)
WHERE application_stage IS NULL;

INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_at, changed_by_user_id, changed_by_name, reason, source)
SELECT a.id, NULL, a.application_stage,
       COALESCE(a.application_stage_changed_at, now()),
       a.application_stage_changed_by_user_id, a.application_stage_changed_by_name,
       'Legacy stage conflict repair', 'migration'
FROM applications a
WHERE NOT EXISTS (
  SELECT 1 FROM application_stage_history h
  WHERE h.application_id = a.id AND h.source = 'migration'
);
