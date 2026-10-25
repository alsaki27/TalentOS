-- 123: Isolated configuration, ingest provenance, and audit data for the
-- scheduled candidate-job logging feature. Applying this migration does not
-- alter candidates or jobs; applications are created later by the feature.

CREATE TABLE IF NOT EXISTS scheduled_candidate_logging_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  is_enabled boolean NOT NULL DEFAULT false,
  password_salt text,
  password_hash text,
  ai_provider text,
  ai_model text,
  ai_base_url text,
  ai_encrypted_api_key text,
  ai_key_fingerprint text,
  match_threshold integer NOT NULL DEFAULT 30 CHECK (match_threshold BETWEEN 0 AND 100),
  jobs_per_run integer NOT NULL DEFAULT 25 CHECK (jobs_per_run BETWEEN 1 AND 100),
  ai_calls_per_run integer NOT NULL DEFAULT 25 CHECK (ai_calls_per_run BETWEEN 1 AND 200),
  max_applications_per_run integer NOT NULL DEFAULT 25 CHECK (max_applications_per_run BETWEEN 1 AND 100),
  custom_prompt text NOT NULL DEFAULT '',
  include_inactive_candidates boolean NOT NULL DEFAULT false,
  assigned_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  application_owner_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO scheduled_candidate_logging_config (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS scheduled_candidate_logging_sessions (
  token_hash text PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_candidate_logging_sessions_expiry_idx
  ON scheduled_candidate_logging_sessions(expires_at);

CREATE TABLE IF NOT EXISTS scheduled_candidate_logging_candidate_rules (
  candidate_id uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  priority text NOT NULL DEFAULT 'default' CHECK (priority IN ('high', 'default', 'low')),
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_requirements text NOT NULL DEFAULT '',
  updated_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only rows written by a validated scheduled-ingest request are eligible.
-- Manually captured, imported, extension, and spreadsheet jobs receive no row.
CREATE TABLE IF NOT EXISTS scheduled_job_ingestion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  source text NOT NULL,
  source_run_id uuid REFERENCES job_ceo_runs(id) ON DELETE SET NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processing', 'complete', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_job_ingestion_pending_idx
  ON scheduled_job_ingestion_events(processing_status, ingested_at);

CREATE TABLE IF NOT EXISTS scheduled_candidate_logging_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('scheduled', 'manual', 'preview')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  jobs_seen integer NOT NULL DEFAULT 0,
  candidate_pairs_scored integer NOT NULL DEFAULT 0,
  applications_created integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  ai_calls integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  started_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS scheduled_candidate_logging_runs_started_idx
  ON scheduled_candidate_logging_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_candidate_logging_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES scheduled_candidate_logging_runs(id) ON DELETE CASCADE,
  ingestion_event_id uuid NOT NULL REFERENCES scheduled_job_ingestion_events(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  deterministic_score integer CHECK (deterministic_score IS NULL OR deterministic_score BETWEEN 0 AND 100),
  match_score integer CHECK (match_score IS NULL OR match_score BETWEEN 0 AND 100),
  priority text NOT NULL DEFAULT 'default' CHECK (priority IN ('high', 'default', 'low')),
  status text NOT NULL CHECK (status IN (
    'pending', 'matched', 'below_threshold', 'ineligible',
    'existing_application', 'no_approved_resume', 'description_unavailable',
    'ai_failed', 'application_created'
  )),
  reason text,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  provider text,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ingestion_event_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS scheduled_candidate_logging_decisions_run_idx
  ON scheduled_candidate_logging_decisions(run_id, status);
CREATE INDEX IF NOT EXISTS scheduled_candidate_logging_decisions_candidate_idx
  ON scheduled_candidate_logging_decisions(candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scheduled_candidate_logging_ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES scheduled_candidate_logging_runs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  request_kind text NOT NULL DEFAULT 'candidate_job_match',
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  latency_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_candidate_logging_ai_events_run_idx
  ON scheduled_candidate_logging_ai_events(run_id, created_at);

