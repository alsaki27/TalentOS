# sql/neon_fixes/

Neon-only, additive schema patches. Every `.sql` file in this directory is
run automatically against the live database by `.github/workflows/deploy.yml`
on every deploy, in filename order (`001_`, `002_`, ...).

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
- Every statement must be safe to run an unlimited number of times against
  a database already in any state: `CREATE ... IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP ... IF EXISTS` before
  recreate, guarded `DO $$ ... $$` blocks for conditional backfills.
- No `DROP TABLE`, no data-deleting statements, nothing that assumes a
  specific prior state. CI runs this unattended on every push - there is
  no review gate before it executes against production.
