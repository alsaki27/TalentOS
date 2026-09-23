-- 036: Cross-run deduplication for Job CEO pipeline.
-- Prevents the same job (same title+company) from being re-ingested on
-- subsequent daily runs. The dedup_signature is lower(title)|lower(company).
-- Idempotent.

CREATE TABLE IF NOT EXISTS job_ceo_seen_signatures (
  signature      text PRIMARY KEY,
  first_seen_at  timestamptz DEFAULT now(),
  run_id         uuid,
  title          text,
  company        text
);

CREATE INDEX IF NOT EXISTS job_ceo_seen_sigs_run_idx ON job_ceo_seen_signatures (run_id);
CREATE INDEX IF NOT EXISTS job_ceo_seen_sigs_seen_idx ON job_ceo_seen_signatures (first_seen_at DESC);

-- 037: Job CEO ingest schedule table.
-- Stores the user-configurable cron settings so the schedule can be
-- controlled from the live website instead of editing YAML files.
-- Idempotent.

CREATE TABLE IF NOT EXISTS job_ceo_schedule (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_enabled        boolean NOT NULL DEFAULT true,
  cron_expression   text NOT NULL DEFAULT '30 9 * * *',
  role_group        text NOT NULL DEFAULT 'all',
  days_back         int NOT NULL DEFAULT 1,
  dry_run           boolean NOT NULL DEFAULT false,
  notes             text,
  updated_at        timestamptz DEFAULT now(),
  updated_by        uuid REFERENCES profiles(user_id) ON DELETE SET NULL
);

-- Seed with a single default row (only insert if table is empty)
INSERT INTO job_ceo_schedule (is_enabled, cron_expression, role_group, days_back, notes)
SELECT true, '30 9 * * *', 'all', 1, 'Default: daily at 09:30 UTC, all role groups, 1 day lookback'
WHERE NOT EXISTS (SELECT 1 FROM job_ceo_schedule LIMIT 1);

-- Add skipped_count to job_ceo_runs to track duplicate skips per run
ALTER TABLE job_ceo_runs ADD COLUMN IF NOT EXISTS skipped_count int DEFAULT 0;
