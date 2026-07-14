-- 032: Register three more AI features that bypassed the routing system.
--
-- Same anti-pattern as falood_ai (029) and job_match_score (031): these
-- called `new OpenAI(...)` directly against a hardcoded, quota-exhausted
-- OPENAI_API_KEY, invisible to the AI Control Center and with no fallback.
-- Confirmed live: ATS Score Analysis 500'd on every run, and Jobs page
-- AI-autofill / per-job AI-analyze would have failed the same way.
-- This migration only adds the automation rows; the actual routes (which
-- key/model) are set via the admin UI at /admin/ai -> Agents & Routing.
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('ats_scoring', 'ATS Score Analysis', 'Structured extraction + narrative feedback for the ATS Score Analysis page', 'Matching'),
  ('job_autofill_form', 'Job Autofill (paste-to-form)', 'Extracts title/company/location/description from pasted job posting text', 'Jobs'),
  ('job_ai_analyze', 'Job AI Analyze', 'Extracts employment type, experience, skills, and summary from a job description', 'Jobs')
ON CONFLICT (id) DO NOTHING;
