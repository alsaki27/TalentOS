-- Control-center operating layer: SLAs, AI evidence, contact intelligence.
ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS response_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS workflow_state text NOT NULL DEFAULT 'observed';

ALTER TABLE email_communications DROP CONSTRAINT IF EXISTS email_communications_workflow_state_check;
ALTER TABLE email_communications ADD CONSTRAINT email_communications_workflow_state_check
  CHECK (workflow_state IN ('observed','needs_action','owned','resolved','suppressed'));

CREATE INDEX IF NOT EXISTS email_comm_response_sla_idx
  ON email_communications (response_due_at, needs_reply, replied_at)
  WHERE needs_reply = true AND replied_at IS NULL;

CREATE TABLE IF NOT EXISTS gmail_contact_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  contact_type text NOT NULL DEFAULT 'unknown' CHECK (contact_type IN ('recruiter','hiring_manager','coordinator','employer_system','unknown')),
  company text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  inbound_count integer NOT NULL DEFAULT 0,
  outbound_count integer NOT NULL DEFAULT 0,
  last_subject text,
  notes text,
  UNIQUE(candidate_id, email)
);
CREATE INDEX IF NOT EXISTS gmail_contact_candidate_idx ON gmail_contact_profiles(candidate_id, last_seen_at DESC);
