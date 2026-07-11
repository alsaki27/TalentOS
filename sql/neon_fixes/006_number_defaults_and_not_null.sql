-- 006: Synchronize numbering sequences and add NOT NULL + DEFAULT constraints.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

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
  PERFORM setval('app_number_seq', GREATEST(v_max, 10000));
END $$;

-- Add DEFAULT nextval() so new rows get auto-assigned numbers.
ALTER TABLE candidates ALTER COLUMN candidate_number SET DEFAULT nextval('candidate_number_seq');
ALTER TABLE jobs ALTER COLUMN job_number SET DEFAULT nextval('job_number_seq');
ALTER TABLE applications ALTER COLUMN app_number SET DEFAULT nextval('app_number_seq');

-- Add NOT NULL (after defaults are in place, so existing rows won't break).
ALTER TABLE candidates ALTER COLUMN candidate_number SET NOT NULL;
ALTER TABLE jobs ALTER COLUMN job_number SET NOT NULL;
ALTER TABLE applications ALTER COLUMN app_number SET NOT NULL;
