-- 045_candidate_portal_accounts.sql
-- Additive only. Adds real login identity to candidates (password and/or Google)
-- on top of the existing anonymous portal_token magic-link column, which is kept
-- unchanged and now used as the one-time invite token. No existing column is
-- altered or dropped, and nothing in the job-application pipeline (applications,
-- jobs, resumes, AI pipelines) is touched by this migration.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS google_sub text,
  ADD COLUMN IF NOT EXISTS account_email text,
  ADD COLUMN IF NOT EXISTS account_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS candidates_google_sub_idx ON candidates (google_sub) WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS candidates_account_email_idx ON candidates (account_email) WHERE account_email IS NOT NULL;
