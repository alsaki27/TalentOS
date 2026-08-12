-- OPENCODE MAIN 8.12 is a prepared routing plan only.
-- It intentionally does not modify ai_automation_routes, provider keys, or the
-- runtime resolver. The state can be reviewed in the AI Control Center and
-- manually activated later through an explicit state-aware rollout.

ALTER TABLE ai_routing_state_routes
  ADD COLUMN IF NOT EXISTS reasoning_effort text
  CHECK (reasoning_effort IS NULL OR reasoning_effort IN ('off', 'low', 'medium', 'high', 'xhigh', 'max'));

DO $$
DECLARE
  v_state_id uuid;
BEGIN
  INSERT INTO ai_routing_states (name, description, status)
  VALUES (
    'OPENCODE MAIN 8.12',
    'Prepared OpenCode Go routing plan: DeepSeek V4/Luna primaries with explicit reasoning levels and Gemini 2.5 Pro/Flash fallbacks. Draft only; live routing remains Gemini Regular 8.12.',
    'draft'
  )
  ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        updated_at = now();

  SELECT id INTO v_state_id FROM ai_routing_states WHERE name = 'OPENCODE MAIN 8.12';

  WITH plan AS (
    SELECT
      a.id AS automation_id,
      CASE a.id
        WHEN 'application_job_lens' THEN 'deepseek-v4-pro'
        WHEN 'application_resume_forge' THEN 'gpt-5.6-luna'
        WHEN 'application_hiring_panel' THEN 'deepseek-v4-pro'
        WHEN 'application_final_polish' THEN 'gpt-5.6-luna'
        WHEN 'job_ceo_orchestrator' THEN 'deepseek-v4-pro'
        WHEN 'job_ceo_scout' THEN 'deepseek-v4-flash'
        WHEN 'job_ceo_qa' THEN 'deepseek-v4-flash'
        WHEN 'job_ceo_deep_fetch' THEN 'deepseek-v4-flash'
        WHEN 'job_ceo_enricher' THEN 'deepseek-v4-flash'
        WHEN 'job_ceo_matchmaker' THEN 'deepseek-v4-pro'
        WHEN 'copilot_fill_planner' THEN 'deepseek-v4-pro'
        WHEN 'copilot_question_answerer' THEN 'gpt-5.6-luna'
        WHEN 'copilot_ceo' THEN 'deepseek-v4-pro'
        WHEN 'copilot_form_analyst' THEN 'deepseek-v4-flash'
        WHEN 'copilot_compliance' THEN 'deepseek-v4-flash'
        WHEN 'copilot_correction_reviewer' THEN 'deepseek-v4-flash'
        WHEN 'copilot_cover_letter' THEN 'gpt-5.6-luna'
        WHEN 'resume_parsing' THEN 'deepseek-v4-flash'
        WHEN 'candidate_markitdown' THEN 'deepseek-v4-flash'
        WHEN 'jd_analysis' THEN 'deepseek-v4-pro'
        WHEN 'job_categorization' THEN 'deepseek-v4-flash'
        WHEN 'keyword_extraction' THEN 'deepseek-v4-flash'
        WHEN 'evidence_mapping' THEN 'deepseek-v4-pro'
        WHEN 'target_jobs_matching' THEN 'deepseek-v4-pro'
        WHEN 'base_resume_studio' THEN 'gpt-5.6-luna'
        WHEN 'application_tailoring' THEN 'gpt-5.6-luna'
        WHEN 'resume_suggestions' THEN 'deepseek-v4-pro'
        WHEN 'cover_letter_gen' THEN 'gpt-5.6-luna'
        WHEN 'recruiter_message_gen' THEN 'gpt-5.6-luna'
        WHEN 'ai_digest' THEN 'deepseek-v4-flash'
        WHEN 'chat_assistant' THEN 'gpt-5.6-luna'
        WHEN 'falood_ai' THEN 'gpt-5.6-luna'
        WHEN 'job_match_score' THEN 'deepseek-v4-pro'
        WHEN 'ats_scoring' THEN 'deepseek-v4-pro'
        WHEN 'job_autofill' THEN 'deepseek-v4-flash'
        WHEN 'job_ai_analyze' THEN 'deepseek-v4-flash'
        WHEN 'BaseResume_TO_JobSearchKeyword' THEN 'deepseek-v4-pro'
        WHEN 'email_triage' THEN 'deepseek-v4-flash'
        WHEN 'email_interview_extraction' THEN 'deepseek-v4-flash'
        WHEN 'email_action_enrichment' THEN 'deepseek-v4-flash'
        WHEN 'email_reply_draft' THEN 'deepseek-v4-flash'
        ELSE 'deepseek-v4-flash'
      END AS opencode_model,
      CASE a.id
        WHEN 'application_hiring_panel' THEN 'max'
        WHEN 'application_job_lens' THEN 'high'
        WHEN 'application_resume_forge' THEN 'high'
        WHEN 'application_final_polish' THEN 'high'
        WHEN 'job_ceo_orchestrator' THEN 'high'
        WHEN 'job_ceo_matchmaker' THEN 'high'
        WHEN 'copilot_fill_planner' THEN 'low'
        WHEN 'copilot_question_answerer' THEN 'medium'
        WHEN 'copilot_ceo' THEN 'high'
        WHEN 'copilot_cover_letter' THEN 'medium'
        WHEN 'jd_analysis' THEN 'high'
        WHEN 'evidence_mapping' THEN 'high'
        WHEN 'target_jobs_matching' THEN 'high'
        WHEN 'base_resume_studio' THEN 'medium'
        WHEN 'application_tailoring' THEN 'high'
        WHEN 'resume_suggestions' THEN 'high'
        WHEN 'cover_letter_gen' THEN 'medium'
        WHEN 'recruiter_message_gen' THEN 'low'
        WHEN 'chat_assistant' THEN 'medium'
        WHEN 'falood_ai' THEN 'medium'
        WHEN 'job_match_score' THEN 'high'
        WHEN 'ats_scoring' THEN 'high'
        WHEN 'BaseResume_TO_JobSearchKeyword' THEN 'high'
        WHEN 'keyword_extraction' THEN 'low'
        WHEN 'candidate_markitdown' THEN 'low'
        WHEN 'resume_parsing' THEN 'low'
        WHEN 'job_ceo_scout' THEN 'low'
        WHEN 'job_ceo_deep_fetch' THEN 'low'
        WHEN 'job_ceo_enricher' THEN 'low'
        WHEN 'job_ceo_qa' THEN 'off'
        WHEN 'copilot_form_analyst' THEN 'low'
        WHEN 'copilot_compliance' THEN 'low'
        WHEN 'copilot_correction_reviewer' THEN 'low'
        WHEN 'email_triage' THEN 'off'
        WHEN 'email_action_enrichment' THEN 'off'
        ELSE 'low'
      END AS reasoning_effort,
      CASE a.id
        WHEN 'application_job_lens' THEN 'gemini-2.5-pro'
        WHEN 'application_resume_forge' THEN 'gemini-2.5-pro'
        WHEN 'application_hiring_panel' THEN 'gemini-2.5-pro'
        WHEN 'application_final_polish' THEN 'gemini-2.5-pro'
        WHEN 'job_ceo_orchestrator' THEN 'gemini-2.5-pro'
        WHEN 'job_ceo_matchmaker' THEN 'gemini-2.5-pro'
        WHEN 'copilot_fill_planner' THEN 'gemini-2.5-flash'
        WHEN 'copilot_question_answerer' THEN 'gemini-2.5-pro'
        WHEN 'copilot_ceo' THEN 'gemini-2.5-pro'
        WHEN 'copilot_cover_letter' THEN 'gemini-2.5-pro'
        WHEN 'jd_analysis' THEN 'gemini-2.5-pro'
        WHEN 'evidence_mapping' THEN 'gemini-2.5-pro'
        WHEN 'target_jobs_matching' THEN 'gemini-2.5-pro'
        WHEN 'base_resume_studio' THEN 'gemini-2.5-pro'
        WHEN 'application_tailoring' THEN 'gemini-2.5-pro'
        WHEN 'resume_suggestions' THEN 'gemini-2.5-pro'
        WHEN 'cover_letter_gen' THEN 'gemini-2.5-pro'
        WHEN 'recruiter_message_gen' THEN 'gemini-2.5-flash'
        WHEN 'chat_assistant' THEN 'gemini-2.5-pro'
        WHEN 'falood_ai' THEN 'gemini-2.5-pro'
        WHEN 'job_match_score' THEN 'gemini-2.5-pro'
        WHEN 'ats_scoring' THEN 'gemini-2.5-pro'
        WHEN 'BaseResume_TO_JobSearchKeyword' THEN 'gemini-2.5-pro'
        ELSE 'gemini-2.5-flash'
      END AS gemini_first
    FROM ai_automations a
    WHERE a.is_active = true
  ), routes AS (
    SELECT automation_id, 1 AS rank, 'opencode'::text AS provider,
           opencode_model AS model_override, reasoning_effort
    FROM plan
    UNION ALL
    SELECT automation_id, 2, 'google_vertex_proxy', gemini_first, NULL
    FROM plan
    UNION ALL
    SELECT automation_id, 3, 'google_vertex_proxy',
           CASE WHEN gemini_first = 'gemini-2.5-pro' THEN 'gemini-2.5-flash' ELSE 'gemini-2.5-pro' END,
           NULL
    FROM plan
  )
  INSERT INTO ai_routing_state_routes
    (state_id, automation_id, rank, ai_key_id, provider, model_override, reasoning_effort, is_enabled)
  SELECT v_state_id, automation_id, rank, NULL, provider, model_override, reasoning_effort, true
  FROM routes
  ON CONFLICT (state_id, automation_id, rank) DO NOTHING;
END $$;
