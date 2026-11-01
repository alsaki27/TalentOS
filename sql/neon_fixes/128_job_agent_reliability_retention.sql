-- 128: Durable Apify polling diagnostics, operator cancellation, and bounded history.
-- Additive only. Retention is executed by the authenticated Job Agent cron route;
-- permanent Jobs and Job CEO records are deliberately not part of this cleanup.

ALTER TABLE job_agent_runs
  ADD COLUMN IF NOT EXISTS date_interval text,
  ADD COLUMN IF NOT EXISTS last_polled_at timestamptz,
  ADD COLUMN IF NOT EXISTS poll_failure_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_poll_failure_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_poll_error text,
  ADD COLUMN IF NOT EXISTS last_poll_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_kind text,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_poll_failure_count_nonnegative'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_poll_failure_count_nonnegative
      CHECK (poll_failure_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_consecutive_poll_failure_count_nonnegative'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_consecutive_poll_failure_count_nonnegative
      CHECK (consecutive_poll_failure_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_cancellation_kind_check'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_cancellation_kind_check
      CHECK (cancellation_kind IS NULL OR cancellation_kind IN ('operator', 'timeout'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS job_agent_runs_active_reconcile_idx
  ON job_agent_runs (status, started_at)
  WHERE status IN ('pending', 'running', 'processing');

CREATE INDEX IF NOT EXISTS job_agent_runs_terminal_retention_idx
  ON job_agent_runs ((COALESCE(completed_at, started_at, created_at)))
  WHERE status NOT IN ('pending', 'running', 'processing');

CREATE INDEX IF NOT EXISTS job_agent_batches_terminal_retention_idx
  ON job_agent_batches ((COALESCE(completed_at, created_at)))
  WHERE status IN ('succeeded', 'partial_success', 'failed', 'cancelled');

CREATE INDEX IF NOT EXISTS job_agent_token_reservations_retention_idx
  ON job_agent_apify_token_reservations (business_date, status);
