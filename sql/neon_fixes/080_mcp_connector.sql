-- MCP connector credentials and audit trail.
-- Plaintext keys are never stored.
CREATE TABLE IF NOT EXISTS mcp_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS mcp_api_keys_active_hash_idx ON mcp_api_keys(key_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS mcp_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid REFERENCES mcp_api_keys(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  tool_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('read','write','auth','error')),
  scopes text[] NOT NULL DEFAULT '{}',
  candidate_id uuid REFERENCES candidates(id) ON DELETE SET NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  success boolean NOT NULL DEFAULT true,
  error_code text,
  arguments_hash text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mcp_audit_created_idx ON mcp_audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_key_idx ON mcp_audit_events(api_key_id, created_at DESC);
