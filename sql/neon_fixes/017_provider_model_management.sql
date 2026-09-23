-- 017: AI Provider & Model Management — additive columns for multi-model catalogs,
-- provider mode (native/openai_compatible/custom), model discovery metadata,
-- and the admin audit log table.
-- Idempotent. Applied on every deploy via sql/neon_fixes/ pipeline.

-- ai_api_keys: provider mode, endpoint/api-style metadata, model catalog and discovery
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS provider_mode text NOT NULL DEFAULT 'native';
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS api_style text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS models_endpoint text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS chat_endpoint text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS auth_header_name text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS auth_scheme text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS custom_headers jsonb;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS available_models jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS models_last_synced_at timestamptz;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS models_sync_error text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS default_model text;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS supports_model_discovery boolean NOT NULL DEFAULT false;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS supports_tools boolean NOT NULL DEFAULT true;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS supports_json_mode boolean NOT NULL DEFAULT true;
ALTER TABLE ai_api_keys ADD COLUMN IF NOT EXISTS supports_streaming boolean NOT NULL DEFAULT false;

-- One-time safe backfill: copy existing `model` → `default_model` where null.
-- Idempotent — only updates rows where default_model is still null, so re-runs
-- are safe and never overwrite an admin's later choice of default_model.
UPDATE ai_api_keys SET default_model = model WHERE default_model IS NULL AND model IS NOT NULL;

-- Admin audit log table
CREATE TABLE IF NOT EXISTS ai_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  action text NOT NULL,
  ai_key_id uuid REFERENCES ai_api_keys(id) ON DELETE SET NULL,
  automation_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_admin_audit_log_key_idx ON ai_admin_audit_log (ai_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_admin_audit_log_automation_idx ON ai_admin_audit_log (automation_id, created_at DESC);