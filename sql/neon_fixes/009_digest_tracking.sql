-- Add tracking metadata columns to ai_digests for monitoring
-- digest route reliability and last-run timestamp.

alter table if exists ai_digests
  add column if not exists last_success_at timestamptz;

alter table if exists ai_digests
  add column if not exists last_error text;

-- Backfill: for any existing digest rows that have generated_at but no
-- last_success_at, treat the generation timestamp as the success time.
update ai_digests
  set last_success_at = generated_at
  where last_success_at is null
    and generated_at is not null;
