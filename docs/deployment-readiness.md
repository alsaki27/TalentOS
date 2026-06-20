# Deployment Readiness Guide

Last updated: 2026-06-22

## Required Environment Variables

| Variable | Required | Source | Notes |
|---|---|---|---|
| `SUPABASE_URL` | Yes | Supabase Dashboard > Settings > API | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Dashboard > Settings > API | Secret key, server-side only |
| `SUPABASE_ANON_KEY` | Yes | Supabase Dashboard > Settings > API | Anon/public key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Same as above | Browser-side |
| `CRON_SECRET` | Yes | Generate random string | Protects `/api/cron/*` routes |
| `AI_KEYS_ENCRYPTION_SECRET` | Yes | Generate 32-byte hex string | AES-256-GCM key for AI key encryption |
| `AI_PROVIDER` | No | `anthropic` or `nvidia` | Optional; falls back to db config |
| `ANTHROPIC_API_KEY` | No | Anthropic Console | Required if `AI_PROVIDER=anthropic` or db config |
| `NVIDIA_API_KEY` | No | NVIDIA API Console | Required if `AI_PROVIDER=nvidia` or db config |

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
- `docx` and `@react-pdf/renderer` libraries are **Node-only**; adapter review needed for Cloudflare Workers migration.
- **No RLS policies** are defined; auth is enforced at the app layer.
- AI features require an active AI provider; routes return **503** if none configured.

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

- [ ] All required env vars set in production (Vercel/Cloudflare/other).
- [ ] `CRON_SECRET` set and matches Vercel cron config.
- [ ] `AI_KEYS_ENCRYPTION_SECRET` is 32-byte hex string.
- [ ] Supabase project is on a **paid plan** (required for production).
- [ ] Database backups enabled.

## Post-Deploy Smoke Test Checklist

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
