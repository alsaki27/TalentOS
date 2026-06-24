# Data Migration: Supabase → Neon — TalentOS/Skarion Tracker

**Created:** 2026-07-07
**Scope:** Export data from Supabase, import to Neon, verify.

---

## Prerequisites

- Supabase CLI installed and logged in
- `psql` installed locally
- Neon project created with connection string
- `SUPABASE_PROJECT_REF` environment variable set
- `NEON_DATABASE_URL_DIRECT` environment variable set

---

## Step 1: Export Schema from Supabase

```bash
# Link to your Supabase project
supabase link --project-ref "$SUPABASE_PROJECT_REF"

# Export schema only
supabase db dump -f tmp/supabase_schema.sql

# Export data only
supabase db dump --data-only -f tmp/supabase_data.sql
```

---

## Step 2: Inspect Schema for Supabase-Specific Content

Review `tmp/supabase_schema.sql` and remove or edit:

| Section | Action | Reason |
|---------|--------|--------|
| `CREATE SCHEMA auth;` | **Keep** if keeping Supabase Auth | Needed for auth.users FK |
| `CREATE SCHEMA storage;` | **Remove** | Supabase Storage not migrating to Neon |
| `CREATE SCHEMA realtime;` | **Remove** | Not needed |
| `CREATE SCHEMA supabase_functions;` | **Remove** | Not needed |
| `CREATE SCHEMA extensions;` | **Keep** | Contains pgcrypto |
| `auth.users` table | **Keep** if keeping Supabase Auth | FK target for profiles.user_id |
| `auth.sessions` | **Keep** if keeping Supabase Auth | Needed for auth |
| `storage.objects` | **Remove** | Supabase Storage not migrating |
| `storage.buckets` | **Remove** | Supabase Storage not migrating |
| `GRANT ...` on storage/auth | **Keep/Remove** as needed | Supabase-specific roles |
| `COMMENT ON EXTENSION` | **Keep** | Harmless |
| `service_role_bypass` RLS policies | **Keep** | These are app-level, not Supabase-specific |

---

## Step 3: Create Neon Schema

```bash
# Apply reviewed schema to Neon
psql "$NEON_DATABASE_URL_DIRECT" -f tmp/supabase_schema.sql
```

If the schema has errors, fix them and re-apply. Common issues:
- Missing `pgcrypto` extension: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
- Missing `uuid-ossp` extension: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`
- `auth.users` not found: ensure you're keeping Supabase Auth OR create a local `users` table.

---

## Step 4: Import Data

```bash
# Apply data to Neon
psql "$NEON_DATABASE_URL_DIRECT" -f tmp/supabase_data.sql
```

**Common issues and fixes:**

### Issue: `auth.users` data conflicts with Supabase Auth
**Fix:** If keeping Supabase Auth, do NOT import `auth.users` data. Supabase Auth will manage its own users table. Only import `public` schema data.

```bash
# Extract only public schema data
grep -v "^SET search_path = auth" tmp/supabase_data.sql | \
grep -v "^SET search_path = storage" | \
grep -v "^COPY auth\." | \
grep -v "^COPY storage\." > tmp/supabase_data_public.sql

psql "$NEON_DATABASE_URL_DIRECT" -f tmp/supabase_data_public.sql
```

### Issue: `ON CONFLICT` or duplicate keys
**Fix:** The data dump should use `INSERT` without `ON CONFLICT`. If duplicates exist, the schema may have been partially populated. Truncate tables and re-import.

```bash
# Truncate all public tables (DANGEROUS - only on fresh Neon!)
psql "$NEON_DATABASE_URL_DIRECT" <<'EOF'
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;
EOF
```

---

## Step 5: Verify Data Integrity

### Row count verification

```bash
psql "$NEON_DATABASE_URL_DIRECT" <<'EOF'
SELECT
  'candidates' as table_name, COUNT(*) as count FROM candidates
UNION ALL SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL SELECT 'applications', COUNT(*) FROM applications
UNION ALL SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL SELECT 'ai_api_keys', COUNT(*) FROM ai_api_keys
UNION ALL SELECT 'application_job_keywords', COUNT(*) FROM application_job_keywords
UNION ALL SELECT 'resume_suggestions', COUNT(*) FROM resume_suggestions
UNION ALL SELECT 'application_resume_versions', COUNT(*) FROM application_resume_versions
UNION ALL SELECT 'application_resume_exports', COUNT(*) FROM application_resume_exports
UNION ALL SELECT 'application_packets', COUNT(*) FROM application_packets
UNION ALL SELECT 'base_resumes', COUNT(*) FROM base_resumes
UNION ALL SELECT 'companies', COUNT(*) FROM companies
UNION ALL SELECT 'company_people', COUNT(*) FROM company_people
UNION ALL SELECT 'email_templates', COUNT(*) FROM email_templates
UNION ALL SELECT 'import_sources', COUNT(*) FROM import_sources
UNION ALL SELECT 'interview_schedules', COUNT(*) FROM interview_schedules
UNION ALL SELECT 'resumes', COUNT(*) FROM resumes
UNION ALL SELECT 'webhook_endpoints', COUNT(*) FROM webhook_endpoints
UNION ALL SELECT 'activity_logs', COUNT(*) FROM activity_logs
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL SELECT 'candidate_evidence', COUNT(*) FROM candidate_evidence
UNION ALL SELECT 'chat_conversations', COUNT(*) FROM chat_conversations
UNION ALL SELECT 'chat_messages', COUNT(*) FROM chat_messages
UNION ALL SELECT 'falood_conversations', COUNT(*) FROM falood_conversations
UNION ALL SELECT 'falood_messages', COUNT(*) FROM falood_messages
ORDER BY table_name;
EOF
```

### Compare with Supabase

```bash
# Run the same query on Supabase (via supabase CLI or dashboard)
# Supabase dashboard SQL editor:
# <paste the same SQL without the psql wrapper>
```

**Acceptable variance:**
- `auth` schema tables may differ (if not importing auth data)
- `storage` schema tables will differ (not migrating)
- `activity_logs` and `audit_logs` may have new entries since export

### Foreign key verification

```bash
psql "$NEON_DATABASE_URL_DIRECT" <<'EOF'
-- Check for orphaned FKs
SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
ORDER BY tc.table_name;
EOF
```

---

## Step 6: Security Checklist for Data Migration

- [ ] Do not migrate `auth` schema users unless intentionally migrating auth system
- [ ] Do not migrate `storage.objects` or `storage.buckets` — R2 migration is separate
- [ ] Do not migrate Supabase-specific system tables
- [ ] Do not migrate test/admin data if you want a clean production start
- [ ] Rotate AI API keys after migration (don't trust the migrated encrypted values)
- [ ] Rotate any `CRON_SECRET` or `TALENT_OS_WEBHOOK_SECRET` values
- [ ] Verify `AI_KEYS_ENCRYPTION_SECRET` is the same on both sides if keeping migrated AI keys
- [ ] Do not expose `.env` files or connection strings in logs

---

## Step 7: Rollback Data (if needed)

If data import fails:

```bash
# Truncate all public tables and start over
psql "$NEON_DATABASE_URL_DIRECT" <<'EOF'
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
END $$;
EOF

# Re-import
psql "$NEON_DATABASE_URL_DIRECT" -f tmp/supabase_data.sql
```

Or use Neon branch management:
```bash
# Create a new branch from the pre-migration state
# Neon dashboard: Branches → Create Branch → From (pre-migration point)
```

---

*End of data migration guide.*
