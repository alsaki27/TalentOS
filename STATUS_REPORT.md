# Status Report — 2026-06-19

Written for the team picking this up to deploy. Read [HANDOVER.md](./HANDOVER.md) first
for the technical reference (env vars, security audit, architecture); this file is the
point-in-time summary of where things stand and what to do next, in priority order.

## Recent update (2026-06-19)

**Chunk 1: Application workflow redesign — database foundation**

Schema changes landed (migration `20260619020000_chunk1_application_workflow_foundation.sql`):
- `applications.job_id` is now **nullable**, enabling ad-hoc applications without a masterlist job.
- `applications` gains `adhoc_job_data` (JSONB), `adhoc_job_raw_text` (text), and `source_type`
  (`base_resume` | `original_resume` | `blank` | `manual`) — supports the future quick-application
  workflow where AE pastes a JD directly without pre-creating a job.
- `jobs` gains `raw_description`, `parsed_description` (AI-extracted), `ai_extracted_at`,
  `ai_confidence_score` — foundation for auto-creating jobs from pasted JDs.
- `application_resume_versions` gains `source_type` — tracks whether a tailored resume was built
  from a base resume, the candidate's original upload, a blank template, or manual entry.
- New `job_duplicates` table for future deduplication engine.

API backward compatibility preserved: existing application creation (with `job_id`), existing
resume tailoring, existing jobs list — all continue working exactly as before. No UI redesign
in this pass; only defensive null handling for nullable `jobs` relations.

**Chunk 2: JD Analyzer API (parse-only)**

New endpoint: `POST /api/jobs/analyze`
- Accepts raw job description text (100–30,000 chars).
- Returns structured JSON analysis via configured AI provider (Anthropic preferred, NVIDIA fallback).
- Output: title, company, location, workplace type, employment type, required/preferred skills,
  tools, responsibilities, seniority level, years experience, salary range, domain keywords,
  soft skills, ATS keywords, visa signals, red flags (with severity), fit summary, confidence score.
- Returns **503** if no AI provider is configured. Returns **401** for unauthenticated users.
- Returns **403** for `reviewer` role (not in `APPLICATION_WORKER_ROLES`).
- Does **not** create or update any database rows — pure parse-only.
- Activity is logged to `activity_logs` on successful analysis.

Files added:
- `src/lib/ai/falood/jdAnalyzer.ts` — AI service with full validation/sanitization of JSON output.
- `src/app/api/jobs/analyze/route.ts` — API route with role checks, input validation, clean error handling.

**Chunk 3: Auto-create Job from Pasted JD + duplicate detection**

New endpoint: `POST /api/jobs/from-jd`
- Accepts raw JD text (100–30,000 chars) and optional `sourceUrl`, `forceCreate`, `useExistingJobId`.
- Calls the AI analyzer (`analyzeJD`) to extract structured data.
- Performs **duplicate detection** in three passes: exact `source_url` match, exact normalized title+company+location match, and fuzzy Levenshtein match (title ≥ 0.90, company ≥ 0.86, location ≥ 0.86).
- Returns **409** if potential duplicates are found, unless `forceCreate: true`.
- Returns **422** if the AI cannot extract a job title.
- Returns **503** if no AI provider is configured.
- On success, inserts a new `jobs` row with `source = 'pasted_jd'`, `raw_description`, `parsed_description`, `ai_extracted_at`, `ai_confidence_score`, and all mapped fields (salary, employment type, seniority level, etc.).
- Calls `syncCompanyDirectoryFromJobs`, `logActivity`, and `triggerWebhooks("job.created", ...)` on success.
- Authorization: `MASTER_DATA_MANAGER_ROLES` (admin/manager/recruiter) — reviewers and application engineers cannot create masterlist jobs via this endpoint.

Files added/modified:
- `src/app/api/jobs/from-jd/route.ts` — full workflow endpoint with mapping, dedup, and webhook triggers.
- `src/lib/jobDedup.ts` — extended with `findPotentialDuplicateJobs()` for the new duplicate detection flow.

**Chunk 3.5: Portability guardrails + Admin AI API key manager**

New data-access abstractions prevent future feature chunks from deepening Supabase lock-in:
- `src/server/repositories/jobsRepository.ts` — `findJobById`, `createJobFromParsedJD`, `findPotentialDuplicateJobs`, `listJobsForDedupe`. The `from-jd` route now uses this instead of direct `supabase.from("jobs")` calls.
- `src/server/repositories/aiKeyRepository.ts` — `listAiKeys`, `listEnabledAiKeys`, `createAiKey`, `updateAiKey`, `disableAiKey`, `recordAiKeySuccess`, `recordAiKeyFailure`.
- `src/server/security/secretCrypto.ts` — AES-256-GCM encryption for API keys. Uses Node crypto today; documented for Cloudflare Web Crypto migration.
- `src/server/services/aiProvider.ts` — `buildProviderFromDbKey`, `testAiKey`, `getEnabledAiKeys`, `getActiveProviderWithFallback`.

Admin AI API key manager (admin-only):
- `GET /api/admin/ai-keys` — list all keys (metadata only, never decrypted).
- `POST /api/admin/ai-keys` — add a new key. Encrypts with `AI_KEYS_ENCRYPTION_SECRET`. Returns 503 if encryption secret is missing.
- `PATCH /api/admin/ai-keys/[id]` — update label, priority, is_enabled, or replace key.
- `DELETE /api/admin/ai-keys/[id]` — soft-disable (sets `is_enabled=false`, `status='disabled'`).
- `POST /api/admin/ai-keys/[id]/test` — sends a tiny test request, updates health status.
- Admin UI panel on `/ops` — full CRUD table with status badges, test buttons, inline editing, add form with password input.

AI fallback integration:
- `getActiveProviderAsync()` in `src/lib/ai/index.ts` — tries env-based keys first, then falls back to DB-managed keys by priority.
- `analyzeJD()` now uses `getActiveProviderAsync()` for DB fallback support.
- Env-based keys remain primary; DB keys are additional backups.
- Provider adapters implemented for `anthropic` and `nvidia`. Others (openai, google, groq, etc.) return "Provider adapter not implemented" cleanly.

Migration readiness:
- `docs/migration-neon-cloudflare.md` — documents current state, target architecture, abstraction rules, Cloudflare compatibility notes, Neon notes, and recommended migration sequence.
- New env var: `AI_KEYS_ENCRYPTION_SECRET` (required for admin key manager).

Typecheck: clean. Build: fails on pre-existing missing Supabase env vars only.

**Chunk 4: Quick Application Modal**

New global "+ New Application" button in the nav bar, visible to `APPLICATION_WORKER_ROLES`
(admin, manager, recruiter, application_engineer). Reviewers are excluded. Opens a 4-step modal
that uses existing API routes only (no direct Supabase calls in client code):

1. **Candidate selection**: Searchable list from `GET /api/candidates?compact=1`. Click to select.
2. **Paste JD**: Textarea + optional source URL. "Auto-Analyze" calls `POST /api/jobs/analyze`.
   Preview card shows title, company, location, workplace type, employment type, seniority,
   salary, confidence score, required/preferred skills, and red flags. Clean error messages for
   400 (short JD), 401 (unauthenticated), 403 (not allowed), 503 (no AI provider), 502 (AI failed).
3. **Review Job**: "Create Job" calls `POST /api/jobs/from-jd`. On 409 duplicate, shows duplicate
   jobs with "Use existing" or "Force create new" options. On 422, asks for a clearer JD.
4. **Create Application**: Resume source selector (Base/Original/Blank/Manual), status selector
   (default: Stacked), notes, optional assignment. Calls `POST /api/applications`. On 409 duplicate
   application, shows link to candidate. Success shows links to candidate, job, and queue.

Ad-hoc path: user can skip creating a masterlist job and create an ad-hoc application with
`adhoc_job_data` + `adhoc_job_raw_text` instead of `job_id`.

Files added:
- `src/components/QuickApplicationModal.tsx` — full 4-step modal component.
- Modified `src/app/NavBar.tsx` — added "+ New Application" button with role gating.

Does not yet implement: full resume source switching in studio, keyword approval,
ATS suggestions, or cover letter generation.

**Not yet implemented (Chunk 5+):**
- Full resume source selector with studio integration (Base/Original/Blank/Manual is available in Quick Application modal only).
- AI suggestion generation for application resume tailoring.
- Real PDF export.
- Full DB-backed AI provider fallback in chat/digest routes (infrastructure ready, integration pending).

See `plan-application-workflow-redesign.md` for the full phased plan.

## Chunk 8 update (2026-06-20)

**Resume Draft Builder + Versioning from Accepted Suggestions** — landed.

- `applicationResumeVersionsRepository.ts` — full data-access abstraction for `application_resume_versions` (find, list, create, update, clone, getCurrentDraft, markAsDraft, markAsFinal, attach to packet via `createOrUpdatePacket`).
- `resumeDraftBuilderService.ts` — `buildResumeDraftFromAcceptedSuggestions()`: loads source content by `source_type` (base_resume / original_resume / blank / manual), applies only accepted suggestions with `truth_status !== fabrication_risk`, skips truth warnings / missing evidence / format improvements, creates a new draft `application_resume_versions` row or updates an existing draft. Never overwrites original or base resume content.
- `applySuggestionToResume` in `resumeSuggestionService.ts` refactored to use repository functions instead of direct `supabase.from()` calls.
- API routes: `GET /api/applications/[id]/resume-drafts`, `POST /api/applications/[id]/resume-drafts/build`, `PATCH /api/applications/[id]/resume-drafts/[versionId]`, `POST /api/applications/[id]/resume-drafts/[versionId]/attach`, and studio convenience routes via `application-resume-versions/[id]/resume-drafts`.
- Studio UI: Draft tab with Build New Draft / Update Current Draft buttons, accepted/pending suggestion count, fabrication-risk warnings, draft list with status badges, draft preview panel, warnings display, and Attach to Packet button.
- Activity logging on all draft operations (build, save, attach, suggestion application).
- Build: clean. No new direct `supabase.from()` calls in new routes or client code.

Still deferred: cover letter generation, final packet generation, recruiter message generation.

## Chunk 9 update (2026-06-21)

**DOCX/PDF Export + Final Resume Packet Formatting** — landed.

- `application_resume_exports` table (migration with CHECK constraints on export_type and status).
- `applicationResumeExportsRepository.ts` — create, find, list, markFailed, soft-delete.
- `resumeExportService.ts` — wraps existing `renderResumeDocx` (docx library) and `renderResumePdf` (@react-pdf/renderer) with export history tracking, safety checks (empty resume, fabrication-risk suggestions), ATS-friendly formatting (removes buzzwords like "passionate", "dynamic", "results-driven"), and professional file naming. `exportResumeAsDocx`, `exportResumeAsPdf`, `exportResumeAsMarkdown` all create export history records before generation and update with file size on success. Markdown renderer outputs clean structured text from ResumeDocument.
- API routes: `GET /api/applications/[id]/resume-exports`, `POST /api/applications/[id]/resume-exports` (generates file + returns as download), `GET /api/applications/[id]/resume-exports/[exportId]/download` (regenerates on demand from stored record), and studio convenience route `POST /api/application-resume-versions/[id]/export`.
- Studio UI: Export tab with Export DOCX / Export PDF / Preview Markdown buttons, ATS-friendly/include projects/include summary options, export history list with download buttons, failed status display, and file size.
- Activity logging on all export operations (create, success, failure).
- Build: clean. No new direct `supabase.from()` calls in new routes or client code.
- Cloudflare note: `docx` and `@react-pdf/renderer` are Node-only libraries; adapter review needed during a Cloudflare Workers migration. Export files are generated on demand and returned directly; no persistent storage of exported files yet.

Still deferred: cover letter generation, final packet generation, recruiter message generation, Gmail sending.

## Chunk 10 update (2026-06-22)

**Application Packet Builder + Production Deployment Readiness** — landed.

- `application_packets` table extended with `packet_status`, `resume_export_id`, `final_notes`, `checklist`, `warnings`, `ai_summary`, `reviewed_by`, `approved_by`, `sent_by`, `reviewed_at`, `approved_at`, `sent_at`, `updated_at` (migration `20260622120000_application_packet_v1.sql`).
- `applicationPacketsRepository.ts` — full CRUD, upsert, status transitions, list with candidate filtering.
- `applicationPacketBuilderService.ts` — builds packet from application state: loads candidate, job, keywords, evidence, suggestions, resume draft, exports, then builds 11-item checklist and 8 warning types with severity. Upserts packet record automatically.
- `applicationPacketAiService.ts` — `generateCoverLetterDraft`, `generateRecruiterMessageDraft`, `generatePacketSummary`. Loads approved keywords, rejected keywords (banned), evidence, accepted suggestions, final resume draft. Uses structured AI prompts with safety rules: no invention, no rejected keywords, no missing-evidence claims, professional tone. Returns drafts with optional subject lines and warnings.
- API routes: `GET /api/applications/[id]/packet` (enriched with builder), `POST /build`, `POST /cover-letter`, `POST /recruiter-message`, `PATCH /packet` (editable fields), `POST /approve`, `POST /mark-sent`. All use repository abstractions, no direct `supabase.from()`.
- Studio UI: "Packet" tab added to right pane. Shows status badge, selected resume draft, latest export, checklist with pass/warning/missing icons, warnings list, cover letter textarea with generate button (overwrite confirmation), recruiter message textarea with generate button, final notes, action buttons (Build/Refresh, Save, Ready for Review, Approve, Mark Sent), links to candidate/job/queue. Auto-loads on mount. Approval blocked if block-level warnings exist. Export missing warns but can be overridden.
- `docs/deployment-readiness.md` created with full env var reference, migration order, seed setup, security checklist, rollback checklist, post-deploy smoke test.
- Build: clean. Typecheck: clean. No new direct `supabase.from()` calls.
- Deployment target remains Supabase-backed Vercel. Neon/Cloudflare migration documented but not implemented.

Still deferred: Gmail sending, LinkedIn automation, candidate self-login, full Neon migration, full Cloudflare migration, auth migration, R2 migration, NestJS migration.

v1 internal workflow is feature-complete through packet review.

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


## Neon + Cloudflare Migration Sprint (2026-07-07)

**Status:** Infrastructure prepared. Preview not yet run. Deploy not yet attempted.

### What was done

- **Full audit:** `docs/neon-cloudflare-audit.md` — comprehensive audit of all Supabase usage, Node-only APIs, and Cloudflare compatibility. Key findings: Supabase Auth is deeply embedded (4 files), ~120 files use `supabase.from()`, service role key is the default client, `crypto` module and `Buffer` are used extensively, `docx`/`@react-pdf/renderer`/`pdf-parse`/`mammoth` are Node-only.
- **Auth/Storage strategy:** Hybrid Option A. Keep Supabase Auth and Storage temporarily. Neon becomes the main app database. This is the safest path given auth depth.
- **Neon migration plan:** `docs/neon-migration-plan.md` — migration order, required extensions, schema import methods, verification SQL.
- **Data migration guide:** `docs/supabase-to-neon-data-migration.md` — export/import commands, Supabase-specific content removal, row count verification, security checklist.
- **Cloudflare env secrets:** `docs/cloudflare-env-secrets.md` — all `wrangler secret put` commands, local `.dev.vars` setup, security reminders.
- **Neon database adapter:** `src/server/db/neon.ts` + `src/server/db/index.ts` — uses `@neondatabase/serverless` driver, Cloudflare-compatible via `fetch()` under the hood.
- **Web Crypto rewrite:** `src/server/security/secretCrypto.ts` — rewrote AES-256-GCM encryption using `crypto.subtle` (works on both Node.js and Cloudflare Workers). Functions are now async; all callers updated.
- **Buffer → Uint8Array migration:** Fixed file upload routes (`proof`, `attachments`, `photo`, `resumes`, `resume`) and `resumeStorage.ts`, `sharepoint.ts`, `googleGmail.ts`.
- **HMAC/Web Crypto fixes:** `src/lib/webhookEngine.ts` and `src/lib/publicApiAuth.ts` now use `crypto.subtle`.
- **Cloudflare config:** `wrangler.toml` with `nodejs_compat` flag, `.worker-next` build output, assets binding.
- **Package updates:** Added `@neondatabase/serverless`, `@opennextjs/cloudflare`, `wrangler` to dependencies. Added `cf:build`, `cf:preview`, `cf:deploy`, `cf:typegen` scripts.
- **Production env template:** `.env.example.production` with Neon + Supabase auth vars.
- **Lazy init fix:** `src/lib/supabaseRLS.ts` now lazy-initializes like `supabase.ts` (fixes import-time `process.env` crash on Cloudflare).

### What remains before deploy

- **Repository migration:** ~120 files still use `supabase.from()`. New repositories (Chunks 5-10) and critical tables should be migrated to Neon adapter first. Existing routes can remain on Supabase temporarily.
- **Cloudflare preview:** Run `npm run cf:preview` to verify the build works on Cloudflare runtime. This is the next step.
- **Data migration:** Export data from Supabase and import to Neon. Not yet done.
- **Cron jobs:** `vercel.json` has 4 cron jobs. Need Cloudflare Cron Triggers or external scheduler.
- **PDF/DOCX export:** `docx` and `@react-pdf/renderer` are Node-only. These will fail on Cloudflare Workers. Need to either externalize to a Node.js microservice or replace with Cloudflare-compatible libraries.
- **Auth migration:** Supabase Auth is still required. Full migration to Clerk/Auth.js is a future sprint.
- **Storage migration:** Supabase Storage is still required. R2 migration is a future sprint.
- **Hyperdrive (optional):** Consider Cloudflare Hyperdrive for Neon connection pooling if experiencing cold-start latency.

### Build status

- `npm run typecheck`: ✅ clean
- `npm run build`: ✅ clean (91 static pages)
- `npm run cf:build`: NOT YET TESTED (next step)
- `npm run cf:preview`: NOT YET TESTED

### Risk assessment

| Risk | Level | Mitigation |
|------|-------|------------|
| Supabase Auth dependency | HIGH | Keep temporarily. Plan Phase 2 migration. |
| ~120 files on Supabase client | MEDIUM | Migrate repositories incrementally. App still works. |
| PDF/DOCX export Node-only | HIGH | Externalize or replace before deploy. |
| `crypto.subtle` compatibility | LOW | Tested pattern. Works on Node 18+ and Cloudflare. |
| `@neondatabase/serverless` cold start | MEDIUM | Use Hyperdrive if needed. |
| Cron jobs not migrated | MEDIUM | Use external scheduler or Cloudflare Cron Triggers. |
