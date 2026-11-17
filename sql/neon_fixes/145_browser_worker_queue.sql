-- Registered workers poll this independent prepare queue. Recruiting stage and
-- its history still live on applications.
CREATE TABLE IF NOT EXISTS browser_worker_queue_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  registered_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid
);

CREATE TABLE IF NOT EXISTS browser_worker_queue_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES browser_worker_queue_workers(id),
  requested_by uuid NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL DEFAULT 'prepare' CHECK (operation = 'prepare'),
  job_url text NOT NULL,
  expected_dialog_heading text NOT NULL,
  job_version text NOT NULL CHECK (job_version ~ '^[a-f0-9]{64}$'),
  resume_revision text NOT NULL CHECK (resume_revision ~ '^[a-f0-9]{64}$'),
  export_id uuid NOT NULL,
  resume_version_id uuid NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length integer NOT NULL CHECK (byte_length BETWEEN 5 AND 1999999),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','leased','prepared','needs_human','failed','submission_unknown')),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 2),
  profile_version text,
  lease_token_hash text CHECK (lease_token_hash ~ '^[a-f0-9]{64}$'),
  lease_expires_at timestamptz,
  result jsonb,
  result_hash text CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (requested_by, idempotency_key),
  CHECK (status <> 'leased' OR (attempt > 0 AND profile_version IS NOT NULL AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK ((status IN ('queued','leased') AND completed_at IS NULL AND result IS NULL AND result_hash IS NULL)
      OR (status NOT IN ('queued','leased') AND completed_at IS NOT NULL AND result IS NOT NULL AND result_hash IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS browser_worker_queue_active_application
  ON browser_worker_queue_jobs(application_id) WHERE status IN ('queued','leased','submission_unknown');
CREATE UNIQUE INDEX IF NOT EXISTS browser_worker_queue_worker_lease
  ON browser_worker_queue_jobs(worker_id) WHERE status = 'leased';
CREATE INDEX IF NOT EXISTS browser_worker_queue_claim_order
  ON browser_worker_queue_jobs(worker_id, created_at, id) WHERE status IN ('queued','leased');
CREATE INDEX IF NOT EXISTS browser_worker_queue_app_results
  ON browser_worker_queue_jobs(application_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS browser_worker_queue_candidate_results
  ON browser_worker_queue_jobs(candidate_id, completed_at DESC, id DESC) WHERE result IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_browser_worker_queue_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','attempt','profile_version','lease_token_hash','lease_expires_at','result','result_hash','completed_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','attempt','profile_version','lease_token_hash','lease_expires_at','result','result_hash','completed_at']) THEN
    RAISE EXCEPTION 'Worker queue application snapshots are immutable';
  END IF;
  IF OLD.status NOT IN ('queued','leased') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Worker queue terminal results are immutable';
  END IF;
  IF OLD.profile_version IS NOT NULL AND NEW.profile_version IS DISTINCT FROM OLD.profile_version THEN
    RAISE EXCEPTION 'Worker queue candidate profile is pinned across attempts';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS protect_browser_worker_queue_job ON browser_worker_queue_jobs;
CREATE TRIGGER protect_browser_worker_queue_job BEFORE UPDATE ON browser_worker_queue_jobs
  FOR EACH ROW EXECUTE FUNCTION protect_browser_worker_queue_job();
