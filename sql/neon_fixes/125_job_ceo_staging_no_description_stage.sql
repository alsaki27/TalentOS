-- 125: Reconcile job_ceo_staging.stage's CHECK constraint with what's already
-- live in production.
--
-- 'no_description' has been a real, actively-written stage value since the
-- Adzuna integration shipped (2026-10-14) — jobCeoService.ts's Deep Fetch
-- stage has written it all along, and confirmed live against production on
-- 2026-10-25 it IS already accepted there. But no committed migration in
-- this directory ever added it to the constraint (034_job_ceo.sql's original
-- list only has 'ingested','qa_passed','qa_dropped','researched','matched',
-- 'logged','error') — it was applied to production outside of version
-- control at some point. A fresh database bootstrapped from these migration
-- files alone would silently reject every no_description write. This closes
-- that gap without changing any live behavior.
--
-- See "Adzuna Job CEO Coverage and Description Recovery Plan" (2026-10-25).
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'job_ceo_staging_stage_check'
  ) THEN
    ALTER TABLE job_ceo_staging DROP CONSTRAINT job_ceo_staging_stage_check;
  END IF;

  ALTER TABLE job_ceo_staging
    ADD CONSTRAINT job_ceo_staging_stage_check
    CHECK (stage IN ('ingested','qa_passed','qa_dropped','researched','matched','logged','error','no_description'));
END $$;
