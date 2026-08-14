ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS attachment_metadata jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS email_comm_attachments_idx
  ON email_communications USING gin (attachment_metadata);

ALTER TABLE integration_accounts
  ADD COLUMN IF NOT EXISTS gmail_watch_channel_id text,
  ADD COLUMN IF NOT EXISTS gmail_watch_expiration timestamptz;
