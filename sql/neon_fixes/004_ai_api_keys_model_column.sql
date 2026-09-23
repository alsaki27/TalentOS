-- Add a per-key model override. Null means "use that provider's env-var default
-- or built-in fallback" (existing behavior, unchanged). Lets the admin UI offer a
-- model dropdown per key instead of being stuck with one hardcoded default per
-- provider - the user explicitly wants to choose from multiple real options, not
-- have one guessed for them.
ALTER TABLE ai_api_keys
  ADD COLUMN IF NOT EXISTS model text;
