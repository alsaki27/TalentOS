-- 126: Tracking columns for automated + manual retries of jobs stuck at
-- job_ceo_staging.stage = 'no_description'.
--
-- Why: confirmed live on 2026-10-26 that a job stuck here because Deep
-- Fetch got 0 usable characters is frequently NOT actually unreachable —
-- re-fetching the exact same URL later (manually tested against real
-- production rows, both Adzuna and OpenJobData) often succeeds, because the
-- original failure was a transient render/timing issue, not a permanently
-- dead or blocked page. Nothing previously ever tried again. See "Adzuna
-- Job CEO Coverage and Description Recovery Plan" (2026-10-25) and its
-- 2026-10-26 follow-up on system-wide (all-source) retry.
--
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

ALTER TABLE job_ceo_staging
  ADD COLUMN IF NOT EXISTS recovery_retry_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_last_retried_at timestamptz;

-- Scheduled retry batches scan for eligible rows across every run and every
-- source; this index keeps that scan cheap as the recovery queue grows
-- (confirmed live: 45,000+ rows across OpenJobData and Adzuna combined).
CREATE INDEX IF NOT EXISTS job_ceo_staging_recovery_retry_idx
  ON job_ceo_staging (stage, recovery_retry_count, recovery_last_retried_at)
  WHERE stage = 'no_description';
