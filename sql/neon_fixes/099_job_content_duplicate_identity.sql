-- 099: Cross-platform job duplicate detection by content identity.
--
-- apply_link_fingerprint (094/095) only catches a duplicate when two
-- postings share a URL/ID - useless when the same job is captured from
-- platforms that share nothing (LinkedIn + Indeed + a remote-job aggregator
-- mirroring one of them, for example). This adds an indexed lookup key so
-- src/server/services/jobContentDuplicateGuard.ts can find same-company
-- same-title postings without a full-table scan on every insert.
--
-- content_identity_key is intentionally NOT unique. Real production data
-- proves employers legitimately reuse one title across many distinct
-- requisitions (Amazon: 9+ separate real postings titled "Innovation and
-- Design Engineer, Worldwide Design Engineering"; ABB: 10 separate real
-- postings titled "Senior Field Service Technician", several in the same
-- city) - a unique constraint here would incorrectly reject real distinct
-- jobs. The guard's own group-size check is what keeps this precise, not
-- the schema.
--
-- content_duplicate_of/content_duplicate_reason are a non-destructive,
-- reversible audit trail: when the guard is confident enough to mark a new
-- row is_active = false, these say why and point at the posting it matches,
-- so an admin can undo it (UPDATE jobs SET is_active = true,
-- content_duplicate_of = NULL WHERE id = ...) if it's ever wrong. Nothing
-- is ever deleted by this system.
--
-- ON DELETE SET NULL: DELETE /api/public/jobs/[id] (src/app/api/public/jobs/[id]/route.ts)
-- does a plain DELETE FROM jobs WHERE id = $1 on any job, including one
-- other rows point to via content_duplicate_of. Without SET NULL, deleting
-- the ORIGINAL of a flagged pair would fail with a foreign-key violation -
-- a real regression in existing delete functionality. Losing the "points to
-- X" audit trail once X is actually gone is an acceptable trade for that.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_identity_key text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_duplicate_of uuid REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS content_duplicate_reason text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_content_identity_key_idx
  ON jobs (content_identity_key)
  WHERE content_identity_key IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_content_duplicate_of_idx
  ON jobs (content_duplicate_of)
  WHERE content_duplicate_of IS NOT NULL;
