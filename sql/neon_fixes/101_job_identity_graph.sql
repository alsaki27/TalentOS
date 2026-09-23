-- 101: Keep EVERY identity a job posting can be recognized by, not just one.
--
-- Why this table exists. computeApplyLinkFingerprint() returns a single winning
-- key, so a row whose apply_url is an aggregator but whose source_url is the
-- employer's real ATS requisition stores only the aggregator key and DISCARDS
-- the requisition identity. Confirmed on live data: a row with
-- apply_url = indeed.com/viewjob?jk=... and source_url = grnh.se/... was stored
-- as "indeed:..." with the Greenhouse identity thrown away. A shared requisition
-- id is the one authoritative cross-platform signal there is - two captures
-- pointing at one Greenhouse/Lever/Workday requisition ARE the same job, by
-- definition - so all identities are kept and matched on overlap.
--
-- Deliberately a satellite table rather than an array column on `jobs`, matching
-- the existing `job_duplicates` pattern: it needs its own uniqueness rules and
-- is written/read independently of the job row itself.
--
-- `kind` records how strong the identity is:
--   'platform' - a verified per-platform job key (indeed:<jk>, linkedin:<id>,
--                greenhouse:<board>:<id>, ...). Highest confidence.
--   'generic'  - a posting id extracted from an arbitrary host by shape
--                (host:<id>), which is what makes this work for a platform
--                nobody has written a matcher for yet.
-- Normalized whole-URL fingerprints are deliberately NOT stored here: they are
-- not per-posting ids, and several jobs captured from one search page would
-- share one, which would make the hard-block check reject a real distinct job.
CREATE TABLE IF NOT EXISTS job_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  identity text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz DEFAULT NOW()
);

-- ON DELETE CASCADE above is required, not stylistic: DELETE /api/public/jobs/[id]
-- (src/app/api/public/jobs/[id]/route.ts) issues a plain DELETE FROM jobs, and
-- without the cascade that endpoint would start failing with a foreign-key
-- violation for any job carrying identities. Migrations 099 and 100 both had to
-- handle the same thing.

-- One row per (job, identity). Detection is explicitly designed to be re-runnable,
-- so the backfill must be able to re-assert an identity without accumulating
-- duplicate rows. This is what the code's ON CONFLICT DO NOTHING targets.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS job_identities_job_identity_unique_idx
  ON job_identities (job_id, identity);

-- The lookup the duplicate check actually performs: given a candidate's
-- identities, find any job already holding one of them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS job_identities_identity_idx
  ON job_identities (identity);

-- title_location_key is the deliberately weaker fallback identity used for
-- captures whose employer name is unusable - absent, or the scraping site's own
-- name. This is the exact situation behind the reported bug: one GuidePoint
-- Security posting captured from Indeed was stored with company "Indeed.com"
-- (and location "GitLab Runners, Azure", a fragment of the description's tool
-- list), while the LinkedIn capture of the SAME posting was stored correctly, so
-- company+title+location could never match them.
--
-- Not unique, for the same reason 099's key is not: many real distinct
-- requisitions legitimately share a title and a city. It is never sufficient
-- evidence on its own - jobContentDuplicateGuard.ts additionally requires that
-- the matched posting's employer name appear in the candidate's description.
--
-- ADD COLUMN IF NOT EXISTS is doing real work here: the column already exists in
-- the live database from a migration that was later reverted out of the repo,
-- leaving it orphaned with no code referencing it. This re-establishes ownership
-- without disturbing the existing column or its data.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_location_key text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_title_location_key_idx
  ON jobs (title_location_key)
  WHERE title_location_key IS NOT NULL;
