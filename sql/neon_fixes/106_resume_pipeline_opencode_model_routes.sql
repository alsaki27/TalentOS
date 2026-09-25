-- Set the active OpenCode 9.25 resume-pipeline lanes:
--   Resume Forge: GLM 5.3 -> GPT-5.6 Luna
--   Hiring Panel: Qwen 3.7 Plus -> GLM 5.3
--   Final Polish: Qwen 3.7 Plus -> GLM 5.3
-- Existing credentials are retained. Ranks > 2 are retained as emergency fallbacks.
DO $$
DECLARE
  v_state_id uuid;
  v_state_name text;
  v_automation record;
  v_primary record;
  v_fallback record;
  v_primary_found boolean;
  v_fallback_found boolean;
  v_primary_changed boolean;
  v_fallback_changed boolean;
  v_any_changed boolean;
  v_old_primary_model text;
  v_old_fallback_model text;
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
    RAISE EXCEPTION 'Active AI routing state is "%", expected the OpenCode 9.25 state; refusing to change routes', v_state_name;
  END IF;

  FOR v_automation IN
    SELECT * FROM (VALUES
      ('application_resume_forge'::text, 'glm-5.3'::text, 'gpt-5.6-luna'::text),
      ('application_hiring_panel'::text, 'qwen3.7-plus'::text, 'glm-5.3'::text),
      ('application_final_polish'::text, 'qwen3.7-plus'::text, 'glm-5.3'::text)
    ) AS desired(automation_id, primary_model, fallback_model)
  LOOP
    SELECT COALESCE(r.provider, k.provider) AS effective_provider,
           r.provider, r.ai_key_id, r.model_override, r.reasoning_effort, r.is_enabled
    INTO v_primary
    FROM ai_routing_state_routes r
    LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
    WHERE r.state_id = v_state_id
      AND r.automation_id = v_automation.automation_id
      AND r.rank = 1
    FOR UPDATE OF r;
    v_primary_found := FOUND;
    IF NOT v_primary_found THEN
      RAISE EXCEPTION 'Active route missing for % rank 1', v_automation.automation_id;
    END IF;
    IF v_primary.effective_provider IS DISTINCT FROM 'opencode' THEN
      RAISE EXCEPTION 'Active route for % rank 1 uses %, expected opencode', v_automation.automation_id, v_primary.effective_provider;
    END IF;

    SELECT COALESCE(r.provider, k.provider) AS effective_provider,
           r.provider, r.ai_key_id, r.model_override, r.reasoning_effort, r.is_enabled
    INTO v_fallback
    FROM ai_routing_state_routes r
    LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
    WHERE r.state_id = v_state_id
      AND r.automation_id = v_automation.automation_id
      AND r.rank = 2
    FOR UPDATE OF r;
    v_fallback_found := FOUND;
    IF v_fallback_found AND v_fallback.effective_provider IS DISTINCT FROM 'opencode' THEN
      RAISE EXCEPTION 'Active route for % rank 2 uses %, expected opencode', v_automation.automation_id, v_fallback.effective_provider;
    END IF;

    v_old_primary_model := v_primary.model_override;
    v_old_fallback_model := CASE WHEN v_fallback_found THEN v_fallback.model_override ELSE NULL END;
    v_primary_changed := v_primary.model_override IS DISTINCT FROM v_automation.primary_model
      OR v_primary.reasoning_effort IS NOT NULL OR NOT v_primary.is_enabled;
    IF v_fallback_found THEN
      v_fallback_changed := v_fallback.model_override IS DISTINCT FROM v_automation.fallback_model
        OR v_fallback.reasoning_effort IS NOT NULL
        OR NOT v_fallback.is_enabled;
    ELSE
      v_fallback_changed := true;
    END IF;

    IF v_primary_changed THEN
      UPDATE ai_routing_state_routes
      SET model_override = v_automation.primary_model,
          reasoning_effort = NULL,
          is_enabled = true
      WHERE state_id = v_state_id
        AND automation_id = v_automation.automation_id
        AND rank = 1;
    END IF;

    IF v_fallback_found THEN
      IF v_fallback_changed THEN
        UPDATE ai_routing_state_routes
        SET model_override = v_automation.fallback_model,
            reasoning_effort = NULL,
            is_enabled = true
        WHERE state_id = v_state_id
          AND automation_id = v_automation.automation_id
          AND rank = 2;
      END IF;
    ELSE
      INSERT INTO ai_routing_state_routes
        (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
      VALUES
        (v_state_id, v_automation.automation_id, 2, v_primary.ai_key_id, v_primary.provider,
         v_automation.fallback_model, NULL, true);
    END IF;

    -- Do not mutate ai_automation_routes here: the active-state resolver uses
    -- this state's rows whenever present, and legacy rows may intentionally
    -- belong to a different provider setup.
    v_any_changed := v_primary_changed OR v_fallback_changed;
    IF v_any_changed THEN
      INSERT INTO ai_admin_audit_log (ai_key_id, automation_id, action, metadata)
      VALUES (
        v_primary.ai_key_id,
        v_automation.automation_id,
        'route_changed',
        jsonb_build_object(
          'source', '106_resume_pipeline_opencode_model_routes',
          'routing_state_id', v_state_id,
          'routing_state_name', v_state_name,
          'provider', 'opencode',
          'before', jsonb_build_object('rank_1', v_old_primary_model, 'rank_2', v_old_fallback_model),
          'after', jsonb_build_object('rank_1', v_automation.primary_model, 'rank_2', v_automation.fallback_model)
        )
      );
    END IF;
  END LOOP;
END $$;
