CREATE TABLE IF NOT EXISTS scheduled_job_runs (
  job_name text PRIMARY KEY,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  last_duration_ms int,
  last_result_summary text
);
