-- Set Resume Forge's active primary OpenCode route to Qwen 3.7 Plus.
-- Keep this narrowly scoped: no other automation, fallback rank, provider key,
-- active routing state, or unrelated model route is changed.
DO $$
DECLARE
  v_state_id uuid;
  v_key_id uuid;
  v_active_key_id uuid;
  v_provider text;
  v_old_model text;
  v_old_reasoning_effort text;
  v_changed boolean := false;
  v_route_found boolean := false;
  v_active_route_found boolean := false;
BEGIN
  SELECT active_routing_state_id
  INTO v_state_id
  FROM ai_runtime_config
  WHERE singleton = true;

  IF v_state_id IS NOT NULL THEN
    SELECT COALESCE(r.provider, k.provider), r.ai_key_id, r.model_override, r.reasoning_effort
    INTO v_provider, v_key_id, v_old_model, v_old_reasoning_effort
    FROM ai_routing_state_routes r
    LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
    WHERE r.state_id = v_state_id
      AND r.automation_id = 'application_resume_forge'
      AND r.rank = 1
      AND r.is_enabled = true
    FOR UPDATE OF r;

    v_route_found := FOUND;
    v_active_route_found := v_route_found;
    v_active_key_id := v_key_id;
    IF v_route_found THEN
      IF v_provider IS DISTINCT FROM 'opencode' THEN
        RAISE EXCEPTION 'Active Resume Forge primary is %, expected opencode; refusing to change it', v_provider;
      END IF;

      IF v_old_model IS DISTINCT FROM 'qwen3.7-plus' OR v_old_reasoning_effort IS NOT NULL THEN
        UPDATE ai_routing_state_routes
        SET model_override = 'qwen3.7-plus',
            reasoning_effort = NULL
        WHERE state_id = v_state_id
          AND automation_id = 'application_resume_forge'
          AND rank = 1;
        v_changed := true;
      END IF;
    END IF;
  END IF;

  -- Keep the legacy route mirror aligned for code paths that temporarily fall
  -- back to ai_automation_routes when an active state has no route rows.
  SELECT COALESCE(r.provider, k.provider), r.ai_key_id, r.model_override
  INTO v_provider, v_key_id, v_old_model
  FROM ai_automation_routes r
  LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
  WHERE r.automation_id = 'application_resume_forge'
    AND r.rank = 1
    AND r.is_enabled = true
  FOR UPDATE OF r;

  IF FOUND THEN
    IF v_provider IS DISTINCT FROM 'opencode' AND NOT v_active_route_found THEN
      RAISE EXCEPTION 'Legacy Resume Forge primary is %, expected opencode; refusing to change it', v_provider;
    END IF;

    IF v_provider = 'opencode' AND v_old_model IS DISTINCT FROM 'qwen3.7-plus' THEN
      UPDATE ai_automation_routes
      SET model_override = 'qwen3.7-plus', updated_at = now()
      WHERE automation_id = 'application_resume_forge'
        AND rank = 1;
      v_changed := true;
    END IF;
    v_route_found := true;
  END IF;

  IF NOT v_route_found THEN
    RAISE EXCEPTION 'No active/legacy Resume Forge primary route found';
  END IF;

  IF v_changed THEN
    INSERT INTO ai_admin_audit_log (action, ai_key_id, automation_id, metadata)
    VALUES (
      'route_changed',
      COALESCE(v_active_key_id, v_key_id),
      'application_resume_forge',
      jsonb_build_object(
        'model', 'qwen3.7-plus',
        'provider', 'opencode',
        'source', '105_resume_forge_qwen37_plus',
        'routing_state_id', v_state_id
      )
    );
  END IF;
END $$;
