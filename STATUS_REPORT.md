# Status Report — 2026-06-18

Written for the team picking this up to deploy. Read [HANDOVER.md](./HANDOVER.md) first
for the technical reference (env vars, security audit, architecture); this file is the
point-in-time summary of where things stand and what to do next, in priority order.

## Executive summary

The frontend (Next.js + Supabase) is a working, feature-complete internal recruiting tool
— candidates, jobs, applications, AI assistant, analytics, integrations, all live-tested
and building cleanly. A separate NestJS backend was started in parallel to eventually move
off Supabase (to Clerk auth + a portable Postgres + SharePoint storage), and is currently a
**first slice, not a replacement** — about 6 of ~20 modules are ported, and there's no path
yet to point it at real production data without a few real risks (detailed below). Both are
being kept; nothing is being torn down. The most urgent thing before any deploy is **setting
`CRON_SECRET`** — without it, three daily scheduled jobs (import, backup, AI digest) will
silently never run.

## What's live and working today (frontend, `/`)

- Full candidate/job/application tracker with resume variants, follow-up automation, status
  timeline, priority/review workflow, audit log.
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

All of the above: `npx tsc --noEmit` clean, `npm run build` clean, all migrations applied
and in sync with the live database.

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
   import/backup/digest jobs 401 silently forever. Free to set — any random string.
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

1. **Role-based action gating** — most mutations (assigning tickets, deleting jobs/
   candidates) aren't restricted by role yet. This needs a product decision on policy
   before implementation, not just engineering time — see ROADMAP.md's "Next up" list.
2. **UI wiring for threaded comment replies** — the data model and API support replies
   (`parent_comment_id`) since this session, but `candidates/[id]` and `jobs/[id]` don't
   render the thread structure yet. Deferred because both pages had large uncommitted
   diffs from concurrent work at the time; safe to pick up once that settles.
3. **Candidate self-login dashboard** — scoped in [docs/candidate-self-login.md](./docs/candidate-self-login.md)
   but not built. Real auth/role-model decision needed first (see that doc for the exact
   tradeoffs) — not a quick add.
4. **Backend migration continuation** — the team's own next-module list in
   `backend/MIGRATION.md` is accurate and already prioritized; no need to re-derive it here.
5. **SharePoint delete cleanup** — `deleteStorageFile()` only knows how to clean up
   Supabase Storage URLs today; switching to SharePoint means replaced/deleted resumes will
   leak as orphaned files until someone adds a SharePoint-aware delete path. Low urgency
   (storage-quota drip, not a security or correctness issue), but worth a ticket.
6. **USAJobs import** — wired but never live-tested end-to-end (no API key was ever
   available in any environment this was built in). Low priority unless USAJobs is an
   active sourcing channel.

## Known risks / gaps (carried forward, still true)

- RLS is enabled with zero policies on every Supabase table — fine today since nothing
  queries with the anon key, but don't mistake it for active protection if that changes.
- No pagination on candidates/application-queue/follow-ups lists — fine at current scale
  (hundreds of rows), will need the same server-side-pagination treatment `/jobs` already
  got once any of them approaches ~1,000 rows.
- Two AI providers exist; only NVIDIA has ever been live-tested, and it has a known,
  mitigated-but-not-eliminated reliability issue on multi-turn tool calls. Prefer Anthropic
  once a key exists.

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
