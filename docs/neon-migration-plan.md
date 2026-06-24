# Neon Migration Plan — TalentOS/Skarion Tracker

**Created:** 2026-07-07
**Target:** Neon Postgres as the main application database
**Auth:** Supabase Auth kept temporarily (Hybrid Option A)
**Storage:** Supabase Storage kept temporarily

---

## 1. Target Neon Project

**Suggested database name:** `skarion-talent-os-prod`
**Region:** Same region as your Cloudflare Workers (e.g., `us-east-1` for US-based deployment)
**Plan:** Neon Serverless (minimum) or Neon Pro (recommended for production)

---

## 2. Required Postgres Extensions

| Extension | Purpose | Migration SQL |
|-----------|---------|---------------|
| `pgcrypto` | `gen_random_uuid()` for UUID generation | `CREATE EXTENSION IF NOT EXISTS pgcrypto;` |
| `pg_trgm` | Trigram similarity for fuzzy text search (if used by deduplication) | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` |
| `uuid-ossp` | Alternative UUID generation (fallback) | `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";` |

---

## 3. Migration Order

Apply these in order:

1. `20260617070000_application_assignments.sql`
2. `20260617080000_application_comments_and_portal.sql`
3. `20260618120000_application_ticket_workflow.sql`
4. `20260618123000_application_followup_automation.sql`
5. `20260619002429_falood_ai_phase1.sql` (base schema + application_packets base)
6. `20260619020000_chunk1_application_workflow_foundation.sql`
7. `20260619090000_portal_security_and_application_proof.sql`
8. `20260619120000_resume_tailoring_metadata.sql`
9. `20260619185616_application_job_keywords.sql`
10. `20260619193000_ai_api_keys.sql`
11. `20260620185616_application_resume_suggestions.sql`
12. `20260621120000_application_resume_exports.sql`
13. `20260622120000_application_packet_v1.sql`
14. `20260617090000_auth_profiles_roles.sql` (keep if Supabase Auth stays)

**Note:** If Supabase Auth is kept, keep `auth.users` FK references and auth triggers. If Supabase Auth is removed, replace `auth.users` with a local `users` table.

---

## 4. Schema Import Method

### Option A: Supabase CLI push to Neon (recommended if compatible)

```bash
# Set Neon direct connection string
export NEON_DATABASE_URL_DIRECT="postgres://user:password@host.neon.tech/dbname?sslmode=require"

# Push all migrations
supabase db push --db-url "$NEON_DATABASE_URL_DIRECT"
```

**Caveat:** Supabase CLI migrations may contain Supabase-specific syntax. Review each migration before pushing.

### Option B: Direct psql execution

```bash
# Connect to Neon and execute all migrations in order
for f in supabase/migrations/*.sql; do
  echo "Applying $f..."
  psql "$NEON_DATABASE_URL_DIRECT" -f "$f" || exit 1
done
```

### Option C: Consolidated schema dump

```bash
# Export schema from Supabase
supabase db dump -f tmp/supabase_schema.sql

# Review and edit for Neon compatibility
# - Remove `auth` schema references if auth is not migrating
# - Remove `storage` schema references
# - Keep `public` schema only

# Import to Neon
psql "$NEON_DATABASE_URL_DIRECT" -f tmp/supabase_schema.sql
```

---

## 5. Data Import Method

### Step 1: Export data from Supabase

```bash
# Link to project
supabase link --project-ref <SUPABASE_PROJECT_REF>

# Export data (not schema)
supabase db dump --data-only -f tmp/supabase_data.sql
```

### Step 2: Clean the data dump

Remove or edit:
- `auth` schema data (users, sessions, etc.) — keep if Supabase Auth is staying
- `storage` schema data — keep if Supabase Storage is staying
- Any test/development data you don't want in production

### Step 3: Import to Neon

```bash
psql "$NEON_DATABASE_URL_DIRECT" -f tmp/supabase_data.sql
```

### Step 4: Verify row counts

```bash
psql "$NEON_DATABASE_URL_DIRECT" <<'EOF'
SELECT 'candidates' as table_name, COUNT(*) as count FROM candidates
UNION ALL
SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL
SELECT 'applications', COUNT(*) FROM applications
UNION ALL
SELECT 'profiles', COUNT(*) FROM profiles
UNION ALL
SELECT 'ai_api_keys', COUNT(*) FROM ai_api_keys
UNION ALL
SELECT 'application_job_keywords', COUNT(*) FROM application_job_keywords
UNION ALL
SELECT 'application_resume_suggestions', COUNT(*) FROM resume_suggestions
UNION ALL
SELECT 'application_resume_versions', COUNT(*) FROM application_resume_versions
UNION ALL
SELECT 'application_resume_exports', COUNT(*) FROM application_resume_exports
UNION ALL
SELECT 'application_packets', COUNT(*) FROM application_packets
UNION ALL
SELECT 'base_resumes', COUNT(*) FROM base_resumes
UNION ALL
SELECT 'companies', COUNT(*) FROM companies
UNION ALL
SELECT 'company_people', COUNT(*) FROM company_people
UNION ALL
SELECT 'email_templates', COUNT(*) FROM email_templates
UNION ALL
SELECT 'follow_ups', COUNT(*) FROM follow_ups
UNION ALL
SELECT 'import_sources', COUNT(*) FROM import_sources
UNION ALL
SELECT 'interview_schedules', COUNT(*) FROM interview_schedules
UNION ALL
SELECT 'resumes', COUNT(*) FROM resumes
UNION ALL
SELECT 'webhook_endpoints', COUNT(*) FROM webhook_endpoints;
EOF
```

---

## 6. Rollback Plan

1. **Database rollback:** Neon supports point-in-time restore. Create a restore branch before migration.
2. **Schema rollback:** Keep the original Supabase project active. Do not delete it until Neon is fully verified.
3. **Application rollback:** The app still reads Supabase env vars. If Neon fails, revert `DATABASE_URL` to point back to Supabase (as a fallback).
4. **Code rollback:** The `src/lib/supabase.ts` proxy can be reverted to point back to Supabase if needed. Keep the Supabase client code in the repo.

---

## 7. Verification SQL

After migration, run these checks:

```sql
-- 1. Check all tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 2. Check constraints
SELECT table_name, constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_schema = 'public'
ORDER BY table_name, constraint_name;

-- 3. Check indexes
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- 4. Check extensions
SELECT extname FROM pg_extension;

-- 5. Check triggers
SELECT event_object_table, trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;
```

---

## 8. Post-Migration Schema Updates (Neon-Specific)

### Add `auth_user_id` to profiles (if keeping Supabase Auth)

```sql
-- If not already present, ensure profiles can link to Supabase Auth users
-- The existing profiles.user_id already references auth.users(id)
-- No schema change needed if keeping Supabase Auth
```

### Add `id` primary key to profiles if not present

```sql
-- Ensure profiles has a primary key
ALTER TABLE profiles ADD PRIMARY KEY (user_id) IF NOT EXISTS;
```

---

*End of migration plan.*
