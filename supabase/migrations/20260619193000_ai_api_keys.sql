-- supabase/migrations/20260619193000_ai_api_keys.sql
-- Admin-managed AI API key storage with encrypted secrets, health tracking, and priority ordering.
-- Part of Chunk 3.5: portability guardrails + admin AI API key manager.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text NOT NULL,
  encrypted_key text NOT NULL,
  key_fingerprint text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown',
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  usage_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Status constraint
  CONSTRAINT ai_api_keys_status_check CHECK (
    status IN ('unknown', 'working', 'failing', 'disabled')
  )
);

-- Provider values documented: anthropic, nvidia, openai, google, groq, openrouter, deepseek, local
-- No strict CHECK constraint on provider to allow future providers without migration.

-- Priority index for fast fallback ordering
CREATE INDEX IF NOT EXISTS idx_ai_api_keys_enabled_priority
  ON ai_api_keys(is_enabled, priority, created_at);

-- Provider index for filtering
CREATE INDEX IF NOT EXISTS idx_ai_api_keys_provider
  ON ai_api_keys(provider);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_ai_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ai_api_keys_updated_at ON ai_api_keys;
CREATE TRIGGER trigger_ai_api_keys_updated_at
  BEFORE UPDATE ON ai_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_api_keys_updated_at();

COMMIT;
