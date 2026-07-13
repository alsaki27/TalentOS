-- 028: applications.follow_up_source / follow_up_created_at / follow_up_completed_at
--
-- Referenced throughout the app (src/lib/applicationAutomation.ts,
-- src/app/api/applications/route.ts, src/app/api/applications/[id]/route.ts,
-- src/app/api/follow-ups/route.ts, src/server/repositories/applicationsRepository.ts,
-- the public extension-API routes) but never added when applications was
-- created for Neon (sql/01_schema.sql only has follow_up_at). Every read of
-- GET /api/follow-ups has been failing with a Postgres "column does not
-- exist" error (surfaced to the UI as "Could not load follow-ups.") since
-- that page shipped.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS follow_up_source text,
  ADD COLUMN IF NOT EXISTS follow_up_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS follow_up_completed_at timestamptz;
