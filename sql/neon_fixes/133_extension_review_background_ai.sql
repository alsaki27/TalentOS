-- Extension submissions become visible with ATS first. The existing pending
-- review row is the durable work item; no job/application is created here.
-- Additive only: existing scores, approvals, jobs and applications are retained.
ALTER TABLE candidate_job_review_queue
  ADD COLUMN IF NOT EXISTS ai_execution jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS candidate_job_review_extension_ai_pending_idx
  ON candidate_job_review_queue(created_at, id)
  WHERE source = 'extension' AND status = 'pending' AND ai_status = 'pending';

COMMENT ON COLUMN candidate_job_review_queue.ai_execution IS
  'Extension-only background AI lease, recovery attempts and timing; approval remains an independent human action.';
