-- 081: Neon-backed round-robin cursors for multi-key provider pools.
--
-- OpenCode Go and Google Vertex Proxy routes can reference one anchor key while
-- the runtime rotates across all enabled sibling keys for that provider. The
-- cursor is deliberately tiny and provider-scoped so adding a second or tenth
-- key requires no route rewrites.
CREATE TABLE IF NOT EXISTS ai_key_pool_cursors (
  pool_key text PRIMARY KEY,
  next_index bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ai_key_pool_cursors IS
  'Round-robin cursor for Neon-managed multi-key AI provider pools. Credentials remain in ai_api_keys.';

COMMENT ON COLUMN ai_key_pool_cursors.pool_key IS
  'Provider pool identifier, currently opencode or google_vertex_proxy.';

CREATE INDEX IF NOT EXISTS ai_key_pool_cursors_updated_idx
  ON ai_key_pool_cursors (updated_at);
