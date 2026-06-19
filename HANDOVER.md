# Handover

Single entry point for whoever is taking this project over. Read this first, then
**[STATUS_REPORT.md](./STATUS_REPORT.md)** (point-in-time snapshot: what's done, what's
left, prioritized next steps Ã¢â‚¬â€ written for the team picking this up to deploy), then
[README.md](./README.md) (feature-by-feature reference) and [ROADMAP.md](./ROADMAP.md)
(historical decisions and the *why* behind them). This file was last refreshed
2026-06-19 — includes the Chunk 1 and Chunk 2 application workflow redesign changes.

## There are two backends in this repo Ã¢â‚¬â€ read this before touching anything

1. **`/` (this Next.js app)** Ã¢â‚¬â€ the live, working product. Next.js 14 App Router, plain
   CSS, Supabase (Postgres + Auth + Storage) as a monolith, accessed via the service-role
   key server-side. This is what's actually deployed and in use today.
2. **`/backend`** Ã¢â‚¬â€ a NestJS + TypeORM service, started by the team to migrate off
   Supabase (Postgres stays, but the app layer moves to NestJS, auth moves to Clerk,
   storage moves to SharePoint). **Explicit decision: keep both for now** Ã¢â‚¬â€ this is not a
   cutover in progress, it's two things that exist side by side until the team decides
   otherwise. See "Backend (NestJS) status" below for what's actually been verified there,
   and `backend/MIGRATION.md` for the team's own notes on scope and remaining work.

Don't assume code in one implies the other is current Ã¢â‚¬â€ they're maintained by different
passes and the NestJS side is intentionally a partial port (see its own MIGRATION.md for
the exact module list still missing).

## Status snapshot (this refresh)

- **Frontend** (`/`): package scripts now cover `typecheck`, `lint`, `test`, `build`, and `start`. GitHub Actions CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, lint, and build on push/PR. The latest local verification target is `npm run typecheck`, `npm run lint`, and `npm run build`.
- **Chunk 3 (2026-06-19)**: `POST /api/jobs/from-jd` is live. Parses a pasted JD via AI, runs a three-pass duplicate check (exact URL, exact normalized title+company+location, fuzzy Levenshtein), and creates a `pasted_jd` source job if clean. Maps salary, employment type, seniority, and all AI-extracted fields into the `jobs` table. Webhook + activity logging wired. Gated to `MASTER_DATA_MANAGER_ROLES` (admin/manager/recruiter).
- **Backend** (`/backend`): `npm run typecheck` and `npm run build` both clean. Found and
  fixed a real bug while verifying this: the root `tsconfig.json` had no exclusion for
  `backend/`, so any `tsc --noEmit` run from the repo root was picking up NestJS decorator
  syntax it can't parse and failing with 100+ spurious errors. Fixed by adding `"backend"`
  to the root `exclude` array Ã¢â‚¬â€ if you ever see that error again, check this didn't get
  reverted.
- RLS is enabled on every Supabase table, with **zero policies** anywhere. Intentional Ã¢â‚¬â€
  every frontend route goes through the service-role client, which bypasses RLS, so this
  is a defense-in-depth placeholder, not active access control today.
- This codebase was built by two AI agents (and now a human team) working concurrently in
  the same working tree, no branches. Expect some quirks: two independent rebuilds of
  `/import-sources` early on, a `sql/01_schema.sql` snapshot that lags the real migrations,
  inconsistent comment style. No ongoing reason to preserve that split Ã¢â‚¬â€ treat the whole
  tree as one codebase going forward.

## Schema change note (Chunk 1, 2026-06-19)

The application workflow redesign foundation migration is applied:
`supabase/migrations/20260619020000_chunk1_application_workflow_foundation.sql`

Key changes:
- `applications.job_id` is now **nullable** (was `NOT NULL` with a unique constraint on
  `(candidate_id, job_id)`). A partial unique index preserves the no-duplicate rule for
  masterlist-linked apps while allowing unlimited ad-hoc applications per candidate.
- `applications` new columns: `adhoc_job_data` (JSONB), `adhoc_job_raw_text` (text),
  `source_type` (`base_resume` | `original_resume` | `blank` | `manual`).
- `jobs` new columns: `raw_description`, `parsed_description`, `ai_extracted_at`,
  `ai_confidence_score` — for auto-creating jobs from pasted JDs in future chunks.
- `application_resume_versions` new column: `source_type`.
- New table: `job_duplicates` (for future deduplication engine).

Backward compatibility: all existing workflows (application creation with job_id, resume
studio, jobs list, candidates list) continue working without changes. UI only adds
defensive null handling for nullable `jobs` relations.

## Environment variables — full reference (frontend, `/`)

| Variable | Required for | Status here | Notes |
|---|---|---|---|
| `SUPABASE_URL` | Everything | Ã¢Å“â€¦ set | Project URL from Supabase dashboard Ã¢â€ â€™ Settings Ã¢â€ â€™ API. |
| `SUPABASE_SERVICE_ROLE_KEY` | Everything | Ã¢Å“â€¦ set | Full DB access, bypasses RLS. Never expose client-side, never commit. |
| `NVIDIA_API_KEY` / `NVIDIA_MODEL` | `/chat`, AI digest | Ã¢Å“â€¦ set | Live-tested. See "AI provider" below for its known limitation. |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Login (`/api/auth/login`) | not set | Required for password login; use the anon/publishable key from Supabase Project Settings > API. |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | `/chat`, AI digest (preferred provider) | Ã¢ÂÅ’ not set | Preferred over NVIDIA automatically once set Ã¢â‚¬â€ see "AI provider" below for why. |
| `AI_PROVIDER` | optional override | Ã¢ÂÅ’ not set | `anthropic` or `nvidia`, forces a choice when both are set. |
| `CRON_SECRET` | Scheduled jobs (`/api/cron/*`) | Ã¢ÂÅ’ not set | **Without this, scheduled cron jobs 401 silently, every day, forever.** Highest-impact missing config for a real deploy. |
| `USAJOBS_API_KEY` / `USAJOBS_USER_AGENT` | USAJobs import | Ã¢ÂÅ’ not set | Free key from developer.usajobs.gov. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_OAUTH_REDIRECT_URI` | Gmail integration | Ã¢ÂÅ’ not set | See `docs/integrations.md` for the full OAuth setup. |
| `TEAMS_TALENT_OS_WEBHOOK_URL` | Outbound Teams notifications | Ã¢ÂÅ’ not set | No-ops cleanly (not an error) when absent. |
| `TALENT_OS_WEBHOOK_SECRET` | Inbound webhook | Ã¢ÂÅ’ not set | Fails closed (401) without it. |
| `CRAWLER_API_KEY` | Job crawler ingestion (`/api/integrations/crawler/jobs`, `/heartbeat`) | Ã¢ÂÅ’ not set | Bearer shared secret for an external crawler bot. Live-tested with a temporary local value Ã¢â‚¬â€ dedup, auth, and real-time push all confirmed working; reverted before handover. |
| `RESUME_STORAGE_PROVIDER` | Resume upload backend | Ã¢ÂÅ’ not set (defaults to `supabase`) | **You'll be setting this to `sharepoint`** Ã¢â‚¬â€ see the dedicated section below before you do. |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT_ID` / `SHAREPOINT_SITE_ID` / `SHAREPOINT_DRIVE_FOLDER` | SharePoint resume storage | Ã¢ÂÅ’ not set | See "Switching resume storage to SharePoint" below Ã¢â‚¬â€ required reading before flipping `RESUME_STORAGE_PROVIDER`. |

`.env.example` now exists for the frontend. Keep it in sync whenever a new environment variable is introduced.

## Cloud Supabase setup checklist

Use this path for local development against the cloud Supabase project:

1. Create `.env.local` from `.env.example`.
2. In the Supabase dashboard, open **Project Settings > API**:
   - Copy **Project URL** to `SUPABASE_URL`.
   - Copy the **anon / publishable key** to both `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - Copy the **service_role / secret key** to `SUPABASE_SERVICE_ROLE_KEY`. Never expose this client-side and never commit it.
3. Apply migrations from this repo:
   ```bash
   npx supabase db push
   ```
   The source of truth is `supabase/migrations/`, not `sql/01_schema.sql`.
4. Verify first-run readiness:
   ```bash
   npm run setup:check
   ```
5. Create the first internal user in Supabase **Authentication > Users** and set their password there.
6. Create or update that user's TalentOS profile:
   ```bash
   npm run seed:admin
   ```
   The default email is `admin@skarion.local`; set `ADMIN_EMAIL=you@example.com` in `.env.local` to target a different existing Auth user.
7. Start the app, check `GET /api/health`, then log in at `/login` and verify `/jobs` and `/candidates` load.
## Switching resume storage to SharePoint Ã¢â‚¬â€ what you actually need

You said you'll use your team's real SharePoint as storage. The code
(`src/lib/integrations/sharepoint.ts`, `src/lib/resumeStorage.ts`) is built and was
tested as far as it honestly could be in this environment: confirmed the default
(Supabase) path is unchanged, and confirmed SharePoint mode fails with a clear,
specific error (e.g. "MS_TENANT_ID is required") rather than crashing or silently no-op'ing
when credentials are missing. **What was not tested: a real upload/download against an
actual SharePoint tenant** Ã¢â‚¬â€ there was no Microsoft 365 tenant available in this
environment to test against. Before relying on it:

1. **Register an Azure AD app** (Azure Portal Ã¢â€ â€™ App registrations Ã¢â€ â€™ New registration).
   Note the **Application (client) ID** and **Directory (tenant) ID** Ã¢â‚¬â€ these become
   `MS_CLIENT_ID` and `MS_TENANT_ID`.
2. **Create a client secret** under that app (Certificates & secrets) Ã¢â‚¬â€ this becomes
   `MS_CLIENT_SECRET`. It expires (you choose 6/12/24 months) Ã¢â‚¬â€ whoever owns this needs a
   calendar reminder to rotate it before expiry, or uploads will start failing with a
   clear auth error (not silently).
3. **Grant Microsoft Graph application permissions**: `Sites.ReadWrite.All` (or
   `Files.ReadWrite.All` if scoping to one drive). This requires **admin consent** Ã¢â‚¬â€ your
   M365 tenant admin has to click "Grant admin consent" in the Azure portal once.
4. **Find your `SHAREPOINT_SITE_ID`** Ã¢â‚¬â€ the Graph API site identifier (not the site URL).
   Easiest path: `GET https://graph.microsoft.com/v1.0/sites/{your-tenant}.sharepoint.com:/sites/{site-name}`
   with a valid Graph token, and read the `id` field from the response.
5. Set `RESUME_STORAGE_PROVIDER=sharepoint` plus the four vars above. **Test with one real
   upload through `/candidates/[id]` before trusting it in production** Ã¢â‚¬â€ this is the one
   piece of this handover that genuinely needs a human with real Microsoft 365 access to
   validate, since no AI agent in this loop had that access.
6. **Known limitation, not yet handled**: `src/lib/storage.ts`'s `deleteStorageFile()` only
   knows how to clean up Supabase Storage URLs Ã¢â‚¬â€ it silently no-ops on a SharePoint URL
   (doesn't error, but doesn't delete the file either). If you switch to SharePoint, old
   resumes that get replaced will leak as orphaned files in your SharePoint drive until
   someone adds a SharePoint-aware delete path. Not a security issue, just a slow-drip
   storage-quota one.

## AI provider Ã¢â‚¬â€ the one nuance worth understanding before touching `/chat`

Two providers behind one interface (`src/lib/ai/provider.ts`): `anthropicProvider.ts` and
`nvidiaProvider.ts`. Only NVIDIA has ever been live-tested here (no Anthropic key was ever
available). Confirmed across 6+ live request variations: NVIDIA's `moonshotai/kimi-k2.6`
reliably calls a tool, but degenerates into repeated tokens a meaningful fraction of the
time right after consuming the tool's result. Reliable for single-shot generation (no
tool result to consume) Ã¢â‚¬â€ that's why the daily digest uses single-shot, not tool-calling.
Two mitigations exist (penalty params + a `looksDegenerate()` fallback) but they reduce
the failure rate, not eliminate it. **Prefer Anthropic once a key exists** Ã¢â‚¬â€
`getActiveProvider()` already picks it first automatically, no code change needed.

## Security audit findings (frontend)

- **Auth is sound.** `src/middleware.ts` blocks every route except an explicit allowlist
  behind a verified Supabase session cookie. Two routes that look unguarded because they
  live under the exempted `/api/auth/*` prefix (`password`, `me`) independently call
  `getCurrentUserContext()` and 401 without a session Ã¢â‚¬â€ not actually open.
- **Webhooks and bot-facing endpoints fail closed.** Gmail OAuth, the TalentOS inbound
  webhook, and the job-crawler ingestion/heartbeat endpoints all reject every request when
  their secret env var is unset, rather than allowing access. Confirmed by reading the
  check in each, not assumed.
- **New: a scoped public API key system** (`src/lib/publicApiAuth.ts`,
  `/api/api-keys` for admin-only key management, `/api/public/*` for ~20 scoped routes
  covering candidates/jobs/applications/companies/events/reminders/analytics). Reviewed
  and it's solid: keys are SHA-256 hashed at rest (never stored or logged raw), scope-based
  per-route authorization (`candidates:read` vs `jobs:write` etc., not all-or-nothing),
  expiry + revocation supported, `last_used_at` tracked, key creation audit-logged, request
  bodies go through an explicit field allowlist (`pickFields()`) rather than blind
  mass-assignment. This is a reasonable integration surface for the NestJS backend or any
  external tool to use instead of (or alongside) direct DB access.
- **Role gating is now mostly implemented for the highest-risk paths.** The app gates admin/team/audit/ops routes, public API key management, master-data writes, destructive candidate/job/application actions, assignment changes, and application-engineer queue visibility. Remaining work is policy refinement and edge-case review, not a complete absence of role checks.
- **Candidate self-login is still not implemented.** The candidate-facing experience is the magic-link portal, not an account/session dashboard.
- **Gmail intelligence is still not implemented.** OAuth/linking exists, but classification of rejections, recruiter replies, interview invites, and status updates from email does not.
- **Resume tailoring now exists for editable markdown drafts.** Admins/managers/recruiters can generate a tailored draft from a candidate base resume and job, save it as an `application_resume_versions` variant, and attach it to an application packet. Cover-letter generation and deeper automated truth scoring remain future work.
- **RLS has no policies** Ã¢â‚¬â€ not a vulnerability today (nothing uses the anon key against
  the DB directly), but don't mistake it for active protection if that ever changes.

## Backend (NestJS, `/backend`) status

Verified by re-running its own build tooling (not the frontend's) on 2026-06-18:

- `npm run typecheck` and `npm run build` both pass cleanly.
- Spot-checked entities against the **live** Supabase schema: `candidates`, `jobs`,
  `profiles`, `application_comments` (including the `parent_comment_id` threaded-reply
  column added this session), and `job_crawler_status` (the table added this session) all
  match field-for-field. The team's own pass is staying in sync with frontend schema
  changes, which is a good sign for two people working on related things in parallel.
- `AuthorizationService.assertApplicationVisibility()` correctly ports the exact
  application-engineer visibility rule from the live app (only see tickets assigned to
  you, by id/email/display-name match).

**Three real things to know before this goes anywhere near production data:**

1. **Every entity carries `is_deleted`/`deleted_at` via `BaseEntity` Ã¢â‚¬â€ no live Supabase
   table has those columns today.** Pointing this backend at the actual production
   database will fail on any query touching those columns until a migration adds them.
   There's no `src/database/migrations` folder yet Ã¢â‚¬â€ only `TYPEORM_SYNCHRONIZE`, which the
   team's own `.env.example` notes correctly mark "only acceptable for throwaway local
   databases." Don't run this against real data with synchronize on.
2. **Auth provider is switching from Supabase Auth to Clerk**, and `profiles`' primary key
   shape is changing (`user_id` = `auth.users.id` Ã¢â€ â€™ a new generated `id` + separate
   `clerk_user_id` column). Self-acknowledged in `backend/MIGRATION.md` as needing a
   one-time user-mapping script. No existing account can log into this backend until that
   script exists and runs.
3. **Most of the app isn't ported yet**, by the team's own list in `backend/MIGRATION.md`:
   import sources/runs, saved searches, Gmail/Teams/TalentOS integrations, job crawler
   ingestion (built and live-tested on the frontend this session Ã¢â‚¬â€ see README.md), AI
   chat/digests, analytics, follow-ups, candidate portal, file storage. Implemented so far:
   profiles, candidates, jobs, companies, applications, public-api-keys.

## Cost-efficient deployment Ã¢â‚¬â€ recommendations

Researched current (2026) pricing rather than assumed. Sources at the bottom.

**Recommended baseline for a small internal team:**

| Piece | Recommendation | Est. cost/mo |
|---|---|---|
| Frontend hosting | Vercel | $0 (Hobby) if usage stays personal/low-key, or **$20/seat (Pro)** Ã¢â‚¬â€ Vercel's Hobby tier is licensed for non-commercial use; an internal company tool used by paid staff is commercial use, so Pro is the compliant choice once this is a real team tool, not a side project. |
| Frontend cron jobs | Already daily-only (`vercel.json`: import, backup, digest, job categorization) | $0 extra Ã¢â‚¬â€ Hobby restricts cron to once-daily schedules anyway, and this app never needed more than that, so no upgrade is forced by cron alone. Per-project cron limit was raised to 100 on every plan in Jan 2026, well above the cron entries this app uses. |
| Database | **Keep the existing Supabase project** | $0 (Free tier: 500MB DB, 1GB storage, 50k MAUs) until you outgrow it, then $25/mo (Pro: 8GB DB, 100GB storage). Don't provision a second Postgres for the NestJS backend Ã¢â‚¬â€ point its `DATABASE_URL` at the same Supabase Postgres instance via its direct connection string (Settings Ã¢â€ â€™ Database Ã¢â€ â€™ Connection string), through the **pooler** connection (PgBouncer, included free) rather than the direct one, to stay well within the 60-direct/200-pooled connection limit on the free tier. |
| NestJS backend hosting (compute only) | **Fly.io** (cheapest, sub-$2/mo for a small shared-CPU VM, pay-as-you-go) or **Railway** (simpler DX, $5/mo Hobby plan, usage-based) | $2Ã¢â‚¬â€œ5/mo |
| Auth (if/when Clerk migration completes) | Clerk | $0 Ã¢â‚¬â€ free tier now covers 50,000 monthly active users (raised from 10k in 2026), comfortably covers an internal team + candidate logins for a long time. |
| Resume storage | SharePoint (your existing M365 subscription) | $0 incremental Ã¢â‚¬â€ Graph API calls aren't separately billed; storage comes out of your existing SharePoint quota. |

**Realistic total: $2Ã¢â‚¬â€œ7/month** if you stay on free tiers where eligible (Supabase Free,
Clerk Free, Vercel Hobby if usage permits) plus cheap backend compute. **$25Ã¢â‚¬â€œ32/month** if
you need Vercel Pro for commercial-use compliance and/or outgrow Supabase's free tier. Both
are inexpensive for what this app does Ã¢â‚¬â€ the actual cost driver to watch is Supabase
storage/database size as job-posting volume grows (LinkedIn imports can add up), not
compute.

**One sequencing note:** don't pay for a second Postgres instance for the NestJS backend
"just to get started" Ã¢â‚¬â€ reusing the Supabase Postgres connection string is both cheaper
and avoids a future data-migration step between two live databases.

Sources:
- [Vercel Cron Jobs Ã¢â‚¬â€ Usage & Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Pricing](https://vercel.com/pricing)
- [Cron jobs now support 100 per project on every plan](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan)
- [Railway vs Render vs Fly.io for Solo Developers in 2026](https://devtoolpicks.com/blog/railway-vs-render-vs-fly-io-solo-developers-2026)
- [Fly.io vs Railway 2026](https://thesoftwarescout.com/fly-io-vs-railway-2026-which-developer-platform-should-you-deploy-on/)
- [Supabase Pricing](https://supabase.com/pricing)
- [Supabase Free Tier Limits 2026](https://aiagencyplus.com/supabase-free-tier-limits/)
- [Clerk Pricing](https://clerk.com/pricing)
- [Clerk Pricing Update Ã¢â‚¬â€ 50k Free MAU](https://saasprices.net/blog/clerk-free-plan-changes)

## Operational runbook (frontend)

- **First login on a fresh deploy**: no self-serve signup. Create the first user via
- **First login on a fresh deploy**: no self-serve signup and no auto-promotion. Create
  the first user in Supabase Authentication, then run `npm run seed:admin` to create or
  update the matching `profiles` row before logging in at `/login`.
  silently forever. Single highest-impact missing config right now.
- **`npm run build` clobbers `.next`**, which `npm run dev` also uses Ã¢â‚¬â€ `rm -rf .next` and
  restart the dev server after any production build.
- **Migrations**: `supabase/migrations/*.sql`, applied in order via `npx supabase db push`.
  `sql/01_schema.sql` is a convenience snapshot, not the source of truth Ã¢â‚¬â€ the migrations
  folder is.
- **Backups**: daily JSON snapshot to Supabase Storage (needs `CRON_SECRET`), plus an on-demand download on `/ops`. `src/lib/backup.ts` has restore helper functions (`parseBackupSnapshot`, `loadStoredBackupSnapshot`, `restoreBackupSnapshot`), and `/api/ops/restore` plus `/ops` provide an admin-only restore workflow. Restore upserts records and is not a full point-in-time database rollback.
- **Deployment path**: Vercel + Supabase is the current architecture. Supabase remains database/auth/default storage. Cloudflare full-stack hosting is not configured; D1/R2 migration is not part of the current architecture.

## Full route inventory (confirmed via build output)

23 page routes, 65+ API routes on the frontend (grew from ~60 with the public API key
system and job crawler routes this session). See README.md for what each feature does;
see "Backend status" above for what's mirrored in `/backend` so far.

## Where to go next

Read **[STATUS_REPORT.md](./STATUS_REPORT.md)** for the prioritized punch list. Read
ROADMAP.md's "Next up" and "Explicitly deferred" sections before re-deciding something
already deliberately scoped out Ã¢â‚¬â€ the reasoning for each deferral is written down, not
just the decision.
