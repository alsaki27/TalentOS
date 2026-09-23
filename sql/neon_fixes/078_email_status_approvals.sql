-- 078: Email-derived application-status approval proposals + filter audit.
--
-- IDEMPOTENT DDL ONLY. deploy.yml's "Run Neon schema fixes" step re-runs
-- every file in sql/neon_fixes/ on every deploy, unconditionally, with no
-- applied-migrations ledger - the exact mechanism that caused the
-- recurring-Bhaskar-resume bug (see 061_seed_bhaskar_cad_mechanical_base_resumes.sql).
-- Never put a one-time data seed/UPDATE in this directory - only ADD COLUMN
-- IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / constraint drop-then-add,
-- which are safe to replay forever.
--
-- Renumbered from an original 075: commit 632115f (pulled 2026-08-13, same
-- day as this migration was written) claimed 075-077 for an unrelated
-- AI-routing-states feature before this one landed. Current tip was 077.

ALTER TABLE action_items
  ADD COLUMN IF NOT EXISTS proposed_status text,
  ADD COLUMN IF NOT EXISTS proposed_from_status text,
  ADD COLUMN IF NOT EXISTS ai_confidence numeric(5,4),
  ADD COLUMN IF NOT EXISTS proposal_source text,
  ADD COLUMN IF NOT EXISTS approval_policy_at_creation text,
  ADD COLUMN IF NOT EXISTS decision text,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decided_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_note text,
  ADD COLUMN IF NOT EXISTS retriage_batch_id text,
  ADD COLUMN IF NOT EXISTS retriage_rule text;

ALTER TABLE action_items DROP CONSTRAINT IF EXISTS action_items_decision_check;
ALTER TABLE action_items ADD CONSTRAINT action_items_decision_check
  CHECK (decision IS NULL OR decision IN ('approved', 'rejected', 'auto_approved'));

CREATE INDEX IF NOT EXISTS action_items_pending_approval_idx ON action_items (priority, created_at DESC)
  WHERE type = 'status_change_approval' AND status IN ('open', 'in_progress');
CREATE INDEX IF NOT EXISTS action_items_type_status_idx ON action_items (type, status);

ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS suppression_reason text,
  ADD COLUMN IF NOT EXISTS suppression_rule text,
  ADD COLUMN IF NOT EXISTS retriage_batch_id text,
  ADD COLUMN IF NOT EXISTS retriaged_at timestamptz;

CREATE INDEX IF NOT EXISTS email_communications_relevance_idx
  ON email_communications (candidate_id, ai_relevant, sent_at DESC);
