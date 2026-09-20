-- 101: Second, weaker job identity for captures whose employer name is unusable.
--
-- Why this is needed, from real captured rows: the browser extension's generic
-- extractor falls back to the SITE name when it cannot find the employer, so
-- one GuidePoint Security posting captured from Indeed was stored with
-- company "Indeed.com" (and location "GitLab Runners, Azure", a fragment of the
-- description's tool list), while the LinkedIn capture of the SAME posting was
-- stored correctly as "GuidePoint Security". company+title+location could never
-- match those two, so the duplicate was kept - exactly the reported bug.
--
-- content_identity_key (099) stays the primary, strongest identity. This column
-- holds the fallback: normalized title + location bucket, with no company at
-- all. It is deliberately WEAKER and is never sufficient on its own - two
-- employers can post the same title in the same city. The guard pairs it with
-- an independent corroboration (the matched posting's employer name must appear
-- in the candidate's own description text) plus the same rules the primary path
-- uses: exactly one candidate, and never two postings from the same platform.
--
-- Not unique, for the same reason 099's key is not: many real distinct
-- requisitions legitimately share a title and city.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS title_location_key text;

CREATE INDEX CONCURRENTLY IF NOT EXISTS jobs_title_location_key_idx
  ON jobs (title_location_key)
  WHERE title_location_key IS NOT NULL;
