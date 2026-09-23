-- 079_inbox_drafts_and_handover.sql
-- Idempotent. Additive only. No seeds.

CREATE TABLE IF NOT EXISTS inbox_drafts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_communication_id uuid REFERENCES email_communications(id) ON DELETE CASCADE,
  candidate_id           uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_by             uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  to_email               text NOT NULL,
  subject                text NOT NULL,
  body                   text NOT NULL,
  attachment_metadata    jsonb NOT NULL DEFAULT '[]',
  gmail_draft_id         text,           -- Gmail API draft id (for sync)
  gmail_thread_id        text,           -- Parent thread (for Reply threading)
  sent_at                timestamptz,    -- NULL = still a draft; set when sent
  discarded_at           timestamptz,    -- Soft delete
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbox_drafts_candidate_idx
  ON inbox_drafts (candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inbox_drafts_unsent_idx
  ON inbox_drafts (candidate_id)
  WHERE sent_at IS NULL AND discarded_at IS NULL;
