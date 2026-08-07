-- Candidate workflow controls, AE SLAs, drafts, and auditable automation events.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS email_sync_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_retention_days integer NOT NULL DEFAULT 365;

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS action_items_due_idx
  ON action_items(status, due_at, priority)
  WHERE status IN ('open', 'in_progress');

CREATE TABLE IF NOT EXISTS candidate_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  action_item_id uuid REFERENCES action_items(id) ON DELETE SET NULL,
  email_communication_id uuid REFERENCES email_communications(id) ON DELETE SET NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'discarded')),
  ai_confidence numeric(5,4),
  created_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_email_drafts_action_idx ON candidate_email_drafts(action_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS candidate_workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  action_item_id uuid REFERENCES action_items(id) ON DELETE SET NULL,
  email_communication_id uuid REFERENCES email_communications(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('candidate', 'ae', 'ai', 'system')),
  actor_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_workflow_events_candidate_idx ON candidate_workflow_events(candidate_id, created_at DESC);

INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('email_reply_draft', 'Recruiter Reply Draft', 'Creates a reviewable recruiter reply draft from a recruiting email and application context', 'Candidate Portal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_agent_configs (automation_id, display_name, system_prompt, prompt_version, output_schema_version, temperature, max_output_tokens, timeout_ms, max_attempts, approval_policy, minimum_score, is_active) VALUES
  ('email_reply_draft', 'Recruiter Reply Draft', 'Draft only. Never claim facts not present in the source email or candidate profile. Never send automatically.', 'EmailReplyDraftV1', 'EmailReplyDraftV1', 0.2, 1200, 20000, 2, 'always_human', 0, true)
ON CONFLICT (automation_id) DO NOTHING;

INSERT INTO ai_automation_routes (automation_id, provider, rank, model_override, is_enabled) VALUES
  ('email_reply_draft', 'google_vertex_proxy', 1, 'gemini-2.5-flash-lite', true),
  ('email_reply_draft', 'google', 2, 'gemini-2.5-flash-lite', true)
ON CONFLICT (automation_id, rank) DO UPDATE SET model_override = EXCLUDED.model_override, is_enabled = EXCLUDED.is_enabled;
