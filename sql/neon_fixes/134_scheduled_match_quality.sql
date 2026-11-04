-- Additive evidence storage for precision-v1. Apply before deploying the PR.
-- Existing candidates/queue items/applications are preserved; missing candidate rules are not enabled.
BEGIN;
ALTER TABLE scheduled_candidate_logging_decisions ADD COLUMN IF NOT EXISTS match_quality jsonb;
ALTER TABLE candidate_job_review_queue ADD COLUMN IF NOT EXISTS match_quality jsonb;
ALTER TABLE scheduled_candidate_logging_candidate_rules ALTER COLUMN is_enabled SET DEFAULT false;
COMMENT ON COLUMN scheduled_candidate_logging_decisions.match_quality IS
  'Versioned admission reasons and exact JD/resume evidence for automated recommendations.';
COMMIT;
