-- 026: Index for targeted polling of active workflows (Chunk 8's /api/application-ai-workflows/active).
-- The client polls every 6s, diffing by id+updated_at — this index keeps that query fast
-- even as the workflow table grows, without scanning rows in completed/cancelled state.
CREATE INDEX IF NOT EXISTS application_ai_workflows_status_updated_idx
  ON application_ai_workflows (status, updated_at)
  WHERE status IN ('queued', 'running', 'waiting');
