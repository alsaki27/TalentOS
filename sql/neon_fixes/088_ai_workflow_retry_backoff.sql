-- Prevent a temporary provider rate limit from becoming an immediate
-- terminal workflow failure. The dispatcher will not claim a queued workflow
-- until next_retry_at has arrived; deliberate/manual retries may clear it.
ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_application_ai_workflows_retry_ready
  ON application_ai_workflows (status, next_retry_at, created_at)
  WHERE status = 'queued';
