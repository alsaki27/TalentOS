-- 026: Index for targeted polling of active workflows (Chunk 8's /api/application-ai-workflows/active).
-- The client polls every 6s, diffing by id+updated_at — this index keeps that query fast
-- even as the workflow table grows, without scanning rows in completed/cancelled state.
--
-- application_ai_workflows never had an updated_at column - confirmed live,
-- this ALTER TABLE must run (and land) before the CREATE INDEX below, in this
-- same file, since the deploy pipeline applies sql/neon_fixes/*.sql in
-- filename order and a separate later-numbered migration would still let a
-- fresh environment hit this file first and fail on "column does not exist"
-- (confirmed: this is exactly what broke the automated deploy for commit
-- 3a46f1f before this was caught).
ALTER TABLE application_ai_workflows
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- CONCURRENTLY: this table is written to continuously by workflow dispatch;
-- a plain CREATE INDEX would take a lock that blocks those writers for the
-- duration of the build. Must run as its own statement, not inside a
-- transaction block (the migration runner executes each statement in this
-- file with autocommit, so that's satisfied here).
CREATE INDEX CONCURRENTLY IF NOT EXISTS application_ai_workflows_status_updated_idx
  ON application_ai_workflows (status, updated_at)
  WHERE status IN ('queued', 'running', 'waiting');
