-- gmailSyncService.ts's per-account mutual-exclusion lock used
-- pg_try_advisory_lock/pg_advisory_unlock, which requires a persistent
-- session - but this app's Neon access (@neondatabase/serverless) is
-- HTTP-based: each query() is its own stateless request, so the advisory
-- lock is released by Postgres the instant that request ends, before the
-- "locked" account is ever actually used. tryAccountLock() has therefore
-- always returned true, making concurrent-run protection a no-op (the cron's
-- 5-minute poll and a manual "Sync Gmail" click can race the same account's
-- gmail_backfill_page_token/gmail_history_id cursor). Replaced with a
-- durable, table-based claim - the same expiring-lock pattern already used
-- for application_ai_workflows (claimed_at/claim_expires_at), which works
-- correctly over the same stateless HTTP driver because it's a plain row
-- UPDATE, not session state.

ALTER TABLE integration_accounts ADD COLUMN IF NOT EXISTS sync_locked_until timestamptz;

CREATE INDEX IF NOT EXISTS integration_accounts_sync_lock_idx ON integration_accounts (sync_locked_until);
