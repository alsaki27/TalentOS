-- Gmail inbox log support. Imported mail remains internal-only; this migration
-- adds mailbox presentation metadata and the indexes used by the staff inbox.

ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS gmail_is_unread boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_is_important boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS email_comm_mailbox_order_idx
  ON email_communications (sent_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_comm_candidate_direction_order_idx
  ON email_communications (candidate_id, direction, sent_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_comm_category_order_idx
  ON email_communications (ai_category, sent_at DESC)
  WHERE ai_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_comm_unread_order_idx
  ON email_communications (sent_at DESC, id DESC)
  WHERE gmail_is_unread = true;
