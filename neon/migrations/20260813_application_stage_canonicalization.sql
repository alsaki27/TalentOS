-- Canonical application lifecycle migration.
-- Apply this migration before removing applications.status. The legacy column
-- remains temporarily so old deployments can roll forward without downtime.

BEGIN;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS application_stage text;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS application_stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS application_stage_changed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS application_stage_changed_by_name text;

UPDATE applications
SET application_stage = COALESCE(
  NULLIF(ae_stage, ''),
  CASE status
    WHEN 'assigned' THEN 'ready_for_review'
    WHEN 'stacked' THEN 'ready_for_review'
    WHEN 'in_progress' THEN 'ready_for_review'
    WHEN 'replied' THEN 'screening'
    WHEN 'interview' THEN 'interview'
    WHEN 'offer' THEN 'offer'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'withdrawn' THEN 'withdrawn'
    WHEN 'applied' THEN 'applied'
    ELSE 'in_ai_pipeline'
  END
),
application_stage_changed_at = COALESCE(application_stage_changed_at, updated_at, created_at),
application_stage_changed_by_name = COALESCE(application_stage_changed_by_name, updated_by, created_by, 'migration');

UPDATE applications
SET application_stage = 'ready_for_review'
WHERE application_stage IN ('assigned', 'stacked', 'in_progress');

UPDATE applications
SET application_stage = 'screening'
WHERE application_stage = 'in_ai_pipeline' AND status = 'replied';

UPDATE applications
SET application_stage = 'interview'
WHERE application_stage = 'in_ai_pipeline' AND status = 'interview';

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_application_stage_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_application_stage_check CHECK (
    application_stage IN (
      'in_ai_pipeline', 'ready_for_review', 'ready_for_application',
      'applied', 'screening', 'interview', 'offer', 'rejected',
      'withdrawn', 'on_hold', 'closed'
    )
  );

CREATE INDEX IF NOT EXISTS applications_application_stage_idx
  ON applications (application_stage);

COMMIT;
