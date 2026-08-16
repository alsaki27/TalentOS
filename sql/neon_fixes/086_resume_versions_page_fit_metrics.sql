-- 086: Add page-fit QA columns to application_resume_versions so the studio
-- and application queue can surface the measured (not guessed) page-fit
-- result alongside ats_score/truth_score. one_page_fit_score is the simple
-- 0-100 "how full is the page" number (contentUtilization*100) for quick
-- sorting/badges; page_fit_metrics is the full PageFitV1 object (pageCount,
-- contentUtilization, bottomWhitespaceInches, overflow, readable,
-- recommendation) for the detailed studio/queue readout. one_page_fit_score
-- already exists in the original schema (0001_initial_schema.sql) but has
-- never been written to by application code until now - this is a safe
-- no-op there; page_fit_metrics is genuinely new.

ALTER TABLE application_resume_versions
  ADD COLUMN IF NOT EXISTS one_page_fit_score double precision;
ALTER TABLE application_resume_versions
  ADD COLUMN IF NOT EXISTS page_fit_metrics jsonb;
