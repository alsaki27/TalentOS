-- 049: Durable, idempotent nightly Job Agent batches.
--
-- A batch represents one Asia/Dhaka business date and owns the logical actor
-- shards, their retry attempts, the immutable 48-hour posting window, and the
-- eventual single Job CEO handoff. The migration is additive: existing manual
-- and OpenJobData runs continue to work with their legacy defaults.

CREATE TABLE IF NOT EXISTS job_agent_batches (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key                text NOT NULL UNIQUE,
  business_date            date NOT NULL,
  timezone                 text NOT NULL DEFAULT 'Asia/Dhaka',
  window_start             timestamptz NOT NULL,
  window_end               timestamptz NOT NULL,
  trigger_type             text NOT NULL DEFAULT 'nightly',
  auto_import              boolean NOT NULL DEFAULT true,
  status                   text NOT NULL DEFAULT 'creating'
                           CHECK (status IN (
                             'creating', 'launching', 'running',
                             'finalizing', 'finalization_failed',
                             'succeeded', 'partial_success',
                             'failed', 'cancelled'
                           )),
  actor_sources            text[] NOT NULL DEFAULT '{}',
  role_groups              text[] NOT NULL DEFAULT '{}',
  result_ceilings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_shards          int NOT NULL DEFAULT 0 CHECK (expected_shards >= 0),
  terminal_shards          int NOT NULL DEFAULT 0 CHECK (terminal_shards >= 0),
  succeeded_shards         int NOT NULL DEFAULT 0 CHECK (succeeded_shards >= 0),
  failed_shards            int NOT NULL DEFAULT 0 CHECK (failed_shards >= 0),
  raw_count                int NOT NULL DEFAULT 0 CHECK (raw_count >= 0),
  accepted_count           int NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  date_excluded_count      int NOT NULL DEFAULT 0 CHECK (date_excluded_count >= 0),
  date_exclusion_reasons   jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_count          int NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  final_duplicate_count    int NOT NULL DEFAULT 0 CHECK (final_duplicate_count >= 0),
  classified_count         int NOT NULL DEFAULT 0 CHECK (classified_count >= 0),
  imported_count           int NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  errors                   jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error               text,
  job_ceo_run_id           uuid REFERENCES job_ceo_runs(id) ON DELETE SET NULL,
  finalization_claim_token uuid,
  finalization_claimed_at  timestamptz,
  started_at               timestamptz,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_agent_batches_window_order CHECK (window_end > window_start),
  CONSTRAINT job_agent_batches_exact_window CHECK (window_end - window_start = interval '48 hours')
);

CREATE INDEX IF NOT EXISTS job_agent_batches_status_created_idx
  ON job_agent_batches (status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS job_agent_batches_job_ceo_run_unique_idx
  ON job_agent_batches (job_ceo_run_id)
  WHERE job_ceo_run_id IS NOT NULL;

ALTER TABLE job_agent_batches
  ADD COLUMN IF NOT EXISTS date_exclusion_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_duplicate_count int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS job_agent_batch_shards (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id               uuid NOT NULL REFERENCES job_agent_batches(id) ON DELETE CASCADE,
  shard_key              text NOT NULL,
  logical_order          smallint NOT NULL CHECK (logical_order >= 0),
  actor_source           text NOT NULL CHECK (actor_source IN ('indeed', 'google', 'linkedin')),
  role_groups            text[] NOT NULL,
  search_queries         text[] NOT NULL DEFAULT '{}',
  search_query           text,
  allocated_result_limit int NOT NULL CHECK (allocated_result_limit > 0),
  status                 text NOT NULL DEFAULT 'pending'
                         CHECK (status IN (
                           'pending', 'launching', 'running', 'processing',
                           'retry_wait', 'succeeded', 'failed', 'cancelled'
                         )),
  attempt_count          int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts           int NOT NULL DEFAULT 4 CHECK (max_attempts BETWEEN 1 AND 10),
  active_run_id          uuid REFERENCES job_agent_runs(id) ON DELETE SET NULL,
  last_run_id            uuid REFERENCES job_agent_runs(id) ON DELETE SET NULL,
  next_retry_at          timestamptz,
  launch_claim_token     uuid,
  launch_claimed_at      timestamptz,
  raw_count              int NOT NULL DEFAULT 0 CHECK (raw_count >= 0),
  accepted_count         int NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  date_excluded_count    int NOT NULL DEFAULT 0 CHECK (date_excluded_count >= 0),
  date_exclusion_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_count        int NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  classified_count       int NOT NULL DEFAULT 0 CHECK (classified_count >= 0),
  imported_count         int NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  errors                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_error             text,
  started_at             timestamptz,
  completed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, shard_key),
  UNIQUE (batch_id, logical_order),
  UNIQUE (batch_id, id)
);

CREATE INDEX IF NOT EXISTS job_agent_batch_shards_ready_idx
  ON job_agent_batch_shards (batch_id, status, next_retry_at, logical_order);
CREATE INDEX IF NOT EXISTS job_agent_batch_shards_active_run_idx
  ON job_agent_batch_shards (active_run_id)
  WHERE active_run_id IS NOT NULL;

ALTER TABLE job_agent_batch_shards
  ADD COLUMN IF NOT EXISTS search_queries text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS date_exclusion_reasons jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE job_agent_runs
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES job_agent_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_shard_id uuid REFERENCES job_agent_batch_shards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_number int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS trigger_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS window_end timestamptz,
  ADD COLUMN IF NOT EXISTS allocated_result_limit int,
  ADD COLUMN IF NOT EXISTS auto_import boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_import_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS auto_import_error text,
  ADD COLUMN IF NOT EXISTS auto_import_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS search_queries_ran text[],
  ADD COLUMN IF NOT EXISTS date_excluded_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_exclusion_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_batch_shard_pair_fk'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_batch_shard_pair_fk
      FOREIGN KEY (batch_id, batch_shard_id)
      REFERENCES job_agent_batch_shards(batch_id, id)
      MATCH FULL ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_window_order'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_window_order
      CHECK (window_start IS NULL OR window_end IS NULL OR window_end > window_start);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_attempt_number_positive'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_attempt_number_positive CHECK (attempt_number > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_allocated_limit_positive'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_allocated_limit_positive
      CHECK (allocated_result_limit IS NULL OR allocated_result_limit > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_runs_auto_import_status_check'
  ) THEN
    ALTER TABLE job_agent_runs
      ADD CONSTRAINT job_agent_runs_auto_import_status_check
      CHECK (auto_import_status IN ('not_requested', 'pending', 'claimed', 'succeeded', 'failed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS job_agent_runs_batch_shard_attempt_unique_idx
  ON job_agent_runs (batch_shard_id, attempt_number)
  WHERE batch_shard_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_agent_runs_batch_idx
  ON job_agent_runs (batch_id, status, started_at);

ALTER TABLE job_agent_staged_jobs
  ADD COLUMN IF NOT EXISTS canonical_signature text,
  ADD COLUMN IF NOT EXISTS parsed_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS date_window_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS date_exclusion_reason text,
  ADD COLUMN IF NOT EXISTS import_exclusion_reason text,
  ADD COLUMN IF NOT EXISTS date_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS batch_dedup_score int,
  ADD COLUMN IF NOT EXISTS batch_dedup_winner boolean;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_agent_staged_jobs_date_window_status_check'
  ) THEN
    ALTER TABLE job_agent_staged_jobs
      ADD CONSTRAINT job_agent_staged_jobs_date_window_status_check
      CHECK (date_window_status IN ('not_checked', 'in_window', 'excluded'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS job_agent_staged_jobs_run_canonical_unique_idx
  ON job_agent_staged_jobs (run_id, canonical_signature)
  WHERE canonical_signature IS NOT NULL;
CREATE INDEX IF NOT EXISTS job_agent_staged_jobs_date_window_idx
  ON job_agent_staged_jobs (run_id, date_window_status);

-- A direct source-row link gives the batch importer an idempotency key and lets
-- it mark only rows that the INSERT ... ON CONFLICT ... RETURNING CTE actually
-- accepted. Existing Job CEO rows remain NULL and are unaffected.
ALTER TABLE job_ceo_staging
  ADD COLUMN IF NOT EXISTS source_job_agent_staged_id uuid
  REFERENCES job_agent_staged_jobs(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_ceo_staging_source_job_agent_unique_idx
  ON job_ceo_staging (source_job_agent_staged_id)
  WHERE source_job_agent_staged_id IS NOT NULL;

-- Restrict this protection to new Job Agent bridge rows. Applying a global
-- unique index to legacy Job CEO data could fail if historical runs contain
-- duplicates; source-linked rows are guaranteed to be new after this migration.
CREATE UNIQUE INDEX IF NOT EXISTS job_ceo_staging_job_agent_run_signature_unique_idx
  ON job_ceo_staging (run_id, dedup_signature)
  WHERE dedup_signature IS NOT NULL AND source_job_agent_staged_id IS NOT NULL;

-- Reservations close the race where concurrent shard starts all observe the
-- same pre-run token spend. A reservation remains budget-accounted while it is
-- active, consumed, or settled; only released/expired reservations stop counting.
CREATE TABLE IF NOT EXISTS job_agent_apify_token_reservations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_key        text NOT NULL UNIQUE,
  token_id               uuid NOT NULL REFERENCES job_agent_apify_tokens(id) ON DELETE CASCADE,
  batch_shard_id         uuid REFERENCES job_agent_batch_shards(id) ON DELETE SET NULL,
  run_id                 uuid UNIQUE REFERENCES job_agent_runs(id) ON DELETE SET NULL,
  business_date          date NOT NULL,
  reserved_amount_usd    numeric(8,4) NOT NULL CHECK (reserved_amount_usd >= 0),
  settled_amount_usd     numeric(8,4) CHECK (settled_amount_usd IS NULL OR settled_amount_usd >= 0),
  daily_limit_usd        numeric(8,4) NOT NULL CHECK (daily_limit_usd > 0),
  status                 text NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'consumed', 'settled', 'released', 'expired')),
  expires_at             timestamptz NOT NULL,
  released_reason        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_agent_token_reservations_budget_idx
  ON job_agent_apify_token_reservations (token_id, business_date, status);
CREATE INDEX IF NOT EXISTS job_agent_token_reservations_expiry_idx
  ON job_agent_apify_token_reservations (expires_at)
  WHERE status = 'active';

ALTER TABLE job_agent_runs
  ADD COLUMN IF NOT EXISTS token_reservation_id uuid
  REFERENCES job_agent_apify_token_reservations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS job_agent_runs_token_reservation_unique_idx
  ON job_agent_runs (token_reservation_id)
  WHERE token_reservation_id IS NOT NULL;

-- The business date, posting window, and execution snapshot define a batch's
-- identity. Changing them after shards exist would make decisions unauditable.
CREATE OR REPLACE FUNCTION prevent_job_agent_batch_window_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_date IS DISTINCT FROM OLD.business_date
     OR NEW.timezone IS DISTINCT FROM OLD.timezone
     OR NEW.window_start IS DISTINCT FROM OLD.window_start
     OR NEW.window_end IS DISTINCT FROM OLD.window_end
     OR NEW.trigger_type IS DISTINCT FROM OLD.trigger_type
     OR NEW.auto_import IS DISTINCT FROM OLD.auto_import
     OR NEW.actor_sources IS DISTINCT FROM OLD.actor_sources
     OR NEW.role_groups IS DISTINCT FROM OLD.role_groups
     OR NEW.result_ceilings IS DISTINCT FROM OLD.result_ceilings
     OR NEW.expected_shards IS DISTINCT FROM OLD.expected_shards THEN
    RAISE EXCEPTION 'Job Agent batch identity and execution snapshot are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_agent_batches_immutable_window ON job_agent_batches;
CREATE TRIGGER job_agent_batches_immutable_window
BEFORE UPDATE OF business_date, timezone, window_start, window_end, trigger_type,
                 auto_import, actor_sources, role_groups, result_ceilings, expected_shards
ON job_agent_batches
FOR EACH ROW
EXECUTE FUNCTION prevent_job_agent_batch_window_change();

CREATE OR REPLACE FUNCTION prevent_job_agent_shard_definition_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.shard_key IS DISTINCT FROM OLD.shard_key
     OR NEW.logical_order IS DISTINCT FROM OLD.logical_order
     OR NEW.actor_source IS DISTINCT FROM OLD.actor_source
     OR NEW.role_groups IS DISTINCT FROM OLD.role_groups
     OR NEW.search_queries IS DISTINCT FROM OLD.search_queries
     OR NEW.search_query IS DISTINCT FROM OLD.search_query
     OR NEW.allocated_result_limit IS DISTINCT FROM OLD.allocated_result_limit
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts THEN
    RAISE EXCEPTION 'Job Agent shard definition is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_agent_batch_shards_immutable_definition ON job_agent_batch_shards;
CREATE TRIGGER job_agent_batch_shards_immutable_definition
BEFORE UPDATE OF batch_id, shard_key, logical_order, actor_source, role_groups,
                 search_queries, search_query, allocated_result_limit, max_attempts
ON job_agent_batch_shards
FOR EACH ROW
EXECUTE FUNCTION prevent_job_agent_shard_definition_change();
