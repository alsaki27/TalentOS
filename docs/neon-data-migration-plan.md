# TalentOS Data Migration Plan: Supabase → Neon

## Overview

This document describes the safe, zero-downtime approach to migrating data from Supabase to Neon Postgres. The app is already code-migrated (dual-backend with `DB_PROVIDER` switch). This plan covers the actual data migration.

## Prerequisites

- Neon project created (free tier: `https://neon.tech`)
- Neon connection string (pooled): `DATABASE_URL`
- Neon connection string (direct): `NEON_DATABASE_URL_DIRECT` (for migrations only)
- Supabase connection string: can use the Supabase Dashboard or `pg_dump`
- `pg_dump` and `psql` installed locally (or use the Supabase CLI)

## Step 1: Verify Neon Schema

Ensure the Neon schema has been applied successfully:

```bash
psql $DATABASE_URL -f neon/migrations/0001_initial_schema.sql
```

Verify tables were created:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
```

Expected: 56 tables.

## Step 2: Export Data from Supabase

### Option A: pg_dump (recommended)

Get your Supabase connection string from the Supabase Dashboard → Settings → Database.

```bash
# Export all data (no schema, no owners, no ACLs)
pg_dump \
  --host=<host>.supabase.co \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --data-only \
  --no-owner \
  --no-acl \
  --format=plain \
  > supabase_data_export.sql
```

### Option B: Supabase CLI (easier)

```bash
supabase link --project-ref <project-ref>
supabase db dump --data-only --file supabase_data_export.sql
```

### Option C: Table-by-Table (if full dump fails)

```bash
# List tables to migrate
psql $SUPABASE_URL -c "\dt public.*" | grep -E "^ public\." | awk '{print $3}' > tables.txt

# Export each table
for table in $(cat tables.txt); do
  pg_dump --data-only --table="public.$table" $SUPABASE_URL > "export_${table}.sql"
done
```

## Step 3: Clean the Export

The `pg_dump` output may contain Supabase-specific references (e.g., `auth.users` foreign keys, `storage.objects` references). We need to clean these before importing into Neon.

### What to remove from the export:

1. **References to `auth.users`** — Our schema already removed these FKs
2. **RLS policies** — Our schema has no RLS
3. **Supabase extensions** — Keep only standard extensions (pgcrypto, uuid-ossp)
4. **Trigger references to `auth.users`** — Already removed in our schema

### Quick cleanup script:

```bash
# Remove lines that reference auth schema
sed -i '/auth\./d' supabase_data_export.sql

# Remove RLS SET statements
sed -i '/ALTER TABLE .* ENABLE ROW LEVEL SECURITY/d' supabase_data_export.sql
sed -i '/ALTER TABLE .* FORCE ROW LEVEL SECURITY/d' supabase_data_export.sql
sed -i '/CREATE POLICY/d' supabase_data_export.sql
sed -i '/DROP POLICY/d' supabase_data_export.sql

# Remove Supabase-specific extensions (keep pgcrypto, uuid-ossp, etc.)
sed -i '/CREATE EXTENSION IF NOT EXISTS "supabase\//d' supabase_data_export.sql
sed -i '/COMMENT ON EXTENSION "supabase\//d' supabase_data_export.sql
```

## Step 4: Import Data into Neon

```bash
# Import the cleaned data
psql $DATABASE_URL < supabase_data_export.sql
```

If you get errors about missing sequences (e.g., `nextval` for serial/identity columns), run:

```sql
-- Reset all sequences to the max value of their columns
SELECT setval(c.oid, (SELECT MAX(a.attname) FROM pg_attribute a WHERE a.attrelid = c.oid))
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'S' AND n.nspname = 'public';
```

Or more accurately:

```sql
DO $$
DECLARE
    rec RECORD;
    seq_name TEXT;
    col_name TEXT;
    tbl_name TEXT;
    max_val BIGINT;
BEGIN
    FOR rec IN
        SELECT c.relname as sequence_name, t.relname as table_name, a.attname as column_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_depend d ON d.objid = c.oid
        JOIN pg_class t ON t.oid = d.refobjid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
        WHERE c.relkind = 'S' AND n.nspname = 'public'
    LOOP
        seq_name := rec.sequence_name;
        tbl_name := rec.table_name;
        col_name := rec.column_name;
        EXECUTE format('SELECT COALESCE(MAX(%I), 0) + 1 FROM %I', col_name, tbl_name) INTO max_val;
        EXECUTE format('SELECT setval(%L, %s)', seq_name, max_val);
    END LOOP;
END $$;
```

## Step 5: Verify Data Integrity

Run these verification queries on both Supabase and Neon, compare the results:

```sql
-- Row counts per table
SELECT schemaname, tablename, 
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', schemaname, tablename), false, true, '')))[1]::text::int AS row_count
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Or simpler (table by table):

```sql
SELECT 'candidates' as table_name, COUNT(*) as count FROM candidates
UNION ALL
SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL
SELECT 'applications', COUNT(*) FROM applications
UNION ALL
SELECT 'companies', COUNT(*) FROM companies
UNION ALL
SELECT 'base_resumes', COUNT(*) FROM base_resumes
UNION ALL
SELECT 'application_resume_versions', COUNT(*) FROM application_resume_versions
UNION ALL
SELECT 'application_packets', COUNT(*) FROM application_packets
UNION ALL
SELECT 'target_jobs', COUNT(*) FROM target_jobs
UNION ALL
SELECT 'ai_api_keys', COUNT(*) FROM ai_api_keys
UNION ALL
SELECT 'email_templates', COUNT(*) FROM email_templates
UNION ALL
SELECT 'interview_schedules', COUNT(*) FROM interview_schedules
UNION ALL
SELECT 'chat_conversations', COUNT(*) FROM chat_conversations
ORDER BY table_name;
```

## Step 6: Switch to Neon (Cutover)

### 6a. Set Environment Variables

```bash
# .env.local or .dev.vars
DB_PROVIDER=neon
DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require
NEON_DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require
```

### 6b. Test Locally

```bash
DB_PROVIDER=neon npm run dev
```

Smoke test the app:
- Login (auth still goes to Supabase)
- View candidates, jobs, applications
- Create an application
- Check that data appears in Neon

### 6c. Deploy to Cloudflare

```bash
# Set secrets
wrangler secret put DATABASE_URL
wrangler secret put NEON_DATABASE_URL
wrangler secret put DB_PROVIDER  # value: neon

# Deploy
npm run cf:deploy
```

## Step 7: Rollback (if needed)

If anything goes wrong, rollback is instant:

```bash
# Change environment variable back
DB_PROVIDER=supabase

# Or for Cloudflare
wrangler secret put DB_PROVIDER  # value: supabase
```

The app instantly reverts to Supabase. No data migration needed because Supabase still has all the data.

## Step 8: Cleanup (after stable)

After Neon has been running stably for a few days/weeks:

1. Remove the Supabase `DB_PROVIDER` fallback code (optional — keeping it is safer)
2. Migrate auth from Supabase to a custom solution or keep Supabase Auth permanently
3. Migrate storage from Supabase to Cloudflare R2 or keep Supabase Storage permanently

## Known Issues & Mitigations

| Issue | Mitigation |
|-------|------------|
| Foreign keys to `auth.users` | Already removed in Neon schema; `profiles.user_id` is plain UUID |
| RLS policies | Not migrated; handled by app-level auth |
| Supabase Realtime | Not migrated; use WebSockets or polling instead |
| Supabase Storage | Keep using Supabase Storage or migrate to Cloudflare R2 |
| Supabase Auth | Keep using Supabase Auth (hybrid) |
| pg_dump includes auth data | Clean export with `sed` scripts above |
| Sequences out of sync | Reset with the PL/pgSQL script above |
| Large tables (resumes with blobs) | May need chunked export; consider `pg_dump --blobs` |

## Timing Estimates

| Step | Time |
|------|------|
| Verify Neon schema | 2 min |
| Export from Supabase | 5-30 min (depends on data size) |
| Clean export | 5 min |
| Import to Neon | 5-30 min |
| Verify row counts | 5 min |
| Local smoke test | 10 min |
| Deploy to Cloudflare | 5 min |
| **Total** | **30-80 min** |

## Data Size Considerations

The free Neon tier has:
- 0.5 GB storage
- 190 compute hours/month (equivalent to ~6.3 hours/day of active compute)
- 10,000 active compute hours on the paid plan (but start free)

If your Supabase database is > 0.5 GB, you may need the paid tier ($19/month) or selective migration (migrate only recent/active data).

## Supabase → Neon: Selective Migration (if > 0.5 GB)

If your data exceeds the free tier, migrate only:
- Active candidates (status != 'archived')
- Active jobs (is_active = true)
- Recent applications (applied_at > 90 days ago)
- Recent chat messages, email logs, etc.

This requires custom SQL export queries. Contact the team for a custom migration script.

---

## Appendix: One-Shot Migration Script

Save this as `migrate.sh` and run it:

```bash
#!/bin/bash
set -e

SUPABASE_URL="postgresql://postgres:password@host.supabase.co:5432/postgres"
NEON_URL="postgresql://user:password@host.neon.tech/dbname?sslmode=require"

echo "=== Step 1: Exporting from Supabase ==="
pg_dump "$SUPABASE_URL" --data-only --no-owner --no-acl > /tmp/supabase_data.sql

echo "=== Step 2: Cleaning export ==="
grep -v "auth\." /tmp/supabase_data.sql | \
  grep -v "ALTER TABLE .* ENABLE ROW LEVEL SECURITY" | \
  grep -v "ALTER TABLE .* FORCE ROW LEVEL SECURITY" | \
  grep -v "CREATE POLICY" | \
  grep -v "DROP POLICY" | \
  grep -v "CREATE EXTENSION IF NOT EXISTS \"supabase" > /tmp/clean_data.sql

echo "=== Step 3: Importing to Neon ==="
psql "$NEON_URL" < /tmp/clean_data.sql

echo "=== Step 4: Verifying ==="
psql "$NEON_URL" -c "SELECT 'candidates', COUNT(*) FROM candidates UNION ALL SELECT 'jobs', COUNT(*) FROM jobs UNION ALL SELECT 'applications', COUNT(*) FROM applications;"

echo "=== Migration complete! ==="
```

Run with: `chmod +x migrate.sh && ./migrate.sh`
