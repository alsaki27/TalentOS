-- 034: Re-seed the Google Vertex (Proxy) ai_api_keys row.
--
-- This row was wiped by a migration reset (same pattern as before, see commit
-- dfc70ec). The row is purely a routable handle for the AI Control Center —
-- the actual secret material (GOOGLE_VERTEX_PROXY_SECRET / GOOGLE_VERTEX_PROXY_URL)
-- lives in Cloudflare Worker env vars, not in this table. The encrypted_key
-- value below is a known placeholder; buildProviderFromDbKey always reads the
-- real secret from the Worker env for this provider type.
--
-- is_protected = true prevents the admin UI from ever letting this row be
-- deleted again (DELETE route returns 409 for protected keys).
 
INSERT INTO ai_api_keys (
  provider,
  label,
  encrypted_key,
  key_fingerprint,
  model,
  default_model,
  priority,
  is_enabled,
  status,
  provider_mode,
  is_protected,
  supports_model_discovery,
  supports_tools,
  supports_json_mode,
  supports_streaming,
  available_models
)
VALUES (
  'google_vertex_proxy',
  'Google Vertex (Proxy)',
  'placeholder-env-managed',          -- real secret is GOOGLE_VERTEX_PROXY_SECRET in Cloudflare env
  'env-managed',                      -- not a real fingerprint; key material is not stored here
  'gemini-2.5-flash',
  'gemini-2.5-flash',
  10,                                 -- high priority (low number = higher priority)
  true,
  'unknown',
  'native',
  true,                               -- is_protected: blocks deletion from admin UI
  false,
  true,
  true,
  false,
  '[]'::jsonb
)
ON CONFLICT DO NOTHING;