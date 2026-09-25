-- Resume Forge route order for the active OpenCode 9.25 state only:
--   rank 1: GLM 5.3 (preserved)
--   rank 2: Qwen 3.7 Plus
--   rank 3: GPT-5.6 Luna
-- Existing OpenCode key assignments are retained; no other agent/state or
-- legacy route is modified. The block is atomic and safe to re-run.
DO $$
DECLARE
  v_state_id uuid;
  v_state_name text;
  v_primary record;
  v_secondary record;
  v_tertiary record;
  v_secondary_found boolean;
  v_tertiary_found boolean;
  v_changed boolean := false;
  v_before jsonb;
BEGIN
  SELECT c.active_routing_state_id, s.name
  INTO v_state_id, v_state_name
  FROM ai_runtime_config c
  LEFT JOIN ai_routing_states s ON s.id = c.active_routing_state_id
  WHERE c.singleton = true
  FOR UPDATE OF c;

  IF v_state_id IS NULL THEN
    RAISE EXCEPTION 'No active AI routing state is configured';
  END IF;
  IF position('opencode 9.25' IN lower(COALESCE(v_state_name, ''))) = 0 THEN
    RAISE EXCEPTION 'Active AI routing state is "%", expected OpenCode 9.25; refusing to change Resume Forge routes', v_state_name;
  END IF;

  SELECT COALESCE(r.provider, k.provider) AS effective_provider,
         r.ai_key_id, r.provider, r.model_override, r.is_enabled
  INTO v_primary
  FROM ai_routing_state_routes r
  LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
  WHERE r.state_id = v_state_id
    AND r.automation_id = 'application_resume_forge'
    AND r.rank = 1
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resume Forge primary route (rank 1) is missing';
  END IF;
  IF v_primary.effective_provider IS DISTINCT FROM 'opencode'
     OR lower(COALESCE(v_primary.model_override, '')) <> 'glm-5.3' THEN
    RAISE EXCEPTION 'Resume Forge rank 1 is provider %, model %; expected OpenCode / GLM 5.3. Refusing to alter fallback order.',
      v_primary.effective_provider, v_primary.model_override;
  END IF;

  SELECT COALESCE(r.provider, k.provider) AS effective_provider,
         r.ai_key_id, r.provider, r.model_override, r.reasoning_effort, r.is_enabled
  INTO v_secondary
  FROM ai_routing_state_routes r
  LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
  WHERE r.state_id = v_state_id
    AND r.automation_id = 'application_resume_forge'
    AND r.rank = 2
  FOR UPDATE OF r;
  v_secondary_found := FOUND;
  IF v_secondary_found AND v_secondary.effective_provider IS DISTINCT FROM 'opencode' THEN
    RAISE EXCEPTION 'Resume Forge rank 2 uses provider %, expected OpenCode; refusing to change credentials', v_secondary.effective_provider;
  END IF;

  SELECT COALESCE(r.provider, k.provider) AS effective_provider,
         r.ai_key_id, r.provider, r.model_override, r.reasoning_effort, r.is_enabled
  INTO v_tertiary
  FROM ai_routing_state_routes r
  LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
  WHERE r.state_id = v_state_id
    AND r.automation_id = 'application_resume_forge'
    AND r.rank = 3
  FOR UPDATE OF r;
  v_tertiary_found := FOUND;
  IF v_tertiary_found AND v_tertiary.effective_provider IS DISTINCT FROM 'opencode' THEN
    RAISE EXCEPTION 'Resume Forge rank 3 uses provider %, expected OpenCode; refusing to change credentials', v_tertiary.effective_provider;
  END IF;

  v_before := jsonb_build_object(
    'rank_1', jsonb_build_object('provider', v_primary.effective_provider, 'model', v_primary.model_override, 'enabled', v_primary.is_enabled),
    'rank_2', CASE WHEN v_secondary_found THEN jsonb_build_object('provider', v_secondary.effective_provider, 'model', v_secondary.model_override, 'enabled', v_secondary.is_enabled) ELSE NULL END,
    'rank_3', CASE WHEN v_tertiary_found THEN jsonb_build_object('provider', v_tertiary.effective_provider, 'model', v_tertiary.model_override, 'enabled', v_tertiary.is_enabled) ELSE NULL END
  );

  IF v_secondary_found THEN
    IF v_secondary.model_override IS DISTINCT FROM 'qwen3.7-plus'
       OR v_secondary.reasoning_effort IS NOT NULL OR NOT v_secondary.is_enabled THEN
      UPDATE ai_routing_state_routes
      SET model_override = 'qwen3.7-plus', reasoning_effort = NULL, is_enabled = true
      WHERE state_id = v_state_id AND automation_id = 'application_resume_forge' AND rank = 2;
      v_changed := true;
    END IF;
  ELSE
    INSERT INTO ai_routing_state_routes
      (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
    VALUES
      (v_state_id, 'application_resume_forge', 2, v_primary.ai_key_id, v_primary.provider, 'qwen3.7-plus', NULL, true);
    v_changed := true;
  END IF;

  IF v_tertiary_found THEN
    IF v_tertiary.model_override IS DISTINCT FROM 'gpt-5.6-luna'
       OR v_tertiary.reasoning_effort IS NOT NULL OR NOT v_tertiary.is_enabled THEN
      UPDATE ai_routing_state_routes
      SET model_override = 'gpt-5.6-luna', reasoning_effort = NULL, is_enabled = true
      WHERE state_id = v_state_id AND automation_id = 'application_resume_forge' AND rank = 3;
      v_changed := true;
    END IF;
  ELSE
    INSERT INTO ai_routing_state_routes
      (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
    VALUES
      (v_state_id, 'application_resume_forge', 3,
       CASE WHEN v_secondary_found THEN v_secondary.ai_key_id ELSE v_primary.ai_key_id END,
       CASE WHEN v_secondary_found THEN v_secondary.provider ELSE v_primary.provider END,
       'gpt-5.6-luna', NULL, true);
    v_changed := true;
  END IF;

  IF v_changed THEN
    INSERT INTO ai_admin_audit_log (ai_key_id, automation_id, action, metadata)
    VALUES (
      COALESCE(v_secondary.ai_key_id, v_primary.ai_key_id),
      'application_resume_forge',
      'route_changed',
      jsonb_build_object(
        'source', '107_resume_forge_fallback_order',
        'routing_state_id', v_state_id,
        'routing_state_name', v_state_name,
        'before', v_before,
        'after', jsonb_build_object(
          'rank_1', jsonb_build_object('provider', 'opencode', 'model', v_primary.model_override, 'enabled', v_primary.is_enabled),
          'rank_2', jsonb_build_object('provider', 'opencode', 'model', 'qwen3.7-plus', 'enabled', true),
          'rank_3', jsonb_build_object('provider', 'opencode', 'model', 'gpt-5.6-luna', 'enabled', true)
        )
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM ai_routing_state_routes r
    LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
    WHERE r.state_id = v_state_id
      AND r.automation_id = 'application_resume_forge'
      AND r.rank = 1 AND r.is_enabled
      AND COALESCE(r.provider, k.provider) = 'opencode'
      AND lower(COALESCE(r.model_override, '')) = 'glm-5.3'
  ) OR NOT EXISTS (
    SELECT 1 FROM ai_routing_state_routes r
    LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
    WHERE r.state_id = v_state_id
      AND r.automation_id = 'application_resume_forge'
      AND r.rank = 2 AND r.is_enabled
      AND COALESCE(r.provider, k.provider) = 'opencode'
      AND r.model_override = 'qwen3.7-plus'
  ) OR NOT EXISTS (
    SELECT 1 FROM ai_routing_state_routes r
    LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
    WHERE r.state_id = v_state_id
      AND r.automation_id = 'application_resume_forge'
      AND r.rank = 3 AND r.is_enabled
      AND COALESCE(r.provider, k.provider) = 'opencode'
      AND r.model_override = 'gpt-5.6-luna'
  ) THEN
    RAISE EXCEPTION 'Resume Forge route verification failed for expected OpenCode ranks 1-3';
  END IF;

  RAISE NOTICE 'Verified Resume Forge routes in %: GLM 5.3 -> Qwen 3.7 Plus -> GPT-5.6 Luna', v_state_name;
END $$;
