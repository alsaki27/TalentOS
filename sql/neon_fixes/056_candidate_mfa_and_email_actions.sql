-- Candidate MFA and Gmail write-action state.

CREATE TABLE IF NOT EXISTS candidate_mfa_settings (
  candidate_id uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  secret_encrypted text NOT NULL,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS gmail_label_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS gmail_is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS interview_details jsonb;

CREATE INDEX IF NOT EXISTS email_comm_interview_idx
  ON email_communications(candidate_id, sent_at DESC)
  WHERE ai_category IN ('interview_invite', 'scheduling');

INSERT INTO ai_automations (id, label, description, group_label) VALUES
  ('email_interview_extraction', 'Interview Detail Extraction', 'Extracts interview time, timezone, meeting link, interviewer, and response deadline from recruiting emails', 'Candidate Portal'),
  ('email_action_enrichment', 'Email Action Enrichment', 'Determines Gmail labels and urgency for recruiting emails', 'Candidate Portal')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_agent_configs (automation_id, display_name, system_prompt, prompt_version, output_schema_version, temperature, max_output_tokens, timeout_ms, max_attempts, approval_policy, minimum_score, is_active) VALUES
  ('email_interview_extraction', 'Interview Detail Extraction', 'Strict JSON extraction only. Never invent missing details.', 'EmailInterviewV1', 'EmailInterviewV1', 0.1, 768, 20000, 2, 'auto', 0, true),
  ('email_action_enrichment', 'Email Action Enrichment', 'Strict JSON classification only. Ignore marketing and job-alert noise.', 'EmailActionV1', 'EmailActionV1', 0.1, 512, 20000, 2, 'auto', 0, true)
ON CONFLICT (automation_id) DO NOTHING;

INSERT INTO ai_automation_routes (automation_id, provider, rank, model_override, is_enabled) VALUES
  ('email_interview_extraction', 'google_vertex_proxy', 1, 'gemini-2.5-flash-lite', true),
  ('email_interview_extraction', 'google', 2, 'gemini-2.5-flash-lite', true),
  ('email_action_enrichment', 'google_vertex_proxy', 1, 'gemini-2.5-flash-lite', true),
  ('email_action_enrichment', 'google', 2, 'gemini-2.5-flash-lite', true)
ON CONFLICT (automation_id, rank) DO UPDATE SET model_override = EXCLUDED.model_override, is_enabled = EXCLUDED.is_enabled;
