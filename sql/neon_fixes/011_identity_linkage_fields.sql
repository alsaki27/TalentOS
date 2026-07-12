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

-- NOTE: candidate_number/job_number/app_number sequence creation, defaults,
-- and sync are already fully handled by 006_number_defaults_and_not_null.sql,
-- which runs earlier in this pipeline (alphabetically before 010). That file
-- deliberately uses 'applications_app_number_seq' (not 'app_number_seq') to
-- match the sequence 001_app_number_and_timestamps.sql actually created in
-- production, which applicationsRepository.ts already calls by that exact
-- name. A duplicate 'CREATE SEQUENCE app_number_seq' here previously
-- re-pointed applications.app_number's DEFAULT at a second, unsynchronized
-- sequence - both sequences would then issue "next" numbers independently,
-- eventually colliding against app_number's UNIQUE constraint. Removed;
-- do not recreate sequence/default logic here, only in 006.

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
