-- Keep the current retry budget separate from the immutable stage-run identity.
-- Historical attempt_number values must not cause a deliberate retry to fail
-- immediately after one new provider failure.

ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS stage_retry_count int NOT NULL DEFAULT 0;

UPDATE application_ai_workflows
SET stage_retry_count = 0
WHERE stage_retry_count < 0;
