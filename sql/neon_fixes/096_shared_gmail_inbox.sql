-- 096_shared_gmail_inbox.sql
-- Single shared Gmail inbox redesign (see Planning MD Files/
-- "TalentOS — Single Shared Gmail Inbox Redesign 6 August 2026.md").
--
-- Moving from "one Gmail account per candidate" to "one shared Gmail
-- account for the whole system, fed by external forwarding" breaks the
-- free candidate assignment TalentOS relied on (whichever mailbox a message
-- arrived in). candidate_id must become nullable so a message that cannot
-- be deterministically matched (see candidateEmailMatcher.ts) can still be
-- stored and surfaced in the new "Unassigned" queue instead of being
-- rejected or guessed at.
--
-- Additive/relaxing only. Existing owner_type='candidate' integration_accounts
-- rows and every existing email_communications row are untouched.

ALTER TABLE email_communications ALTER COLUMN candidate_id DROP NOT NULL;

ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS candidate_match_method text,
  ADD COLUMN IF NOT EXISTS body_html text;

-- Backing index for the Unassigned queue (WHERE candidate_id IS NULL),
-- newest-first — mirrors email_comm_untriaged_idx's partial-index style.
CREATE INDEX IF NOT EXISTS email_comm_unassigned_idx
  ON email_communications (ingested_at DESC) WHERE candidate_id IS NULL;
