-- Add tracking metadata columns to ai_digests for monitoring
-- digest route reliability and last-run timestamp.

alter table if exists ai_digests
  add column if not exists last_success_at timestamptz;

alter table if exists ai_digests
  add column if not exists last_error text;

-- Backfill: for any existing digest rows that have generated_at but no
-- last_success_at, treat the generation timestamp as the success time.
DO $$
BEGIN
  IF to_regclass('ai_digests') IS NOT NULL THEN
    UPDATE ai_digests
      SET last_success_at = generated_at
      WHERE last_success_at IS NULL
        AND generated_at IS NOT NULL;
  END IF;
END $$;
