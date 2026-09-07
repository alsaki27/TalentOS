-- 094: Apply-link-first duplicate fingerprint column for jobs.
--
-- Computed from apply_url preferentially, source_url as fallback, normalized
-- (strip utm_*/ref tracking params, lowercase, strip www./trailing slash) by
-- the application (src/lib/jobUrlFingerprint.ts) at insert time via
-- createJob()/createJobs() in jobsRepository.ts - not a SQL generated
-- column, since URL parsing edge cases are far safer to unit test in
-- TypeScript than to reimplement in Postgres regex.
--
-- No behavior change from this file alone: the column is nullable, no
-- existing rows are modified/deleted/merged, and nothing reads or enforces
-- it yet. See 095 for the unique index once application code is wired in.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS apply_link_fingerprint text;

-- CONCURRENTLY: jobs is written to continuously by multiple ingestion
-- pipelines (Job CEO, Apify, ATS/career-page cron); a plain CREATE INDEX
-- would take a lock blocking those writers for the build's duration. Must
-- run as its own statement outside a transaction block - satisfied here,
-- since the deploy pipeline runs each neon_fixes file with autocommit
-- (see 026_workflow_polling_index.sql for the same precedent).
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_apply_link_fingerprint_idx
  ON jobs (apply_link_fingerprint)
  WHERE apply_link_fingerprint IS NOT NULL;
