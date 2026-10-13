-- Per-candidate timezone, for AE visibility into each candidate's local time.
-- timezone: nullable IANA string, derived from current_location (existing
-- candidates: backfilled from their base resume's header location via
-- scripts/backfill-candidate-timezones-from-resume.mjs; new candidates:
-- derived at add-time from current_location). Null means "could not be
-- determined" - reported to staff, never guessed.
-- current_location: nullable "City, ST" free text - the candidate's current
-- location (distinct from location_preference, which is a job-search
-- preference like "Remote" and not necessarily where they actually live).
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS current_location text;
