-- 125: Make the scheduled candidate-logging job-freshness window a real
-- admin setting instead of a hardcoded 7 days in
-- scheduledCandidateLoggingService.ts's profileForResume(). Default 1 day
-- per explicit request; admin can raise it (2, 3, ...) later without a
-- code change.

ALTER TABLE scheduled_candidate_logging_config
  ADD COLUMN IF NOT EXISTS job_freshness_days integer NOT NULL DEFAULT 1
    CHECK (job_freshness_days BETWEEN 1 AND 30);

COMMENT ON COLUMN scheduled_candidate_logging_config.job_freshness_days IS
  'Stage-1 hard-reject window: a job older than this many days (measured from when it entered TalentOS via scheduled ingestion, not its original posting date) is rejected before any AI call runs.';
