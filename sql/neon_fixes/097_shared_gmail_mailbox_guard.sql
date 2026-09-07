-- 097_shared_gmail_mailbox_guard.sql
-- Make the single shared-mailbox invariant explicit for databases that were
-- provisioned from an older schema snapshot. Existing candidate-owned rows are
-- intentionally untouched; this only prevents a second shared Gmail row.

CREATE UNIQUE INDEX IF NOT EXISTS integration_accounts_gmail_shared_unique_idx
  ON integration_accounts (provider, owner_type)
  WHERE provider = 'gmail' AND owner_type = 'shared_application_mailbox';

