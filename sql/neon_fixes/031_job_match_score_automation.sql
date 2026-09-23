-- 031: Register the Jobs page "Gen Score" match-scoring call as a real automation.
--
-- src/app/api/jobs/match-score previously called OpenAI directly via a raw
-- process.env.OPENAI_API_KEY (new OpenAI({apiKey: ...})), completely outside
-- ai_automations/ai_automation_routes - same anti-pattern as falood_ai
-- (migration 029) and with the same symptom: confirmed live, every "Gen
-- Score" click on the Jobs page failed with "429 You exceeded your current
-- quota" from that specific OpenAI account. Now routed through
-- callWithUsageTracking("job_match_score", ...) like every other AI feature.
-- This migration only adds the automation row; the actual route (which
-- key/model) is set via the admin UI at /admin/ai -> Agents & Routing.
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('job_match_score', 'Job Match Score (Jobs page "Gen Score")', 'Scores a candidate''s base resume against a job description for the Jobs masterlist match-score column', 'Matching')
ON CONFLICT (id) DO NOTHING;
