-- 009: Route versioning for transactional route replacement + limits enforcement.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

-- Add route_version to ai_automations for optimistic concurrency control
ALTER TABLE ai_automations ADD COLUMN IF NOT EXISTS route_version int NOT NULL DEFAULT 1;

-- Index for limit checks in routing.ts
CREATE INDEX IF NOT EXISTS aue_key_date_idx ON ai_usage_events (ai_key_id, created_at);
CREATE INDEX IF NOT EXISTS aue_key_month_idx ON ai_usage_events (ai_key_id, (date_trunc('month', created_at)));
