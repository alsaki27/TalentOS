# Deployment Readiness Guide

Last updated: 2026-07-07

> **Deployment Target:** Cloudflare Workers FREE TIER + Neon Postgres (free tier also available). Supabase Auth/Storage kept temporarily.

## Deployment Target

The app supports two deployment targets:

| Target | Database | Auth | Storage | Runtime | Status |
|--------|----------|------|---------|---------|--------|
| **Vercel + Supabase** (current) | Supabase Postgres | Supabase Auth | Supabase Storage | Node.js | ✅ Working |
| **Cloudflare + Neon** (in progress) | Neon Postgres | Supabase Auth (temp) | Supabase Storage (temp) | Cloudflare Workers FREE TIER | 🚧 Infrastructure ready |

> **Free Tier Limits:** 100,000 requests/day, 10ms CPU per request, 128MB memory. No Hyperdrive needed. KV optional for ISR cache (1,000 reads/day, 1,000 writes/day).

## Required Environment Variables

### Neon (for Cloudflare deployment)

| Variable | Required | Source | Notes |
|----------|----------|--------|-------|
| `DATABASE_URL` | Yes | Neon Console > Connection Details | Pooled connection string. `sslmode=require`. |
| `NEON_DATABASE_URL` | Yes | Same as `DATABASE_URL` | Alias for compatibility. |
| `NEON_DATABASE_URL_DIRECT` | Yes | Same as above but direct (non-pooled) | For migrations only. |
| `APP_BASE_URL` | Yes | Your production URL | `https://your-app.pages.dev` or custom domain. |
| `NODE_ENV` | Yes | `production` | Set to `production`. |

### Supabase (still required for auth and storage)

| Variable | Required | Source | Notes |
|----------|----------|--------|-------|
| `SUPABASE_URL` | Yes | Supabase Dashboard > Settings > API | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Dashboard > Settings > API | Secret key, server-side only |
| `SUPABASE_ANON_KEY` | Yes | Supabase Dashboard > Settings > API | Anon/public key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Same as above | Browser-side |
| `CRON_SECRET` | Yes | Generate random string | Protects `/api/cron/*` routes |
| `AI_KEYS_ENCRYPTION_SECRET` | Yes | Generate 32-byte hex string | AES-256-GCM key for AI key encryption |
| `AI_PROVIDER` | No | `anthropic` or `nvidia` | Optional; falls back to db config |
| `ANTHROPIC_API_KEY` | No | Anthropic Console | Required if `AI_PROVIDER=anthropic` or db config |
| `NVIDIA_API_KEY` | No | NVIDIA API Console | Required if `AI_PROVIDER=nvidia` or db config |

**Note:** Supabase vars are temporary. Phase 2 will replace Supabase Auth. Phase 3 will replace Supabase Storage.

## Cloudflare Deployment Commands

```bash
# Build for Cloudflare
npm run cf:build

# Preview locally
npm run cf:preview

# Deploy to production
npm run cf:deploy

# Generate types from wrangler.toml
npm run cf:typegen
```

Set secrets via Wrangler:
```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put AI_KEYS_ENCRYPTION_SECRET
# ... etc. See docs/cloudflare-env-secrets.md for full list
```

## Required Supabase Migrations

All migrations must be applied in order before deployment:

1. `20260619002429_falood_ai_phase1.sql` (base schema)
2. `20260619020000_chunk1_application_workflow_foundation.sql`
3. `20260619090000_portal_security_and_application_proof.sql`
4. `20260619120000_resume_tailoring_metadata.sql`
5. `20260619185616_application_job_keywords.sql`
6. `20260619193000_ai_api_keys.sql`
7. `20260620185616_application_resume_suggestions.sql`
8. `20260621120000_application_resume_exports.sql`
9. `20260622120000_application_packet_v1.sql` (Chunk 10)

Apply locally with:

```bash
supabase db reset
# Or apply single migration
supabase migration up
```

Push to production with:

```bash
npx supabase db push
```

## Required Seed / Admin Setup

1. Create first admin user via **Supabase Auth > Users** or SQL insert into `profiles` table.
2. Run `supabase db reset` locally to verify migrations apply cleanly.
3. Add AI key via `/ops` AI key manager (or set env vars).

## AI Key Manager Setup

1. Navigate to `/ops` after logging in as admin.
2. Add **Anthropic** or **NVIDIA** API key.
3. Test key via the **Test** button.
4. Set priority ordering if multiple keys are added.

## Storage / Export Notes

- Export files (DOCX/PDF) are generated on-demand and returned directly to the client.
- No persistent storage of exported files in Supabase Storage or R2 yet.
- Export history is tracked in `application_resume_exports` table.
- Files are named `CandidateName_Resume.{ext}`.

## Cron Requirements

- `CRON_SECRET` must be set to protect cron endpoints.
- Vercel Cron jobs are configured in `vercel.json` (if using Vercel).
- Current cron endpoints:
  - `/api/cron/backup`
  - `/api/cron/categorize-jobs`
  - `/api/cron/digest`
  - `/api/cron/email-queue`
  - `/api/cron/import-sources`

## Known Build / Runtime Limitations

- **ESLint is not installed** (pre-existing, not a blocker).
- `docx` and `@react-pdf/renderer` libraries are **Node-only**; these will fail on Cloudflare Workers without `nodejs_compat` or externalization. Currently requires external microservice or replacement.
- **No RLS policies** are defined; auth is enforced at the app layer.
- AI features require an active AI provider; routes return **503** if none configured.
- **Supabase Auth is still required** for login/session. Neon migration only covers app database.
- **Supabase Storage is still required** for resume/photo uploads. R2 migration is Phase 3.
- **~120 files still use `supabase.from()`** for database queries. New repositories use Neon adapter; old routes still on Supabase. Migration is incremental.
- **`pdf-parse` and `mammoth`** are Node-only and will not work on Cloudflare Workers without `nodejs_compat`.

## Migration Status

| Phase | Status | Description |
|-------|--------|-------------|
| Phase 1: Audit | ✅ Done | Full Supabase/Node-only API audit in `docs/neon-cloudflare-audit.md` |
| Phase 2: Strategy | ✅ Done | Hybrid Option A: Neon DB + Supabase Auth/Storage (temp) |
| Phase 3: Schema Plan | ✅ Done | `docs/neon-migration-plan.md` with migration order |
| Phase 4: Data Migration Guide | ✅ Done | `docs/supabase-to-neon-data-migration.md` |
| Phase 5: Neon Adapter | ✅ Done | `src/server/db/neon.ts` + `src/server/db/index.ts` |
| Phase 6: Web Crypto Rewrite | ✅ Done | `secretCrypto.ts` now uses `crypto.subtle` (async) |
| Phase 7: Buffer → Uint8Array | ✅ Done | All file upload routes fixed |
| Phase 8: Cloudflare Config | ✅ Done | `wrangler.toml`, `package.json` scripts |
| Phase 9: Repository Migration | 🚧 Next | Migrate ~120 files from Supabase to Neon adapter |
| Phase 10: Data Export/Import | 🚧 Next | Export Supabase data, import to Neon |
| Phase 11: Cloudflare Preview | 🚧 Next | Run `npm run cf:preview` |
| Phase 12: Auth Independence | ⏳ Future | Replace Supabase Auth with Clerk/Auth.js |
| Phase 13: Storage Independence | ⏳ Future | Replace Supabase Storage with Cloudflare R2 |
| Phase 14: Export Externalization | ⏳ Future | Replace Node-only PDF/DOCX libraries |

## Security Checklist

- [ ] Never commit `.env.local`.
- [ ] Rotate any secrets that were pasted into chat or screenshots.
- [ ] Service role key stays server-side only (never in browser code).
- [ ] AI keys should be added through `/ops` AI key manager or deployment secrets.
- [ ] Admin-only routes are server-side protected (`requireCurrentUser` with `ADMIN_ROLES`).
- [ ] Reviewer role cannot write restricted data (verify via `FALOOD_REVIEWER_ROLES` vs `APPLICATION_WORKER_ROLES`).
- [ ] Application engineer permissions are intentional (can create applications but cannot approve packets).
- [ ] No real API keys in repo.
- [ ] No debug logs with secrets.
- [ ] No full AI key returned in API responses (only fingerprint and last-4).

## Rollback Checklist

- [ ] Database backup before migration run.
- [ ] `supabase db reset` can restore to baseline (destroys data).
- [ ] Git commit hash of last known good deploy recorded.
- [ ] Env vars backed up securely.
- [ ] Rollback to previous Vercel deployment is one-click.

## Local Verification Commands

```bash
npm install
npm run typecheck
npm run build
# ESLint is not installed, so lint will fail — this is expected
```

## Production Environment Checklist

### For Vercel + Supabase (current)
- [ ] All required env vars set in production (Vercel).
- [ ] `CRON_SECRET` set and matches Vercel cron config.
- [ ] `AI_KEYS_ENCRYPTION_SECRET` is 32-byte hex string.
- [ ] Supabase project is on a **paid plan** (required for production).
- [ ] Database backups enabled.

### For Cloudflare + Neon (in progress)
- [ ] Neon project created and migrations applied.
- [ ] All secrets set via `npx wrangler secret put`.
- [ ] `DATABASE_URL` uses pooled connection with `sslmode=require`.
- [ ] `APP_BASE_URL` set to production domain.
- [ ] `nodejs_compat` flag enabled in `wrangler.toml`.
- [ ] Supabase project still active for auth/storage.
- [ ] Cloudflare Pages/Workers deployment configured.
- [ ] Cron jobs migrated from `vercel.json` to Cloudflare Cron Triggers or external scheduler.
- [ ] Neon backups enabled.

## Rollback Checklist

- [ ] Database backup before migration run.
- [ ] `supabase db reset` can restore to baseline (destroys data).
- [ ] Git commit hash of last known good deploy recorded.
- [ ] Env vars backed up securely.
- [ ] Rollback to previous Vercel deployment is one-click.
- [ ] Neon branch from pre-migration point available for rollback.
- [ ] Supabase project remains active as fallback.

- [ ] Login as admin.
- [ ] Open `/ops`.
- [ ] Confirm AI key manager loads.
- [ ] Add/test AI key.
- [ ] Create candidate.
- [ ] Create Quick Application (modal).
- [ ] Paste JD and analyze (`/api/jobs/analyze`).
- [ ] Create job from JD (`/api/jobs/from-jd`).
- [ ] Generate keywords (`/api/applications/[id]/keywords/generate`).
- [ ] Approve keywords.
- [ ] Generate resume suggestions (`/api/applications/[id]/resume-suggestions/generate`).
- [ ] Build resume draft.
- [ ] Export DOCX/PDF.
- [ ] Build packet (`/api/applications/[id]/packet/build`).
- [ ] Generate cover letter (`/api/applications/[id]/packet/cover-letter`).
- [ ] Generate recruiter message (`/api/applications/[id]/packet/recruiter-message`).
- [ ] Save packet.
- [ ] Approve packet (`/api/applications/[id]/packet/approve`).
- [ ] Mark sent (`/api/applications/[id]/packet/mark-sent`).
- [ ] Confirm application queue reflects status.
- [ ] Confirm candidate detail reflects status.
- [ ] Confirm no secrets appear in UI/logs.
- [ ] Confirm build has no env crash.
