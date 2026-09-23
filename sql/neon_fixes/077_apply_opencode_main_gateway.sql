-- Apply the published OPENCODE MAIN 8.12 snapshot to live routing.
--
-- The original state was marked published, but publishing only changed the
-- state metadata. Live ai_automation_routes therefore continued to point at
-- the legacy Vertex proxy. This repair makes the gateway key authoritative:
-- OpenCode/DeepSeek (or Luna) primary, MiniMax M2.5 fallback, no Vertex route.

DO $$
DECLARE
  v_state_id uuid;
  v_opencode_key uuid;
BEGIN
  SELECT id INTO v_state_id
  FROM ai_routing_states
  WHERE name = 'OPENCODE MAIN 8.12'
  LIMIT 1;

  SELECT id INTO v_opencode_key
  FROM ai_api_keys
  WHERE provider = 'opencode' AND is_enabled = true
  ORDER BY priority ASC, created_at ASC
  LIMIT 1;

  IF v_state_id IS NULL THEN
    RAISE EXCEPTION 'OPENCODE MAIN 8.12 state is missing';
  END IF;
  IF v_opencode_key IS NULL THEN
    RAISE EXCEPTION 'No enabled OpenCode API key is available';
  END IF;

  -- Keep each state primary model/reasoning plan, but make every fallback
  -- use the same gateway and MiniMax instead of Vertex/Gemini.
  UPDATE ai_routing_state_routes
  SET ai_key_id = v_opencode_key,
      provider = NULL
  WHERE state_id = v_state_id AND rank = 1;

  UPDATE ai_routing_state_routes
  SET ai_key_id = v_opencode_key,
      provider = NULL,
      model_override = 'minimax-m2.5',
      is_enabled = true
  WHERE state_id = v_state_id AND rank = 2;

  UPDATE ai_routing_state_routes
  SET ai_key_id = v_opencode_key,
      provider = NULL,
      model_override = 'minimax-m2.5',
      is_enabled = false
  WHERE state_id = v_state_id AND rank >= 3;

  -- Apply the state snapshot to the live rows.
  UPDATE ai_automation_routes live
  SET ai_key_id = snapshot.ai_key_id,
      provider = snapshot.provider,
      model_override = snapshot.model_override,
      is_enabled = snapshot.is_enabled,
      updated_at = now()
  FROM ai_routing_state_routes snapshot
  WHERE snapshot.state_id = v_state_id
    AND snapshot.automation_id = live.automation_id
    AND snapshot.rank = live.rank;

  -- The live table also carries rank-99 emergency rows that are not present
  -- in the prepared state. Disable them while keeping the check constraint
  -- valid with the OpenCode key.
  UPDATE ai_automation_routes
  SET ai_key_id = v_opencode_key,
      provider = NULL,
      model_override = 'minimax-m2.5',
      is_enabled = false,
      updated_at = now()
  WHERE rank >= 99;

  UPDATE ai_routing_states
  SET status = 'published', published_at = COALESCE(published_at, now()), updated_at = now()
  WHERE id = v_state_id;
END $$;

INSERT INTO ai_admin_audit_log (action, ai_key_id, metadata)
SELECT 'apply_routing_state', k.id,
       jsonb_build_object(
         'stateName', 'OPENCODE MAIN 8.12',
         'primaryProvider', 'opencode',
         'fallbackModel', 'minimax-m2.5',
         'vertexRoutesDisabled', true,
         'source', '077_apply_opencode_main_gateway'
       )
FROM ai_api_keys k
WHERE k.provider = 'opencode' AND k.is_enabled = true
ORDER BY k.priority ASC, k.created_at ASC
LIMIT 1;
