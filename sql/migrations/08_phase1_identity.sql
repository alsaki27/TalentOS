-- Phase 1: Identity and linkage.
-- Idempotent. Run via `psql $DATABASE_URL -f sql/migrations/08_phase1_identity.sql`
-- or via the Neon fixes pipeline in deploy.yml.

-- 1. Unique constraints on numbering columns
ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidate_number_unique;
ALTER TABLE candidates ADD CONSTRAINT candidate_number_unique UNIQUE (candidate_number);
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS job_number_unique;
ALTER TABLE jobs ADD CONSTRAINT job_number_unique UNIQUE (job_number);
ALTER TABLE applications DROP CONSTRAINT IF EXISTS app_number_unique;
ALTER TABLE applications ADD CONSTRAINT app_number_unique UNIQUE (app_number);

-- 2. Backfill numbers using sequences (idempotent — uses sub-select to filter nulls)
CREATE SEQUENCE IF NOT EXISTS candidate_number_seq START 10001;
UPDATE candidates SET candidate_number = nextval('candidate_number_seq') WHERE candidate_number IS NULL;
CREATE SEQUENCE IF NOT EXISTS job_number_seq START 10001;
UPDATE jobs SET job_number = nextval('job_number_seq') WHERE job_number IS NULL;
CREATE SEQUENCE IF NOT EXISTS app_number_seq START 10001;
UPDATE applications SET app_number = nextval('app_number_seq') WHERE app_number IS NULL;

-- 3. Direct linkage columns on application_resume_versions
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id);
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id);
ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES application_ai_workflows(id);

-- Indexes for direct lookup
CREATE INDEX IF NOT EXISTS arv_application_idx ON application_resume_versions (application_id);
CREATE INDEX IF NOT EXISTS arv_job_idx ON application_resume_versions (job_id);
CREATE INDEX IF NOT EXISTS arv_workflow_idx ON application_resume_versions (workflow_id);
CREATE INDEX IF NOT EXISTS arv_candidate_idx ON application_resume_versions (candidate_id);

-- 4. Add ai_agent as valid source_type value
-- Drop existing check constraint and recreate with ai_agent added
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_resume_versions_source_type_check'
  ) THEN
    ALTER TABLE application_resume_versions DROP CONSTRAINT app_resume_versions_source_type_check;
  END IF;
END $$;
ALTER TABLE application_resume_versions ADD CONSTRAINT app_resume_versions_source_type_check
  CHECK (source_type = ANY (ARRAY['base_resume'::text, 'original_resume'::text, 'blank'::text, 'manual'::text, 'ai_agent'::text]));

-- 5. Direct result fields on applications
ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_workflow_id uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_resume_version_id uuid;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_status text DEFAULT 'not_started'
  CHECK (resume_generation_status = ANY (ARRAY['not_started'::text,'queued'::text,'job_analysis'::text,'resume_drafting'::text,'resume_review'::text,'human_review'::text,'finalizing'::text,'ready'::text,'failed'::text,'cancelled'::text]));
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_started_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_completed_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_error text;
