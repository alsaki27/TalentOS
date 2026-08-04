-- 044: Clear stale ai_key_id on the resume-pipeline (and other) routes that
-- 042_agent_model_overrides.sql assigned to google_vertex_proxy.
--
-- Bug: routing.ts's getProviderForAutomation() checks route.ai_key_id FIRST
-- and, if set, builds the provider entirely from that DB-stored key (its
-- own provider + decrypted credential) -- route.provider and
-- model_override are never even read in that branch. 042 set provider and
-- model_override on rank=1 routes but never cleared ai_key_id, so any
-- automation that already had a DB-key-based route before this session
-- kept silently using that old key instead of the new Vertex gateway.
-- Confirmed live: resume-tailoring agents failing with what looked like a
-- credential error, while the 4 GOOGLE_VERTEX_* secrets were verified
-- present on the deployed Worker the whole time.
--
-- 036_fix_automation_ids_and_routes.sql got this right for its own inserts
-- (WHERE ai_key_id IS NULL guard) -- this migration is the missed case for
-- every automation 042 touched.

UPDATE ai_automation_routes
SET ai_key_id = NULL
WHERE rank = 1
  AND provider = 'google_vertex_proxy'
  AND automation_id IN (
    'job_ceo_orchestrator', 'job_ceo_matchmaker', 'application_resume_forge',
    'application_hiring_panel', 'application_final_polish', 'base_resume_studio',
    'chat_assistant', 'application_tailoring',
    'job_ceo_scout', 'job_ceo_qa', 'job_ceo_deep_fetch', 'job_ceo_enricher',
    'application_job_lens', 'copilot_fill_planner', 'copilot_question_answerer',
    'resume_suggestions', 'jd_analysis', 'resume_parsing', 'candidate_markitdown',
    'job_categorization', 'keyword_extraction', 'evidence_mapping',
    'target_jobs_matching', 'job_match_score', 'job_autofill', 'ats_extraction',
    'ats_narrative', 'cover_letter_gen', 'recruiter_message_gen', 'ai_digest'
  );
