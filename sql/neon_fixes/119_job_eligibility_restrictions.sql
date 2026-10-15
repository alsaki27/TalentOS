-- Citizenship / export-control eligibility tagging for job postings.
-- Detection is pure regex (src/lib/jobEligibilityRestrictions.ts), zero AI cost,
-- computed synchronously whenever a job's description_text is written
-- (createJob/createJobs/updateJob/recordEnrichmentAttempt in jobsRepository.ts,
-- plus the manual edit-job PATCH route). These columns are system-derived, not
-- admin-editable by hand.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS eligibility_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_citizenship boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS citizenship_countries text[],
  ADD COLUMN IF NOT EXISTS export_control_restricted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS eligibility_restriction_evidence text,
  ADD COLUMN IF NOT EXISTS eligibility_detected_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_eligibility_restricted_idx
  ON jobs (eligibility_restricted) WHERE eligibility_restricted;
