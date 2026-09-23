-- Job Lens's job-only extraction (title/company normalization, skills,
-- tools, certifications, ATS keywords, etc. - everything that doesn't
-- depend on which candidate is applying) gets cached here once per job
-- instead of being re-extracted by every single application against that
-- job. The per-candidate requirementAnalysis classification is untouched
-- and still runs per-application every time.
--
-- No claimed_at/locking column: processPendingCategorization() (which will
-- populate this alongside its existing category fields) already processes
-- jobs strictly sequentially, the same precedent description_enrich_attempts
-- already established for this exact table - worst case of a double-claim
-- is one redundant AI call, not data corruption.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis_schema_version text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis_completed_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis_model text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis_error text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis_attempts integer NOT NULL DEFAULT 0;
