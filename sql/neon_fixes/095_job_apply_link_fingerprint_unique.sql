-- 095: Database-level backstop for apply-link duplicate protection.
--
-- The real duplicate check is application-level (checkJobDuplicate /
-- checkJobDuplicatesBatch in jobDuplicateGuard.ts, embedded in
-- createJob()/createJobs()) and checks against ALL jobs regardless of date -
-- that's what satisfies "check against every job already in TalentOS."
-- This index is not that guarantee; it exists only to catch what the
-- application layer cannot: a check-then-insert race (the Neon HTTP driver
-- has no real cross-statement transactions), or a future insert that
-- bypasses the app layer entirely (raw SQL run directly against the DB).
--
-- Scoped to rows created on/after this migration's rollout date so it can
-- ship immediately without failing against any duplicate pairs that already
-- existed before this system existed - those are surfaced separately via a
-- read-only report (see scripts/backfill-job-fingerprints.ts's output) for
-- manual review, never auto-resolved by a migration.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS jobs_apply_link_fingerprint_unique_idx
  ON jobs (apply_link_fingerprint)
  WHERE apply_link_fingerprint IS NOT NULL AND created_at >= '2026-09-06T00:00:00Z'::timestamptz;
