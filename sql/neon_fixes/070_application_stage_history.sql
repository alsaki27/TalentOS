-- Canonical stage-change audit trail. This is additive and safe to deploy before
-- the legacy status/ae_stage columns are removed.
CREATE TABLE IF NOT EXISTS application_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  changed_by_name text,
  reason text,
  source text
);

CREATE INDEX IF NOT EXISTS application_stage_history_application_idx
  ON application_stage_history (application_id, changed_at DESC);

ALTER TABLE applications ADD COLUMN IF NOT EXISTS application_stage_changed_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS application_stage_changed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS application_stage_changed_by_name text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS application_stage text;

UPDATE applications
SET application_stage = CASE
  WHEN ae_stage = 'applied' OR status = 'applied' THEN 'applied'
  WHEN ae_stage IS NOT NULL THEN ae_stage
  WHEN status = 'rejected' THEN 'rejected'
  WHEN status = 'withdrawn' THEN 'withdrawn'
  WHEN status = 'in_progress' THEN 'ready_for_review'
  WHEN status IN ('assigned', 'stacked') THEN 'ready_for_review'
  ELSE 'in_ai_pipeline'
END
WHERE application_stage IS NULL;

UPDATE applications
SET application_stage_changed_at = COALESCE(application_stage_changed_at, ae_stage_updated_at, updated_at, created_at),
    application_stage_changed_by_user_id = COALESCE(application_stage_changed_by_user_id, ae_stage_updated_by_user_id),
    application_stage_changed_by_name = COALESCE(application_stage_changed_by_name, ae_stage_updated_by_name)
WHERE application_stage_changed_at IS NULL;

INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_at, changed_by_user_id, changed_by_name, reason, source)
SELECT a.id, NULL, a.ae_stage,
       COALESCE(a.ae_stage_updated_at, a.updated_at, a.created_at, now()),
       a.ae_stage_updated_by_user_id, a.ae_stage_updated_by_name,
       'Initial history backfill', 'migration'
FROM applications a
WHERE NOT EXISTS (SELECT 1 FROM application_stage_history h WHERE h.application_id = a.id);
