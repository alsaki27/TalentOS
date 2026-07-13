-- 023: Add ats_score and truth_score columns to application_resume_versions
-- so the Falood Application Resume Studio and the Application Queue can surface
-- the Hiring Panel's ATS review score alongside the finalized resume content.
-- The ATS score originates from ReviewScoreV1.atsScore (the Hiring Panel agent),
-- not from FinalResumeV1.finalQaScore (Final Polish's self-assessment).

ALTER TABLE application_resume_versions
  ADD COLUMN IF NOT EXISTS ats_score double precision;
ALTER TABLE application_resume_versions
  ADD COLUMN IF NOT EXISTS truth_score double precision;