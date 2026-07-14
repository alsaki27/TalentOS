-- 029: Register the Falood chatbot studio's AI calls as a real automation.
--
-- src/app/api/falood/suggestions and .../extract-skills previously called
-- OpenAI directly via a raw process.env.OPENAI_API_KEY, completely outside
-- ai_automations/ai_automation_routes - invisible to the AI Control Center,
-- with no fallback when that specific OpenAI account's billing quota ran
-- out (confirmed live: insufficient_quota on every chat message). Now
-- routed through callWithUsageTracking("falood_ai", ...) like every other
-- AI feature in the app. This migration only adds the automation row; the
-- actual route (which key/model) is set via the admin UI at
-- /admin/ai -> Agents & Routing, same as every other automation - not
-- hardcoded here since key ids are environment-specific.
INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('falood_ai', 'Falood AI (Chatbot Studio)', 'Chat-driven resume suggestions and JD skill extraction in the Falood tailor studio', 'Resume Studio')
ON CONFLICT (id) DO NOTHING;
