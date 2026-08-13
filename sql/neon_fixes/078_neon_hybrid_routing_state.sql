-- Reviewable Neon-backed routing state. Every route points at an exact key row;
-- provider-only/environment resolution is intentionally absent.
DO $$
DECLARE
  v_state_id uuid;
  v_opencode_key uuid;
  v_vertex_key uuid;
BEGIN
  SELECT id INTO v_opencode_key
  FROM ai_api_keys
  WHERE provider = 'opencode' AND is_enabled = true
  ORDER BY priority, created_at LIMIT 1;

  SELECT id INTO v_vertex_key
  FROM ai_api_keys
  WHERE provider = 'google_vertex_proxy' AND is_enabled = true
  ORDER BY priority, created_at LIMIT 1;

  INSERT INTO ai_routing_states (name, description, status)
  VALUES (
    'NEON HYBRID 8.13',
    'Exact-key routing: OpenCode task-specific models primary, Skarion Vertex coding-cheap fallback; all credentials and endpoints managed in Neon.',
    'draft'
  )
  ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, updated_at = now()
  RETURNING id INTO v_state_id;

  DELETE FROM ai_routing_state_routes WHERE state_id = v_state_id;

  INSERT INTO ai_routing_state_routes
    (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
  SELECT v_state_id, a.id, 1, v_opencode_key, NULL,
         COALESCE(source.model_override, 'deepseek-v4-flash'),
         source.reasoning_effort, true
  FROM ai_automations a
  LEFT JOIN LATERAL (
    SELECT r.model_override, r.reasoning_effort
    FROM ai_routing_state_routes r
    JOIN ai_routing_states s ON s.id = r.state_id
    WHERE r.automation_id = a.id
      AND (r.provider = 'opencode' OR r.ai_key_id = v_opencode_key)
    ORDER BY (s.status = 'published') DESC, s.updated_at DESC, r.rank
    LIMIT 1
  ) source ON true
  WHERE a.is_active = true AND v_opencode_key IS NOT NULL;

  INSERT INTO ai_routing_state_routes
    (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
  SELECT v_state_id, a.id, 2, v_vertex_key, NULL, 'coding-cheap', NULL, true
  FROM ai_automations a
  WHERE a.is_active = true AND v_vertex_key IS NOT NULL;
END $$;
