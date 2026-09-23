-- 036: Fix automation IDs and insert missing routes
--
-- The codebase uses 'ats_extraction', 'ats_narrative', and 'job_autofill' 
-- but previous migrations seeded 'ats_scoring' and 'job_autofill_form'.
-- This migration ensures the correct code-side IDs exist in ai_automations 
-- and adds default fallback routes for them to the google_vertex_proxy key.

-- 1. Ensure the correct IDs exist in ai_automations
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('ats_extraction', 'ATS Extraction', 'ATS Score Data Extraction', 'Matching'),
  ('ats_narrative', 'ATS Narrative', 'ATS Score Narrative Generation', 'Matching'),
  ('job_autofill', 'Job Autofill', 'Autofill from pasted text', 'Jobs')
ON CONFLICT (id) DO NOTHING;

-- 2. Ensure default routes exist for these newly added automations
INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled) VALUES
  ('ats_extraction', 'google_vertex_proxy', 1, true),
  ('ats_narrative', 'google_vertex_proxy', 1, true),
  ('job_autofill', 'google_vertex_proxy', 1, true)
ON CONFLICT (automation_id, rank) DO UPDATE 
  SET provider = EXCLUDED.provider 
  WHERE ai_automation_routes.provider IS NULL AND ai_automation_routes.ai_key_id IS NULL;

-- 3. Catch-all: Ensure ALL automations in the system have the default proxy as a fallback.
-- We insert it at rank 99. If the user configured a primary key (rank 1) and it fails
-- (e.g. quota exhausted), it will gracefully fall back to the proxy instead of crashing.
INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled)
SELECT id, 'google_vertex_proxy', 99, true
FROM ai_automations
ON CONFLICT (automation_id, rank) DO UPDATE
  SET provider = EXCLUDED.provider
  WHERE ai_automation_routes.provider IS NULL AND ai_automation_routes.ai_key_id IS NULL;

