-- Job Agent — OpenJobData source support
-- Additive-only migration: extends job_agent_staged_jobs with fields the
-- openjobdata.com dataset provides that the Apify path never populated
-- (description text, company website, dataset's own job id, country,
-- industry). All nullable, all backward-compatible with existing Apify rows.

ALTER TABLE job_agent_staged_jobs
  ADD COLUMN IF NOT EXISTS description_text TEXT,
  ADD COLUMN IF NOT EXISTS company_website   TEXT,
  ADD COLUMN IF NOT EXISTS external_job_id   TEXT,
  ADD COLUMN IF NOT EXISTS country           TEXT,
  ADD COLUMN IF NOT EXISTS industry          TEXT;

CREATE INDEX IF NOT EXISTS idx_staged_jobs_external_job_id ON job_agent_staged_jobs(external_job_id);
