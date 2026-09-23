-- 009: Route versioning for transactional route replacement + limits enforcement.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

-- Add route_version to ai_automations for optimistic concurrency control
ALTER TABLE ai_automations ADD COLUMN IF NOT EXISTS route_version int NOT NULL DEFAULT 1;

-- Index for limit checks in routing.ts. checkKeyLimits() filters with a plain
-- `created_at >= date_trunc('month', CURRENT_DATE)` range comparison (not a
-- date_trunc(created_at) expression match), so a plain (ai_key_id, created_at)
-- index fully serves it.
--
-- A prior version of this file also had a functional index on
-- (ai_key_id, date_trunc('month', created_at)) — CREATE INDEX rejects that
-- outright since date_trunc(text, timestamptz) is STABLE, not IMMUTABLE, in
-- Postgres (session-timezone-dependent). Removed; it was never usable.
CREATE INDEX IF NOT EXISTS aue_key_date_idx ON ai_usage_events (ai_key_id, created_at);
