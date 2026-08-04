-- 042: Assign a right-sized Vertex model to every agent instead of the
-- previous ad-hoc mix of gemini-2.5-pro / gemini-2.5-flash-lite.
--
-- Two tiers only (per product decision - no middle tier):
--   cheap:     gemini-3.5-flash-lite  ($0.3/M in, $2.5/M out)  - simple
--              extraction/classification/single-shot agents, including
--              several that are high-volume (cron-driven QA, categorization).
--   reasoning: gemini-2.5-pro         ($1.25/M in, $10/M out) - judgment-
--              heavy or candidate/user-facing quality gates. Chosen over
--              gemini-3.1-pro-preview, which is more expensive per token
--              for materially the same reasoning quality on these tasks.
--
-- This sets model_override on each automation's rank-1 route to
-- google_vertex_proxy, upgrading/creating that row as needed. The rank-99
-- catch-all fallback from 036_fix_automation_ids_and_routes.sql is left
-- alone (no model_override -> falls back to the GOOGLE_VERTEX_MODEL env
-- default) as a safety net if a specific model ever gets deprecated.

-- ai_automation_routes.automation_id has a FK into ai_automations - these
-- two copilot automations are real call sites (getProviderForAutomation()
-- in src/app/api/extension/v1/copilot/{fill-plan,answer-question}/route.ts)
-- but were never seeded, so the FK would reject their routes below without this.
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('copilot_fill_planner', 'Copilot Fill Planner', 'Plans autofill values for browser-extension form fields', 'Copilot'),
  ('copilot_question_answerer', 'Copilot Question Answerer', 'Answers free-text custom application questions in the extension', 'Copilot')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled, model_override)
VALUES
  -- Reasoning tier (gemini-2.5-pro)
  ('job_ceo_orchestrator',      'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('job_ceo_matchmaker',        'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('application_resume_forge',  'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('application_hiring_panel',  'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('application_final_polish',  'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('base_resume_studio',        'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('chat_assistant',            'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),
  ('application_tailoring',     'google_vertex_proxy', 1, true, 'gemini-2.5-pro'),

  -- Cheap tier (gemini-3.5-flash-lite)
  ('job_ceo_scout',             'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('job_ceo_qa',                'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('job_ceo_deep_fetch',        'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('job_ceo_enricher',          'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('application_job_lens',      'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('copilot_fill_planner',      'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('copilot_question_answerer', 'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('falood_ai',                 'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('resume_suggestions',        'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('jd_analysis',               'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('resume_parsing',            'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('candidate_markitdown',      'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('job_categorization',        'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('keyword_extraction',        'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('evidence_mapping',          'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('target_jobs_matching',      'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('job_match_score',           'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('job_autofill',              'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('ats_extraction',            'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('ats_narrative',             'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('cover_letter_gen',          'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('recruiter_message_gen',     'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite'),
  ('ai_digest',                 'google_vertex_proxy', 1, true, 'gemini-3.5-flash-lite')
ON CONFLICT (automation_id, rank) DO UPDATE
  SET provider = EXCLUDED.provider,
      is_enabled = true,
      model_override = EXCLUDED.model_override;
