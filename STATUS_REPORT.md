# Status Report — 2026-06-19

Written for the team picking this up to deploy. Read [HANDOVER.md](./HANDOVER.md) first
for the technical reference (env vars, security audit, architecture); this file is the
point-in-time summary of where things stand and what to do next, in priority order.

## Executive summary

The frontend (Next.js + Supabase) is a working internal recruiting/placement tool —
candidates, jobs, applications, AI assistant, analytics, integrations, application proof
upload, paginated operational queues, and CI-backed build checks. The docs were refreshed
after the latest hardening pass so they match the code rather than the older audit notes.
A separate NestJS backend was started in parallel to eventually move
off Supabase (to Clerk auth + a portable Postgres + SharePoint storage), and is currently a
**first slice, not a replacement** — about 6 of ~20 modules are ported, and there's no path
yet to point it at real production data without a few real risks (detailed below). Both are
being kept; nothing is being torn down. Do not start or extend the NestJS migration unless
that is explicitly requested. The most urgent thing before any deploy is **setting
`CRON_SECRET`** — without it, scheduled jobs (import, backup, digest, categorization/email
queue depending on deployed config) will
silently never run.

## What's live and working today (frontend, `/`)

- Full candidate/job/application tracker with resume variants, follow-up automation, status
  timeline, priority/review workflow, audit log.
- Root package scripts now include `typecheck`, `lint`, `test`, `build`, and `start`, and
  GitHub Actions CI runs `npm ci`, typecheck, lint, and build on push/PR.
- `.env.example` now exists for the frontend and covers Supabase, cron, crawler, AI,
  Gmail, Teams, SharePoint, USAJobs, and storage-provider variables.
- Candidates, application queue, and follow-ups now use paginated/filterable API responses
  instead of relying on the old unbounded list pattern.
- Role-based action gating is now mostly implemented for day-to-day risk areas:
  master-data writes, assignment edits, destructive deletes, public API key management,
  admin/team/audit/ops routes, and application-engineer scoping. It is still app-layer
  gating via middleware/auth helpers, not complete Supabase RLS policy coverage.
- Application proof upload exists at `POST /api/applications/[id]/proof`; it stores a proof
  artifact, records `application_proofs`, updates the application's latest proof metadata,
  and logs activity.
- AI job categorization exists (`src/lib/ai/jobCategorization.ts`) with processing routes
  and cron support. This is separate from `/chat` and the daily digest.
- Resume tailoring workflow now exists: admins/managers/recruiters can generate an
  editable markdown draft from a candidate base resume and target job, save it as an
  `application_resume_versions` variant, and attach it to an application packet.
- Companies directory, saved job searches, per-user notifications feed.
- AI data assistant (`/chat`) and a daily AI digest — both live-tested against the real
  NVIDIA-hosted model, with a documented, mitigated reliability issue (see HANDOVER.md).
- Scheduled multi-source job ingestion (Greenhouse/Lever/Ashby/USAJobs/career pages) plus,
  new this session, **live crawler-bot ingestion** with real-time push to `/ops` (Supabase
  Realtime + Server-Sent Events) — live-tested end to end: dedup confirmed, auth confirmed,
  real-time event delivery confirmed against the live database.
- Gmail OAuth linking, Microsoft Teams relay, TalentOS inbound webhook — all documented in
  `docs/integrations.md`, all wired and ready, none have real credentials configured yet.
- A scoped, audited public API key system (`/api/public/*`, ~20 routes) — a clean
  integration surface for the NestJS backend or any external tool, without needing direct
  database access.
- **Pluggable resume storage (Supabase default, SharePoint optional)** — built this
  session specifically because you said SharePoint is your real target. Code is solid and
  tested as far as possible without real Microsoft 365 credentials (default path unchanged,
  failure path is clear and specific). **Real upload/download against your actual tenant is
  the one piece that needs a human with Microsoft 365 access to validate** — see
  HANDOVER.md's "Switching resume storage to SharePoint" section for the exact setup steps.

Latest local validation target: `npm run typecheck`, `npm run lint`, and `npm run build`.

## What's in progress (backend, `/backend`)

A NestJS + TypeORM service, intended to eventually replace the Supabase-backed app layer
while keeping the same underlying data. Verified this session: builds and typechecks
cleanly on its own, and the entities that exist accurately mirror the live schema
(including two things added to the frontend just this session — confirms the two efforts
are staying in sync, not drifting).

**Ported so far:** profiles, candidates, jobs, companies, applications, public API keys.

**Not yet ported** (by the team's own list in `backend/MIGRATION.md`): import sources/runs,
saved searches, Gmail/Teams/TalentOS integrations, job crawler ingestion, AI chat/digests,
analytics, follow-ups/reminders, candidate portal, file storage adapter.

## Critical path before any production deploy

In priority order — these aren't equally urgent, ordered by impact if skipped:

1. **Set `CRON_SECRET`** (frontend, both locally and in Vercel). Without it, scheduled
   cron jobs 401 silently forever. Free to set — any random string.
2. **Bootstrap the first admin account** if this is a fresh deploy — no self-serve signup
   exists. See HANDOVER.md's operational runbook.
3. **Decide the SharePoint cutover timing.** The code is ready; a real human with Microsoft
   365 admin access needs to register the Azure AD app, grant Graph API permissions, and
   test one real upload before `RESUME_STORAGE_PROVIDER=sharepoint` goes live anywhere that
   matters. Until then, the default (Supabase Storage) keeps working unchanged — there's no
   urgency to flip the switch before it's actually verified.
4. **If the NestJS backend will touch real data anytime soon**, two things need solving
   first, not worked around: (a) every entity expects `is_deleted`/`deleted_at` columns that
   don't exist on any live table yet — needs a real migration, not `TYPEORM_SYNCHRONIZE`
   against production; (b) the Clerk auth migration needs a one-time script mapping existing
   Supabase Auth users to Clerk accounts before anyone currently in `profiles` can log into
   the new backend.
5. **Decide on Vercel plan.** Hobby is free but licensed for non-commercial use; an internal
   company tool used by paid staff is commercial use under Vercel's terms. Pro is $20/seat —
   see HANDOVER.md's cost section for the full breakdown and why it's still cheap overall.

## Prioritized next steps (not blocking deploy, but next in line)

1. **Candidate self-login dashboard** — scoped in [docs/candidate-self-login.md](./docs/candidate-self-login.md)
   but not built. The current portal is still magic-link based, not account/session based.
2. **Gmail intelligence/email classification** — Gmail OAuth/linking exists, but rejection
   detection, reply classification, interview invite detection, follow-up task creation,
   and automatic application status updates from email are still not implemented.
3. **Cover-letter generation / deeper tailoring QA** — resume tailoring now covers
   editable markdown resume drafts and application-packet attachment. Cover letters,
   automated truth scoring, and richer approval workflows are still future work.
4. **UI wiring for threaded comment replies** — the data model and API support replies
   (`parent_comment_id`) since this session, but `candidates/[id]` and `jobs/[id]` don't
   render the thread structure yet. Deferred because both pages had large uncommitted
   diffs from concurrent work at the time; safe to pick up once that settles.
5. **Backend migration continuation** — the team's own next-module list in
   `backend/MIGRATION.md` is accurate and already prioritized; no need to re-derive it here.
6. **SharePoint delete cleanup** — `deleteStorageFile()` only knows how to clean up
   Supabase Storage URLs today; switching to SharePoint means replaced/deleted resumes will
   leak as orphaned files until someone adds a SharePoint-aware delete path. Low urgency
   (storage-quota drip, not a security or correctness issue), but worth a ticket.
7. **USAJobs import** — wired but never live-tested end-to-end (no API key was ever
   available in any environment this was built in). Low priority unless USAJobs is an
   active sourcing channel.

## Known risks / gaps (carried forward, still true)

- RLS is enabled with zero policies on every Supabase table — fine today since nothing
  queries with the anon key, but don't mistake it for active protection if that changes.
- Candidate self-login is still not built; `/portal/<token>` remains the candidate-facing
  path.
- Gmail intelligence/email classification is still not built; OAuth is only the connection
  layer.
- Resume tailoring exists for editable markdown resume drafts, but cover-letter generation
  and deeper automated truth/fit scoring are still not built.
- Backup restore now has an admin API/UI workflow, but it is an upsert restore, not a full
  point-in-time database rollback.
- Two AI providers exist; only NVIDIA has ever been live-tested, and it has a known,
  mitigated-but-not-eliminated reliability issue on multi-turn tool calls. Prefer Anthropic
  once a key exists.
- Current deployment is Vercel + Supabase. Cloudflare full-stack hosting is not configured;
  D1/R2 migration is not part of the current architecture.

## Deployment readiness checklist

- [ ] `CRON_SECRET` set in Vercel
- [ ] First admin account bootstrapped
- [ ] Vercel plan decided (Hobby vs. Pro — see cost section in HANDOVER.md)
- [ ] Supabase plan checked against current data volume (Free tier likely fine to start)
- [ ] SharePoint Azure AD app registered + Graph permissions granted + one real upload
      tested, *before* flipping `RESUME_STORAGE_PROVIDER=sharepoint` anywhere it matters
- [ ] If deploying the NestJS backend anywhere near real data: soft-delete columns added
      via a real migration, and the Clerk user-mapping script written and run
- [ ] `ANTHROPIC_API_KEY` obtained if `/chat` reliability matters (optional, but
      recommended over the current NVIDIA-only setup)
