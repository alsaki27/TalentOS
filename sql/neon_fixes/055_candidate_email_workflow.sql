-- Candidate email workflow state. This keeps AI observations separate from
-- human resolution while making every task auditable and idempotent.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS skarion_enrolled_at date;

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS resolution_rule text NOT NULL DEFAULT 'manual_or_thread_reply',
  ADD COLUMN IF NOT EXISTS resolution_kind text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_by_email_communication_id uuid REFERENCES email_communications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS taken_over_at timestamptz,
  ADD COLUMN IF NOT EXISTS taken_over_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

ALTER TABLE action_items
  DROP CONSTRAINT IF EXISTS action_items_resolution_rule_check;
ALTER TABLE action_items
  ADD CONSTRAINT action_items_resolution_rule_check
  CHECK (resolution_rule IN ('manual_or_thread_reply', 'manual_only', 'informational'));

ALTER TABLE action_items
  DROP CONSTRAINT IF EXISTS action_items_resolution_kind_check;
ALTER TABLE action_items
  ADD CONSTRAINT action_items_resolution_kind_check
  CHECK (resolution_kind IS NULL OR resolution_kind IN ('outbound_thread_reply', 'manual_takeover', 'manual_resolution', 'dismissed', 'informational'));

CREATE UNIQUE INDEX IF NOT EXISTS action_items_dedupe_key_unique
  ON action_items(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE application_comments
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS email_communication_id uuid REFERENCES email_communications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric(5,4);

ALTER TABLE application_comments
  DROP CONSTRAINT IF EXISTS application_comments_source_type_check;
ALTER TABLE application_comments
  ADD CONSTRAINT application_comments_source_type_check
  CHECK (source_type IN ('manual', 'email_ai'));

CREATE UNIQUE INDEX IF NOT EXISTS application_comments_email_source_unique
  ON application_comments(email_communication_id)
  WHERE email_communication_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS action_items_candidate_status_priority_idx
  ON action_items(candidate_id, status, priority, created_at DESC);
