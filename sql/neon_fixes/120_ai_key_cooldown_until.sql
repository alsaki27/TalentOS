-- Cause-aware cooldowns for provider keys with weekly/monthly quota exhaustion.
-- NULL preserves the existing 15-minute cooldown derived from last_failure_at.
ALTER TABLE ai_api_keys
  ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;
