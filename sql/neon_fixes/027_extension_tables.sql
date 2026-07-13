-- 027: Extension schema tables for Track B integration (A4 Extension API).
-- Ported from talentOS-B sql/extension_schema.sql, with two changes:
--   1. candidate_skills is EXCLUDED — the target repo already has
--      candidates.verified_skills text[] (migration 021) and the
--      candidate_evidence table covering the same ground. Adding a
--      third competing skill ledger would cause data drift.
--      readinessService.getEvidencedSkills() reads from verified_skills
--      UNION candidate_evidence.related_skills instead.
--   2. extension_api_keys is ADDED — stores Bearer tos_<base64url> tokens
--      for machine-client auth (browser extensions, MCP server). Named
--      distinctly from the unrelated ai_api_keys table (AI provider keys).
-- All tables use CREATE TABLE IF NOT EXISTS for idempotent apply.

-- Browser profiles (for B2 gate / CLI isolation)
CREATE TABLE IF NOT EXISTS browser_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  marker_hash     text NOT NULL,
  chrome_profile  text,
  decommissioned_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Application evidence (B6 — post-submission proof capture)
CREATE TABLE IF NOT EXISTS application_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  screenshot_url    text,
  confirmation_scrape jsonb,
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, screenshot_url)
);

-- Application outcomes (A7 cron + A8 webhooks)
CREATE TABLE IF NOT EXISTS application_outcomes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  status          text NOT NULL,
  source          text NOT NULL CHECK (source IN ('manual', 'cron', 'webhook')),
  source_detail   text,
  outcome_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Extension captured jobs — staging table (human promotes to jobs)
CREATE TABLE IF NOT EXISTS extension_captured_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  company         text,
  location        text,
  jd_text         text NOT NULL,
  apply_url       text NOT NULL UNIQUE,
  source_site     text,
  salary          text,
  ats_detected    text,
  screenshot_url  text,
  idempotency_key text UNIQUE,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  promoted_job_id uuid REFERENCES jobs(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Extension API keys — machine-client auth (browser extensions, MCP server)
-- Stores SHA-256 hash of the bearer token, never the plaintext.
CREATE TABLE IF NOT EXISTS extension_api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label           text NOT NULL,
  key_hash        text NOT NULL UNIQUE,
  scopes          text[] NOT NULL DEFAULT '{}',
  candidate_id    uuid REFERENCES candidates(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_application_evidence_app ON application_evidence(application_id);
CREATE INDEX IF NOT EXISTS idx_application_outcomes_app ON application_outcomes(application_id);
CREATE INDEX IF NOT EXISTS idx_extension_captured_jobs_promoted ON extension_captured_jobs(promoted_job_id) WHERE promoted_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_extension_api_keys_hash ON extension_api_keys(key_hash) WHERE revoked_at IS NULL;