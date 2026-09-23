-- 100: Make the pre-existing `job_duplicates` table usable as the duplicate
-- review queue it was clearly designed to be.
--
-- The table already existed with exactly the right shape (canonical_job_id,
-- duplicate_job_id, similarity_score, resolved) but no code has ever read or
-- written it - confirmed by grepping the whole repo for "job_duplicates": zero
-- references, zero rows. Rather than invent a second table for the same job,
-- the cross-platform duplicate detector (jobContentDuplicateGuard.ts) now
-- writes its findings here, so every automatic hide has an auditable,
-- reversible trail.
--
-- Two things are needed before it can be written to safely:
--
--   1. A unique pair index, so re-running detection (the backfill script is
--      explicitly designed to be re-runnable) records each pair once instead
--      of accumulating a new row per run. This is what the code's
--      ON CONFLICT (canonical_job_id, duplicate_job_id) DO NOTHING targets.
--   2. ON DELETE CASCADE on both job references. Without it, the existing
--      DELETE /api/public/jobs/[id] endpoint would start failing with a
--      foreign-key violation for any job that appears in this queue - a
--      regression in working functionality. The original table definition
--      predates any code using it, so this is corrected here rather than
--      assumed.
--
-- The table is empty, so both changes are non-destructive by construction.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS job_duplicates_pair_unique_idx
  ON job_duplicates (canonical_job_id, duplicate_job_id);

-- Index the review queue's main read pattern (unresolved pairs, newest first).
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_duplicates_unresolved_idx
  ON job_duplicates (created_at DESC)
  WHERE resolved = false;

-- Re-point both foreign keys at ON DELETE CASCADE. Dropping and recreating is
-- safe here only because the table holds no rows; the DO block keeps it
-- idempotent and tolerant of the constraints having any prior name.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'job_duplicates'::regclass AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE job_duplicates DROP CONSTRAINT %I', fk.conname);
  END LOOP;

  ALTER TABLE job_duplicates
    ADD CONSTRAINT job_duplicates_canonical_job_id_fkey
    FOREIGN KEY (canonical_job_id) REFERENCES jobs(id) ON DELETE CASCADE;

  ALTER TABLE job_duplicates
    ADD CONSTRAINT job_duplicates_duplicate_job_id_fkey
    FOREIGN KEY (duplicate_job_id) REFERENCES jobs(id) ON DELETE CASCADE;
END $$;
