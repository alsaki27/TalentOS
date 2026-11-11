-- Opt-in prepare-only worker: independent of application lifecycle and queue UI.
-- Apply to a separate staging database only, after reviewing environment bindings.
CREATE TABLE IF NOT EXISTS browser_worker_prepare_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id),
  candidate_id uuid NOT NULL REFERENCES candidates(id),
  job_id uuid NOT NULL REFERENCES jobs(id),
  export_id uuid NOT NULL REFERENCES application_resume_exports(id),
  resume_version_id uuid NOT NULL REFERENCES application_resume_versions(id),
  profile_ref text NOT NULL CHECK (profile_ref = candidate_id::text),
  profile_version text NOT NULL CHECK (profile_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  job_version text NOT NULL,
  job_snapshot jsonb NOT NULL,
  resume_snapshot jsonb NOT NULL,
  job_url text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 5 AND 10485760),
  artifact_bytes bytea NOT NULL,
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES profiles(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES profiles(user_id),
  CHECK (octet_length(artifact_bytes) = byte_length),
  CHECK (expires_at > created_at)
);
-- This first integration deliberately enrolls only one application per candidate.
-- Explicit revocation is required before replacing it, including after expiry.
CREATE UNIQUE INDEX IF NOT EXISTS browser_worker_prepare_active_candidate
  ON browser_worker_prepare_enrollments(candidate_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS browser_worker_prepare_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL UNIQUE REFERENCES browser_worker_prepare_enrollments(id),
  status text NOT NULL DEFAULT 'leased' CHECK (status IN ('leased','prepared','needs_human','failed')),
  lease_token_hash text NOT NULL CHECK (lease_token_hash ~ '^[a-f0-9]{64}$'),
  lease_expires_at timestamptz NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  result jsonb,
  result_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'leased' AND result IS NULL AND result_hash IS NULL AND completed_at IS NULL)
    OR (status <> 'leased' AND result IS NOT NULL AND result_hash IS NOT NULL AND completed_at IS NOT NULL))
);

-- Archived exports can be overwritten by the existing archive service. This
-- separate verified byte snapshot and its identity must never change in place.
CREATE OR REPLACE FUNCTION protect_browser_worker_prepare_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['revoked_at','revoked_by']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['revoked_at','revoked_by']) THEN
    RAISE EXCEPTION 'Browser worker enrollment snapshots are immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND
    (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at OR NEW.revoked_by IS DISTINCT FROM OLD.revoked_by) THEN
    RAISE EXCEPTION 'Browser worker enrollment revocation is irreversible';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_browser_worker_prepare_snapshot ON browser_worker_prepare_enrollments;
CREATE TRIGGER protect_browser_worker_prepare_snapshot BEFORE UPDATE ON browser_worker_prepare_enrollments
  FOR EACH ROW EXECUTE FUNCTION protect_browser_worker_prepare_snapshot();

COMMENT ON TABLE browser_worker_prepare_runs IS
  'Prepare-only worker outcomes. Never evidence of employer submission; does not update applications or stage history.';
