-- 026: Index for targeted polling of active workflows (Chunk 8's /api/application-ai-workflows/active).
-- The client polls every 6s, diffing by id+updated_at — this index keeps that query fast
-- even as the workflow table grows, without scanning rows in completed/cancelled state.
-- CONCURRENTLY: this table is written to continuously by workflow dispatch;
-- a plain CREATE INDEX would take a lock that blocks those writers for the
-- duration of the build. Must run as its own statement, not inside a
-- transaction block (the migration runner executes this file as a single
-- autocommit query, so that's satisfied here).
CREATE INDEX CONCURRENTLY IF NOT EXISTS application_ai_workflows_status_updated_idx
  ON application_ai_workflows (status, updated_at)
  WHERE status IN ('queued', 'running', 'waiting');
