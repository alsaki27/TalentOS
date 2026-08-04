-- Migration: 035_job_agent_actor_source.sql
-- Adds actor_source to runs and source_url_hash to staged_jobs for multi-actor dedup.

ALTER TABLE job_agent_runs
  ADD COLUMN IF NOT EXISTS actor_source TEXT NOT NULL DEFAULT 'indeed';

ALTER TABLE job_agent_staged_jobs
  ADD COLUMN IF NOT EXISTS source_url_hash TEXT;

-- Index for fast cross-run URL dedup lookups
CREATE INDEX IF NOT EXISTS idx_staged_jobs_source_url_hash
  ON job_agent_staged_jobs (source_url_hash)
  WHERE source_url_hash IS NOT NULL;
