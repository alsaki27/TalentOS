-- Resumable full-mailbox import state for candidate Gmail accounts.
-- The importer processes one Gmail messages.list page per sync run, so a large
-- mailbox cannot be silently truncated by a fixed page cap or request timeout.
ALTER TABLE integration_accounts
  ADD COLUMN IF NOT EXISTS gmail_backfill_page_token text,
  ADD COLUMN IF NOT EXISTS gmail_backfill_complete boolean NOT NULL DEFAULT false;

-- Existing accounts with a history cursor are already past their initial
-- backfill. New/reconnected accounts remain false and start from page one.
UPDATE integration_accounts
   SET gmail_backfill_complete = true
 WHERE provider = 'gmail'
   AND gmail_history_id IS NOT NULL
   AND gmail_backfill_complete = false;
