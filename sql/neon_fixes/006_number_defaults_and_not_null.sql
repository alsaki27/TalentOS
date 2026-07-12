-- 006: Synchronize numbering sequences and add NOT NULL + DEFAULT constraints.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.
--
-- FIX (this pass): candidate_number/job_number columns and their sequences
-- were never actually created anywhere in this directory - the only place
-- that created them was sql/migrations/08_phase1_identity.sql, which is NOT
-- part of the auto-applied neon_fixes pipeline (deploy.yml only globs
-- sql/neon_fixes/*.sql). That caused every deploy to fail at this file with
-- "column candidate_number does not exist" - fixed by creating them here.
-- Also fixed: this file referenced a sequence named 'app_number_seq', but
-- 001_app_number_and_timestamps.sql (which does run) actually created it as
-- 'applications_app_number_seq' - the name the app code
-- (applicationsRepository.ts) already depends on. Corrected to match.

-- Create the candidate/job numbering columns + sequences if they don't
-- already exist (mirrors what 001 already did for applications.app_number).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_number INTEGER;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_number INTEGER;
CREATE SEQUENCE IF NOT EXISTS candidate_number_seq START WITH 10001;
CREATE SEQUENCE IF NOT EXISTS job_number_seq START WITH 10001;

-- Backfill any existing rows that don't have a number yet.
UPDATE candidates SET candidate_number = nextval('candidate_number_seq') WHERE candidate_number IS NULL;
UPDATE jobs SET job_number = nextval('job_number_seq') WHERE job_number IS NULL;

-- Sync sequences with current maximums to prevent future conflicts.
-- Uses PERFORM with a dynamic query since setval target can't be a sub-select directly.
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT COALESCE(MAX(candidate_number), 10000) INTO v_max FROM candidates;
  PERFORM setval('candidate_number_seq', GREATEST(v_max, 10000));

  SELECT COALESCE(MAX(job_number), 10000) INTO v_max FROM jobs;
  PERFORM setval('job_number_seq', GREATEST(v_max, 10000));

  SELECT COALESCE(MAX(app_number), 10000) INTO v_max FROM applications;
  PERFORM setval('applications_app_number_seq', GREATEST(v_max, 10000));
END $$;

-- Add DEFAULT nextval() so new rows get auto-assigned numbers.
ALTER TABLE candidates ALTER COLUMN candidate_number SET DEFAULT nextval('candidate_number_seq');
ALTER TABLE jobs ALTER COLUMN job_number SET DEFAULT nextval('job_number_seq');
ALTER TABLE applications ALTER COLUMN app_number SET DEFAULT nextval('applications_app_number_seq');

-- Add NOT NULL (after defaults + backfill are in place, so existing rows won't break).
ALTER TABLE candidates ALTER COLUMN candidate_number SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN job_number SET NOT NULL;
ALTER TABLE applications ALTER COLUMN app_number SET NOT NULL;

-- Uniqueness, so these can safely serve as human-facing reference numbers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'candidates_candidate_number_unique') THEN
    ALTER TABLE candidates ADD CONSTRAINT candidates_candidate_number_unique UNIQUE (candidate_number);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_job_number_unique') THEN
    ALTER TABLE jobs ADD CONSTRAINT jobs_job_number_unique UNIQUE (job_number);
  END IF;
END $$;
