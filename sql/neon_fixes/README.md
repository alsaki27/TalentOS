# sql/neon_fixes/

Postgres schema patches. Ordinary pushes, CI runs, and automatic application
deploys do not execute these files. The deployment workflow runs database SQL
only after an explicit manual dispatch with schema fixes enabled; that mode
applies every file in filename order (`001_`, `002_`, ...), so review the full
pending set and take any required backup before dispatching it.

This exists because `sql/05_neon_fixes.sql` (now `001_app_number_and_timestamps.sql`)
was written but never actually run against Neon, and code that depended on
its columns (`applications.app_number`) shipped and broke in production
before anyone noticed - the fix existed, it just never executed.

The rest of `sql/` (`01_schema.sql`, `02_rls_policies.sql`, etc.) is the
original Supabase-era schema/RLS history. Those are **not** auto-run: they
target Supabase specifically (RLS policies, `auth.uid()`), aren't idempotent
(`01_schema.sql`'s `CREATE TABLE` statements have no `IF NOT EXISTS` guard),
and re-running them against Neon would fail or do the wrong thing. Leave
them as manual/historical reference only.

## Rules for files added here

- Filename: `NNN_short_description.sql`, zero-padded, in the order they
  should run.
- Ordinary migrations must be safe to rerun: `CREATE ... IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, guarded `DO $$ ... $$` blocks
  for conditional backfills, and no unreviewed data deletion. Any destructive
  migration requires explicit user authorization and a verified backup first.

Migration `131_email_reply_state_cleanup.sql` is an explicitly authorized
exception: the user requested removal of the per-user opened/checked table,
and its full rows were exported to
`../TalentOS-backups/email-thread-user-state-pre-131-20261102T140427Z.sql`
relative to the repository root
before applying.
It converts any still-current checked thread into the shared manual-replied
state, then drops the obsolete table. Do not restore the table as part of a
normal rollback; the export is retained for recovery/audit if needed.
