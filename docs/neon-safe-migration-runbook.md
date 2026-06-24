# Neon Safe Migration Runbook — TalentOS/Skarion Tracker

**WARNING:** Do not run production deploy until Neon schema, data import, auth mapping, and repository migration smoke tests pass.

**Created:** 2026-07-07
**Strategy:** Hybrid Option A — Neon for business DB, Supabase Auth/Storage temporarily

---

## 1. Safety Checklist (do these first)

- [ ] Create a **Neon test branch** before touching production Neon database.
- [ ] Do NOT run migrations against a production Neon database on the first try.
- [ ] Keep Supabase project active as fallback until migration is verified.
- [ ] Backup Supabase data before any export (`supabase db dump`).
- [ ] Verify `NEON_DATABASE_URL_DIRECT` uses direct connection (non-pooled) for migrations.
- [ ] Verify `DATABASE_URL` or `NEON_DATABASE_URL` uses pooled connection for runtime.
- [ ] Do NOT commit `.env.local`, `.dev.vars`, or any secrets.
- [ ] Do NOT migrate Supabase `auth` or `storage` schemas into Neon.
- [ ] Rotate any AI keys that were exposed during development before migrating.

## 2. Environment Variables

### Required for Neon migration

```bash
# Neon direct connection (for migrations only)
NEON_DATABASE_URL_DIRECT=postgres://user:password@host.neon.tech/dbname?sslmode=require

# Neon pooled connection (for runtime)
DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require
NEON_DATABASE_URL=postgres://user:password@host.neon.tech/dbname?sslmode=require

# DB provider switch
DB_PROVIDER=neon
```

### Required for Supabase Auth/Storage (kept temporarily)

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### Required for app function

```bash
AI_KEYS_ENCRYPTION_SECRET=your-32-byte-hex-secret
CRON_SECRET=your-cron-secret
ANTHROPIC_API_KEY=your-anthropic-key  # or NVIDIA_API_KEY
```

## 3. Migration Order

1. **Phase 1 (Safety):** Create Neon test branch, set env vars, create runbook.
2. **Phase 2 (Schema):** Build `neon/migrations/0001_initial_schema.sql` from audited Supabase migrations.
3. **Phase 3 (Dry Run):** Apply schema to Neon test branch, verify all tables exist.
4. **Phase 4 (Data):** Export only public business tables from Supabase, import to Neon.
5. **Phase 5 (Provider Switch):** Add `DB_PROVIDER` switch, verify `src/server/db/index.ts` routes correctly.
6. **Phase 6 (Repositories):** Migrate repositories one by one, keeping Supabase fallback.
7. **Phase 7 (Auth Hybrid):** Verify Supabase Auth still works with Neon app DB.
8. **Phase 8 (Storage Hybrid):** Verify Supabase Storage still works with Neon app DB.
9. **Phase 9 (Smoke Test):** Run full workflow with `DB_PROVIDER=neon` locally.
10. **Phase 10 (Audit):** Search for remaining `supabase.from()` in business logic.
11. **Phase 11 (Preview):** Run `npm run cf:preview` with Neon secrets.
12. **Phase 12 (Deploy):** Only after all smoke tests pass.

## 4. Rollback Plan

If anything breaks:

1. Revert `DB_PROVIDER` to `supabase` in env vars.
2. App immediately falls back to Supabase database.
3. Supabase Auth and Storage continue working unchanged.
4. Neon database can be dropped or kept as a branch for debugging.
5. No data loss — Supabase remains the source of truth until verified.

## 5. What Stays in Supabase (Temporary)

| Service | Stays in Supabase Until | Reason |
|---------|------------------------|--------|
| Auth (login/signup/session) | Phase 2 auth migration | Deeply embedded in 4 files + auth.users FKs |
| Storage (resumes/photos) | Phase 3 storage migration | Upload/download routes depend on it |
| Service role key | Phase 2 auth migration | Used for admin auth operations |
| `auth.users` table | Phase 2 auth migration | Profiles FK references it |

## 6. What Moves to Neon

| Service | Moves to Neon Now | Status |
|---------|-------------------|--------|
| All business tables (candidates, jobs, applications, etc.) | ✅ Yes | This migration |
| `profiles` table | ✅ Yes | Must keep `auth_user_id` or same `user_id` for Supabase Auth mapping |
| `activity_logs` | ✅ Yes | Audit table |
| `ai_api_keys` | ⚠️ Optional | If dev keys were exposed, recreate instead |
| `public_api_keys` | ✅ Yes | If used |

## 7. Neon Branch Strategy

```bash
# 1. Create a test branch from main in Neon Dashboard
# 2. Get the test branch connection string
# 3. Set NEON_DATABASE_URL_DIRECT to test branch URL
# 4. Run schema migration on test branch
# 5. Verify tables
# 6. Import data to test branch
# 7. Run smoke tests against test branch
# 8. Only then: promote test branch to main or reset main and reapply
```

## 8. Verification Commands

After schema migration:
```bash
psql "$NEON_DATABASE_URL_DIRECT" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

After data import:
```bash
psql "$NEON_DATABASE_URL_DIRECT" <<'EOF'
SELECT 'profiles', count(*) FROM profiles
UNION ALL SELECT 'candidates', count(*) FROM candidates
UNION ALL SELECT 'jobs', count(*) FROM jobs
UNION ALL SELECT 'applications', count(*) FROM applications
UNION ALL SELECT 'application_resume_versions', count(*) FROM application_resume_versions
UNION ALL SELECT 'application_job_keywords', count(*) FROM application_job_keywords
UNION ALL SELECT 'application_resume_suggestions', count(*) FROM resume_suggestions
UNION ALL SELECT 'application_resume_exports', count(*) FROM application_resume_exports
UNION ALL SELECT 'application_packets', count(*) FROM application_packets
UNION ALL SELECT 'ai_api_keys', count(*) FROM ai_api_keys;
EOF
```

## 9. Do NOT Do These

- [ ] Do NOT delete Supabase project until migration is fully verified.
- [ ] Do NOT remove `SUPABASE_URL` env var — Auth still needs it.
- [ ] Do NOT import `auth.users` data into Neon unless doing a full auth migration.
- [ ] Do NOT import `storage.objects` data into Neon — that's for R2 migration later.
- [ ] Do NOT change `profiles.user_id` type or remove the FK until auth migration is planned.
- [ ] Do NOT deploy to production Neon without a test branch dry run.
- [ ] Do NOT skip the smoke test — data may import but queries may fail silently.

## 10. Next Command

After reading this runbook, the next command to run is:

```bash
# Create a Neon test branch in the Neon Dashboard, then:
psql "$NEON_DATABASE_URL_DIRECT" -f neon/migrations/0001_initial_schema.sql
```

If the schema file does not exist yet, build it first (see `docs/neon-migration-plan.md`).

---

*End of runbook. Read `docs/neon-migration-plan.md` for schema details and `docs/supabase-to-neon-safe-data-migration.md` for data migration steps.*
