-- 010: Phase 1 identity/linkage fields — idempotent deployment of
-- sql/migrations/08_phase1_identity.sql through the automatic neon_fixes pipeline.
-- Applied on every deploy via sql/neon_fixes/ pipeline in deploy.yml.

-- Direct result fields on applications
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_workflow_id uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_resume_version_id uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_status text DEFAULT 'not_started';
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_error text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_started_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_completed_at timestamptz;

-- Direct linkage columns on application_resume_versions
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id);
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id);
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES application_ai_workflows(id);

-- Indexes for direct lookup
CREATE INDEX IF NOT EXISTS arv_application_idx ON application_resume_versions (application_id);
CREATE INDEX IF NOT EXISTS arv_job_idx ON application_resume_versions (job_id);
CREATE INDEX IF NOT EXISTS arv_workflow_idx ON application_resume_versions (workflow_id);
CREATE INDEX IF NOT EXISTS arv_candidate_idx ON application_resume_versions (candidate_id);

-- Ensure sequences exist and sync with current maximums
CREATE SEQUENCE IF NOT EXISTS candidate_number_seq START 10001;
CREATE SEQUENCE IF NOT EXISTS job_number_seq START 10001;
CREATE SEQUENCE IF NOT EXISTS app_number_seq START 10001;

ALTER TABLE candidates ALTER COLUMN candidate_number SET DEFAULT nextval('candidate_number_seq');
ALTER TABLE jobs ALTER COLUMN job_number SET DEFAULT nextval('job_number_seq');
ALTER TABLE applications ALTER COLUMN app_number SET DEFAULT nextval('app_number_seq');

-- Sync sequences with current maximums
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT COALESCE(MAX(candidate_number), 10000) INTO v_max FROM candidates;
  PERFORM setval('candidate_number_seq', GREATEST(v_max, 10000));
  SELECT COALESCE(MAX(job_number), 10000) INTO v_max FROM jobs;
  PERFORM setval('job_number_seq', GREATEST(v_max, 10000));
  SELECT COALESCE(MAX(app_number), 10000) INTO v_max FROM applications;
  PERFORM setval('app_number_seq', GREATEST(v_max, 10000));
END $$;

-- Add ai_agent as valid source_type value
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_resume_versions_source_type_check'
  ) THEN
    ALTER TABLE application_resume_versions DROP CONSTRAINT app_resume_versions_source_type_check;
  END IF;
END $$;
ALTER TABLE application_resume_versions ADD CONSTRAINT app_resume_versions_source_type_check
  CHECK (source_type = ANY (ARRAY['base_resume','original_resume','blank','manual','ai_agent']));
