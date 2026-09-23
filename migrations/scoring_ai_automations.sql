-- AI Control Center — new automation IDs
-- Run against the Neon database. All statements are idempotent.
-- Use INSERT ... ON CONFLICT to avoid errors on re-run.

-- ═══════════════════════════════════════════════════
-- 1. Insert new ai_automations rows
-- ═══════════════════════════════════════════════════
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('job_match_score',   'Job Match Score',       'Generate a candidate-job fit score',              'Scoring & Analysis'),
  ('ats_extraction',    'ATS Data Extraction',    'Extract structured skills/experience from resume','Scoring & Analysis'),
  ('ats_narrative',     'ATS Narrative',          'Generate ATS strengths and suggestions',          'Scoring & Analysis'),
  ('job_autofill',      'Job Form Autofill',      'Auto-populate job form fields from raw text',     'Parsing & Extraction'),
  ('job_categorization', 'Job Categorization',    'Auto-categorize imported jobs',                   'Parsing & Extraction')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════
-- 2. Seed default ai_agent_configs rows
--    Each config is editable from /admin/ai → Agents & Routing → click agent → Agent tab.
--    Model selection is done via the Routes tab (ai_automation_routes).
-- ═══════════════════════════════════════════════════
INSERT INTO ai_agent_configs (
  automation_id, display_name, system_prompt, prompt_version,
  temperature, max_output_tokens, timeout_ms, max_attempts,
  approval_policy, minimum_score, is_active
) VALUES
  (
    'job_match_score',
    'Job Match Scorer',
    'You are an unbiased, expert technical recruiter evaluating a candidate''s fit for a job. Reply with valid JSON only, no markdown, no explanation.',
    '1',
    0.1, 2048, 30000, 2,
    'auto', 0, true
  ),
  (
    'ats_extraction',
    'ATS Structured Extractor',
    'You are an expert ATS extraction parser. Extract structured facts from resume text. Do NOT hallucinate. Reply with valid JSON only.',
    '1',
    0.0, 4096, 60000, 2,
    'auto', 0, true
  ),
  (
    'ats_narrative',
    'ATS Narrative Generator',
    'You are an expert ATS feedback generator. Based ONLY on provided data, generate strengths, missing keywords, and suggestions. Reply with valid JSON only.',
    '1',
    0.0, 2048, 30000, 2,
    'auto', 0, true
  ),
  (
    'job_autofill',
    'Job Form Autofill',
    'You are an expert HR AI assistant. Extract job posting details. Reply with valid JSON only, no markdown, no explanation.',
    '1',
    0.0, 2048, 30000, 2,
    'auto', 0, true
  ),
  (
    'job_categorization',
    'Job Agent Classifier',
    'You are a strict, literal job-posting classifier. Respond with raw JSON only.',
    '1',
    0.2, 2048, 30000, 2,
    'auto', 0, true
  )
ON CONFLICT (automation_id) DO NOTHING;
