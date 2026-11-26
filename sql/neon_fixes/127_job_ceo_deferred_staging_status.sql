-- Keep multi-batch Job CEO uploads invisible to dispatch until all batches
-- have been staged. The explicitly scoped dispatcher promotes the run to
-- `ingesting` after the uploader sends its one final dispatch request.
BEGIN;

ALTER TABLE job_ceo_runs
  DROP CONSTRAINT IF EXISTS job_ceo_runs_status_check;

ALTER TABLE job_ceo_runs
  ADD CONSTRAINT job_ceo_runs_status_check
  CHECK (status IN ('staging','ingesting','qa','deep_fetch','matchmaking','completed','failed','cancelled'));

COMMIT;
