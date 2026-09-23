-- Candidate operational stage: add Paused without changing account status.
-- A paused candidate stays visible and retains existing applications/email
-- history. Scheduled job-search/matching automations must exclude them.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS pipeline_stage text NOT NULL DEFAULT 'not_started';

UPDATE candidates
   SET pipeline_stage = 'not_started'
 WHERE pipeline_stage IS NULL
    OR btrim(pipeline_stage) = ''
    OR pipeline_stage NOT IN ('not_started', 'applying', 'paused', 'placed', 'dropped');

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
      FROM pg_constraint con
     WHERE con.conrelid = 'candidates'::regclass
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%pipeline_stage%'
  LOOP
    EXECUTE format('ALTER TABLE candidates DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE candidates
  ADD CONSTRAINT candidates_pipeline_stage_check
  CHECK (pipeline_stage IN ('not_started', 'applying', 'paused', 'placed', 'dropped'));

CREATE INDEX IF NOT EXISTS candidates_pipeline_stage_idx
  ON candidates (pipeline_stage, status, name);

