-- 121: Team-owned extension keys and auditable team activity.
-- Keys continue to store only SHA-256 hashes. Existing keys remain valid with
-- a NULL owner and retain their current scopes and behavior.

ALTER TABLE extension_api_keys
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

CREATE INDEX IF NOT EXISTS extension_api_keys_owner_idx
  ON extension_api_keys(owner_user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS extension_activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE RESTRICT,
  extension_key_id uuid REFERENCES extension_api_keys(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'job_added', 'job_duplicate', 'candidate_logged',
    'resume_edited', 'application_reviewed', 'application_applied'
  )),
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  resume_version_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  match_score integer CHECK (match_score IS NULL OR (match_score >= 0 AND match_score <= 100)),
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS extension_activity_events_idempotency_idx
  ON extension_activity_events(extension_key_id, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS extension_activity_events_actor_date_idx
  ON extension_activity_events(actor_user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS extension_activity_events_type_date_idx
  ON extension_activity_events(event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS extension_activity_events_job_idx
  ON extension_activity_events(job_id) WHERE job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS extension_activity_events_application_idx
  ON extension_activity_events(application_id) WHERE application_id IS NOT NULL;
