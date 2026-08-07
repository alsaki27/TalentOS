-- 053: Copilot CEO multi-agent team.
-- Seeds ai_agent_configs + ai_automation_routes rows for the 4 new
-- sub-agents so they show up in /admin/ai for key assignment and pick up
-- DB-editable system prompts (system_prompt = NULL means "use the hardcoded
-- default in the .ts prompt file until CEO/admin tunes it via a proposal" —
-- same pattern as every other agent in ai_agent_configs).
--
-- Also adds action_items.metadata for tagging copilot-created tickets with
-- structured context (domain, selector, resume_version_id) beyond what the
-- existing free-text columns capture.
--
-- copilot_domain_profiles is new: caches the Form Analyst's per-domain ATS
-- classification so it only has to run once per new domain, not on every
-- Analyze click.

-- ai_automation_routes.automation_id has a FK to ai_automations(id) — must
-- exist there first (this is the catalog table that drives /admin/ai's list).
INSERT INTO ai_automations (id, label, description, group_label, is_active)
VALUES
  ('copilot_ceo', 'Copilot CEO', 'Reviews Copilot sub-agent performance, proposes prompt upgrades, files tickets for unresolved questions', 'Application Copilot', true),
  ('copilot_form_analyst', 'Copilot Form Analyst', 'Classifies ATS platform/form structure per domain (cached)', 'Application Copilot', true),
  ('copilot_compliance', 'Copilot Compliance', 'Resolves standing-default policy fields (veteran, disability, sponsorship, relocation, rehire)', 'Application Copilot', true),
  ('copilot_correction_reviewer', 'Copilot Correction Reviewer', 'Judges whether a recorded fill-plan correction is genuine and worth replaying', 'Application Copilot', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_agent_configs (automation_id, display_name, is_active)
VALUES
  ('copilot_ceo', 'Copilot CEO', true),
  ('copilot_form_analyst', 'Copilot Form Analyst', true),
  ('copilot_compliance', 'Copilot Compliance', true),
  ('copilot_correction_reviewer', 'Copilot Correction Reviewer', true)
ON CONFLICT (automation_id) DO NOTHING;

-- provider set directly (not ai_key_id) matches the existing seeding
-- convention elsewhere in this file set (see 036/042/046) — ai_key_id-based
-- routing is wired later by hand via /admin/ai, provider-based routing works
-- immediately using whatever enabled key exists for that provider.
-- model_override pins the whole Copilot team to the cheap flash-lite model —
-- these are small classification/policy/judgment calls, not full resume
-- generation, so the cheapest capable model is the right default. Also
-- applied to the pre-existing copilot_fill_planner/copilot_question_answerer
-- routes below via UPDATE, since they predate this migration.
INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled, model_override)
VALUES
  ('copilot_ceo', 'google_vertex_proxy', 1, true, 'gemini-2.5-flash-lite'),
  ('copilot_ceo', 'google_vertex_proxy', 99, true, 'gemini-2.5-flash-lite'),
  ('copilot_form_analyst', 'google_vertex_proxy', 1, true, 'gemini-2.5-flash-lite'),
  ('copilot_form_analyst', 'google_vertex_proxy', 99, true, 'gemini-2.5-flash-lite'),
  ('copilot_compliance', 'google_vertex_proxy', 1, true, 'gemini-2.5-flash-lite'),
  ('copilot_compliance', 'google_vertex_proxy', 99, true, 'gemini-2.5-flash-lite'),
  ('copilot_correction_reviewer', 'google_vertex_proxy', 1, true, 'gemini-2.5-flash-lite'),
  ('copilot_correction_reviewer', 'google_vertex_proxy', 99, true, 'gemini-2.5-flash-lite')
ON CONFLICT (automation_id, rank) DO NOTHING;

UPDATE ai_automation_routes SET model_override = 'gemini-2.5-flash-lite'
WHERE automation_id LIKE 'copilot%';

ALTER TABLE action_items ADD COLUMN IF NOT EXISTS metadata jsonb;

CREATE TABLE IF NOT EXISTS copilot_domain_profiles (
  domain          text PRIMARY KEY,
  ats_guess       text,
  structural_notes text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Correction Reviewer's async judgment, added on top of the fast synchronous
-- string-inequality check that populates was_corrected at insert time. The
-- reviewer may downgrade a false-positive was_corrected=true after the fact.
ALTER TABLE copilot_fill_corrections
  ADD COLUMN IF NOT EXISTS ai_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_review_reason text,
  ADD COLUMN IF NOT EXISTS escalated_to_ceo boolean NOT NULL DEFAULT false;
