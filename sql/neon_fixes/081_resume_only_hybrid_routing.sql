-- Correct the 8.13 routing plan.
--
-- The original 8.13 snapshot assigned the OpenCode key to every active
-- automation. Resume work is intentionally the only OpenCode/Luna lane:
--   * complex resume pipeline (Job Lens, Resume Forge, Hiring Panel):
--     OpenCode Luna/high -> Vertex Gemini 2.5 Pro
--   * lighter resume stages (Final Polish, Application Tailoring):
--     OpenCode Luna/high -> Vertex Gemini 2.5 Flash Lite
--   * every other automation: Vertex Gemini 2.5 Flash Lite only
--
-- This is idempotent and also repairs the legacy live route table so a
-- temporary runtime fallback cannot silently reintroduce OpenCode globally.
DO $$
DECLARE
  v_state_id uuid;
  v_opencode_key uuid;
  v_vertex_key uuid;
BEGIN
  SELECT id INTO v_state_id
  FROM ai_routing_states
  WHERE name = 'NEON HYBRID 8.13'
  LIMIT 1;

  SELECT id INTO v_opencode_key
  FROM ai_api_keys
  WHERE provider = 'opencode' AND is_enabled = true
  ORDER BY priority, created_at
  LIMIT 1;

  SELECT id INTO v_vertex_key
  FROM ai_api_keys
  WHERE provider = 'google_vertex_proxy' AND is_enabled = true
  ORDER BY priority, created_at
  LIMIT 1;

  IF v_state_id IS NULL OR v_opencode_key IS NULL OR v_vertex_key IS NULL THEN
    RAISE NOTICE 'Skipping 081: routing state or required provider key is missing';
    RETURN;
  END IF;

  DELETE FROM ai_routing_state_routes WHERE state_id = v_state_id;

  -- Every active automation gets the cheap Vertex lane by default.
  INSERT INTO ai_routing_state_routes
    (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
  SELECT v_state_id, a.id, 1, v_vertex_key, NULL, 'gemini-2.5-flash-lite', NULL, true
  FROM ai_automations a
  WHERE a.is_active = true;

  -- The five resume-oriented stages use OpenCode Luna as primary. The
  -- three reasoning-heavy stages fall back to Gemini Pro; the two lighter
  -- stages fall back to Flash Lite.
  UPDATE ai_routing_state_routes
  SET ai_key_id = v_opencode_key,
      provider = NULL,
      model_override = 'gpt-5.6-luna',
      reasoning_effort = 'high',
      is_enabled = true
  WHERE state_id = v_state_id
    AND rank = 1
    AND automation_id IN (
      'application_job_lens',
      'application_resume_forge',
      'application_hiring_panel',
      'application_final_polish',
      'application_tailoring'
    );

  UPDATE ai_routing_state_routes
  SET ai_key_id = v_vertex_key,
      provider = NULL,
      model_override = CASE WHEN automation_id IN ('application_job_lens', 'application_resume_forge', 'application_hiring_panel')
                            THEN 'gemini-2.5-pro' ELSE 'gemini-2.5-flash-lite' END,
      reasoning_effort = NULL,
      is_enabled = true
  WHERE state_id = v_state_id
    AND rank = 2
    AND automation_id IN (
      'application_job_lens',
      'application_resume_forge',
      'application_hiring_panel',
      'application_final_polish',
      'application_tailoring'
    );

  INSERT INTO ai_routing_state_routes
    (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
  SELECT v_state_id, a.id, 2, v_vertex_key, NULL,
         CASE WHEN a.id IN ('application_job_lens', 'application_resume_forge', 'application_hiring_panel')
              THEN 'gemini-2.5-pro' ELSE 'gemini-2.5-flash-lite' END,
         NULL, true
  FROM ai_automations a
  WHERE a.id IN (
    'application_job_lens',
    'application_resume_forge',
    'application_hiring_panel',
    'application_final_polish',
    'application_tailoring'
  ) AND a.is_active = true;

  DELETE FROM ai_routing_state_routes
  WHERE state_id = v_state_id
    AND automation_id IN (
      'application_job_lens',
      'application_resume_forge',
      'application_hiring_panel',
      'application_final_polish',
      'application_tailoring'
    )
    AND rank > 2;

  -- Match the legacy table to the active state, using the same 1-based rank
  -- convention. This keeps diagnostics and fail-open behavior truthful.
  DELETE FROM ai_automation_routes
  WHERE automation_id IN (SELECT id FROM ai_automations WHERE is_active = true);

  INSERT INTO ai_automation_routes
    (automation_id, rank, ai_key_id, provider, model_override, is_enabled, updated_at)
  SELECT automation_id, rank, ai_key_id, provider, model_override, is_enabled, now()
  FROM ai_routing_state_routes
  WHERE state_id = v_state_id;

  UPDATE ai_routing_states
  SET description = 'Resume pipeline: OpenCode Luna/high primary; Gemini 2.5 Pro or Flash Lite fallback. All other agents: Gemini 2.5 Flash Lite.',
      updated_at = now()
  WHERE id = v_state_id;
END $$;
