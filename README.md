# TalentOS (Skarion Tracker) — Candidate Placement Dashboard

An internal tool for tracking candidates, the jobs they're targeting, and every application
in between. Started as a simple candidate/job/application tracker and has grown into a
small "candidate placement OS" — job sourcing from multiple channels, resume version
tracking, follow-up reminders, a status timeline + activity log per application, conversion
analytics, role-based team accounts, a read-only candidate portal, and an AI data assistant
(`/chat`, see below — this app's long-standing "no AI integrations" stance was explicitly
reversed by request; see ROADMAP.md for the prior reasoning and what changed).

**Taking this project over? Read [HANDOVER.md](./HANDOVER.md) first** — a full audit
(build/types/migrations/env vars/auth) done as of the last working session, with a
complete env var reference table and a list of what's configured vs. what isn't.

## Setup (10-15 min)

1. **Create or open a cloud Supabase project** at supabase.com.
2. **Copy env vars:** create `.env.local` in the project root from `.env.example`:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   SUPABASE_ANON_KEY=your-anon-key
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```
   In the Supabase dashboard, find these under **Project Settings > API**:
   - **Project URL** -> `SUPABASE_URL`
   - **anon / publishable key** -> `SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role / secret key** -> `SUPABASE_SERVICE_ROLE_KEY`

   **Never commit `.env.local`.** The service-role key bypasses database access control.
3. **Apply migrations:** link the Supabase CLI to the project if needed, then run:
   ```bash
   npx supabase db push
   ```
   `supabase/migrations/` is the source of truth. `sql/01_schema.sql` is only a convenience
   snapshot and can lag newer migrations.
4. **Check setup:**
   ```bash
   npm run setup:check
   ```
   This validates `.env.local`, rejects placeholder Supabase values, checks connectivity,
   and verifies the required core tables exist.
5. **Create the first admin:** first create an Auth user and password in Supabase
   **Authentication > Users**. Then run:
   ```bash
   npm run seed:admin
   ```
   The script defaults to `ADMIN_EMAIL=admin@skarion.local`. Override it by setting
   `ADMIN_EMAIL=you@example.com` in `.env.local` before running the command.
   It creates or updates the TalentOS `profiles` row for that existing Auth user. It does
   not set or print passwords.

   Everything else (AI assistant keys, `CRON_SECRET` for scheduled jobs, USAJobs import
   credentials, Gmail/Teams/TalentOS integration secrets - see
   [docs/integrations.md](./docs/integrations.md) for those) is optional and degrades to a
   clear error or a no-op, not a crash, when missing. **[HANDOVER.md](./HANDOVER.md)** has
   the full env var reference table - every variable the app reads, what it gates, and
   what is actually configured today.
6. **Install + run:**
   ```bash
   npm install
   npm run dev
   ```
   Other project scripts now exist too: `npm run setup:check`, `npm run seed:admin`,
   `npm run typecheck`, `npm run lint`, `npm run test` (currently an alias for typecheck),
   `npm run build`, and `npm run start`.
   GitHub Actions CI (`.github/workflows/ci.yml`) runs `npm ci`, typecheck, lint, and build
   on pushes to `main` and on pull requests.
7. **Verify:** open `http://localhost:3000/api/health`, then log in at
   `http://localhost:3000/login`. After login, `/jobs` and `/candidates` should load.
## What's here

- **`/candidates`** — server-side paginated masterlist with search + status/tier filters,
  multi-select bulk delete,
  CSV export. Click a name for their profile: contact info, target roles/locations/salary/work
  authorization, a profile photo (shown as a circle avatar throughout the app), a primary
  resume upload, multiple **resume/cover-letter variants** (tailored per job), and every
  application they've made — each with a follow-up date and an expandable status-change
  history.
- **`/jobs`** — the job masterlist, server-side paginated (50/page) and filtered by
  source/tier/active-status/employment type/category, sortable by posted date, multi-select
  bulk delete, CSV export (exports all matching rows, not just the current page). Add jobs
  manually, import a CSV, import a raw LinkedIn scraper JSON dump, or pull live postings
  straight from a company's public **Greenhouse/Lever/Ashby** job board (no scraping, no
  auth). Re-importing any source skips jobs already in the masterlist (matched by posting
  URL) instead of duplicating them. Click a job to see/edit every field, including the
  LinkedIn/ATS-sourced ones (seniority level, employment type, applicant count, company
  size/website, posted date). Applicants for a job show as avatar circles — click one to
  undo a wrong assignment. "Assign application" lets a manager pick one or more candidates
  at once, which resume variant to use, and who on the team owns applying.
- **`/application-queue`** — the application engineer's dashboard: every assigned/stacked/
  in-progress ticket, server-side paginated and filterable by status/owner/search/priority/
  review state, overdue due-dates highlighted.
  Start a ticket, mark it applied, edit its owner/due-date/note, or remove a wrong
  assignment. Application proof upload exists here: AEs/managers can attach a screenshot or
  PDF through `POST /api/applications/[id]/proof`; the app stores the artifact, writes an
  `application_proofs` row, updates the application's latest proof URL/filename, and logs
  the activity.
- **`/follow-ups`** — every application with a follow-up date set, across all candidates.
  Server-side paginated and filterable by status/search/overdue-vs-upcoming; application
  engineers are scoped to their own assigned work. Mark done (clears the date) or delete
  the application outright, single or in bulk.
- **`/analytics`** — non-AI conversion metrics: response/interview/offer rates, performance
  broken down by job source (which channels actually convert) and by resume variant (which
  tailored resume gets more interviews). Pre-submission pipeline tickets (assigned/stacked/
  in-progress) are tracked separately and excluded from conversion-rate math.
- **`/team`** (admin only) — create teammate accounts (name, email, role, temporary
  password), change anyone's role, deactivate a login without deleting their history.
- **`/account`** — the signed-in user's own profile (display name, password change).
- **`/audit`** (admin only) — read-only feed of `audit_logs` (user/application create-update-
  delete events so far), filterable by action/entity type.
- **`/ops`** (admin only) — system health snapshot: live Supabase reachability + latency,
  row counts, recent import-run history/errors (`import_runs`) across all sources, and a
  backup panel. Built after an hour-long Supabase outage and a wiped `jobs` table went
  unnoticed mid-session until someone happened to check manually — give that an obvious
  place to surface next time.
- **AI job categorization** — imported jobs can be categorized by the AI layer
  (`src/lib/ai/jobCategorization.ts`) through the manual processing route and the
  `categorize-jobs` cron route. It classifies active categories and extracts useful signals
  such as salary/work-authorization hints. This is separate from the read-only chat
  assistant and daily digest.
- **JD Analyzer (Chunk 2, parse-only)** — `POST /api/jobs/analyze` accepts raw job
  description text and returns structured JSON analysis via the configured AI provider:
  title, company, location, workplace type, employment type, required/preferred skills, tools,
  responsibilities, seniority level, years experience, salary range, domain keywords, soft
  skills, ATS keywords, visa signals, red flags with severity, fit summary, and confidence
  score. Role-gated to `APPLICATION_WORKER_ROLES` (admin, manager, recruiter, application
  engineer). Returns **503** if no AI provider is configured. Does **not** create or update
  any database rows — pure analysis endpoint.
- **Auto-create Job from Pasted JD (Chunk 3)** — `POST /api/jobs/from-jd` runs the full
  parse → dedup → create workflow. It calls the AI analyzer, then performs three-pass
  duplicate detection (exact `source_url` match, exact normalized title+company+location,
  and fuzzy Levenshtein matching with thresholds: title ≥ 0.90, company ≥ 0.86, location ≥ 0.86).
  Returns **409** if potential duplicates are found unless `forceCreate: true`. Returns **422**
  if the AI cannot extract a job title. On success, inserts a new `jobs` row with
  `source = 'pasted_jd'`, stores the raw text in `raw_description`, the parsed JSON in
  `parsed_description`, and maps all AI-extracted fields (salary, employment type, seniority,
  etc.) into their respective columns. Triggers `job.created` webhooks and logs activity.
  Gated to `MASTER_DATA_MANAGER_ROLES` (admin, manager, recruiter).
- **Portability Guardrails + Admin AI API Key Manager (Chunk 3.5)** —
  - Data-access abstractions: `src/server/repositories/jobsRepository.ts` and `aiKeyRepository.ts`.
    New feature routes must call these instead of direct `supabase.from()` queries.
  - Admin AI key manager: `POST /api/admin/ai-keys`, `PATCH /api/admin/ai-keys/[id]`,
    `DELETE /api/admin/ai-keys/[id]`, `POST /api/admin/ai-keys/[id]/test`. Admin-only.
    Keys are encrypted with `AI_KEYS_ENCRYPTION_SECRET` (AES-256-GCM), never returned to the
    browser, and show only a fingerprint (first 6 + last 4 chars). Supports priority ordering,
    health testing, and soft-disable.
  - AI fallback: `getActiveProviderAsync()` tries env-based keys first, then falls back to
    DB-managed keys by priority. Tracks usage_count and failure_count per key.
  - Migration readiness: `docs/migration-neon-cloudflare.md` documents the path from
    Vercel+Supabase to Neon+Cloudflare Workers.
- **Quick Application Modal (Chunk 4)** — Global "+ New Application" button in the nav bar,
  visible to `APPLICATION_WORKER_ROLES` (admin, manager, recruiter, application_engineer).
  Reviewers are excluded. Opens a 4-step modal:
  1. **Candidate**: searchable list from `/api/candidates?compact=1`.
  2. **Paste JD**: textarea + optional source URL. "Auto-Analyze" calls `/api/jobs/analyze`.
     Shows preview card with title, company, location, workplace type, employment type,
     seniority, salary, confidence score, required/preferred skills, and red flags.
  3. **Review Job**: "Create Job" calls `/api/jobs/from-jd`. On 409 duplicate, shows
     duplicate jobs with options to "Use existing" or "Force create new".
     On 422, shows clean message to paste a clearer JD.
  4. **Create Application**: resume source selector (Base/Original/Blank/Manual), status
     selector (default Stacked), notes, optional assignment. Calls `/api/applications`.
     On 409 duplicate, shows "already has an application" with link to candidate.
     Success shows links to candidate, job, and application queue.
  - Ad-hoc path: user can skip creating a masterlist job and create an ad-hoc application
    with `adhoc_job_data` + `adhoc_job_raw_text` instead of `job_id`.
  - Uses API routes only. No direct Supabase calls in client code.
  - Does not yet implement full resume source switching in studio, keyword approval,
    ATS suggestions, or cover letter generation.
- **Resume tailoring workflow** - admins/managers/recruiters can open "Tailor resume for
  job" from a candidate or job page, choose a base resume and target job, generate a
  markdown draft through the configured AI provider, edit it, save it as an
  `application_resume_versions` variant, and attach it to an application packet. The prompt
  explicitly forbids inventing experience and the UI warns to review before sending.
- **/companies** — directory of every employer seen across imported job postings,
  normalized by name (`src/lib/companyDirectory.ts`). Each company page (`/companies/[id]`)
  aggregates every job posting and every scraped contact person (`company_people` — name,
  title, LinkedIn profile, inferred influence level like "hiring manager" vs "recruiter")
  seen for that employer, so you can see hiring contacts at a company without re-deriving
  it from individual job rows.
- **Saved job searches** — on `/jobs`, save the current filter combination (source/tier/
  category/employment-type/active/sort) as a named, optionally team-shared preset
  (`/api/saved-job-searches`) instead of re-entering the same filters every time for a
  recurring search.
- **Live job crawler ingestion** — ported as an idea (not code) from comparing against the
  team's separate `skarion-api` repo: an external crawler bot can push postings into the
  jobs masterlist over an API-key-gated endpoint instead of this app pulling on a cron
  schedule. `POST /api/integrations/crawler/jobs` (upserts by `external_job_id`, source
  `crawler`) and `POST /api/integrations/crawler/heartbeat` both require
  `Authorization: Bearer $CRAWLER_API_KEY` — the bot itself isn't part of this app (it
  wasn't part of the team's other two repos either; only the receiving side exists here).
  Live-tested: dedup-by-`external_job_id` confirmed (re-pushing the same id updates the
  one row, doesn't duplicate), unauthorized requests confirmed 401, real-time push
  confirmed via a direct Realtime subscription test. `/ops` shows a live "Job crawler"
  panel (`src/app/ops/CrawlerStatusLive.tsx`) fed by `GET /api/integrations/crawler/stream`
  (Server-Sent Events) instead of polling — this app's equivalent of the team's separate
  Socket.IO server, built on Supabase Realtime instead (already part of
  `@supabase/supabase-js`, no new dependency, and the browser still only ever talks to
  this app's own API, never Supabase directly, consistent with everywhere else in this
  app).
- **Pluggable resume storage: Supabase Storage (default) or SharePoint.** Brought over as
  an explicit option from the same comparison — the team's recruiting module stores
  resumes in SharePoint via Microsoft Graph; that's an infrastructure preference, not a
  feature this app lacked (Supabase Storage + resume variants is already more complete),
  but it's now available for a team standardized on Microsoft 365. Set
  `RESUME_STORAGE_PROVIDER=sharepoint` plus `MS_CLIENT_ID`/`MS_CLIENT_SECRET`/
  `MS_TENANT_ID`/`SHAREPOINT_SITE_ID` to switch; default (unset) behavior is byte-for-byte
  the original Supabase Storage path (`src/lib/resumeStorage.ts`). **Honestly scoped:**
  there's no Microsoft tenant available in this environment, so the actual Graph API calls
  are not live-tested — what is tested is that the abstraction leaves default (Supabase)
  upload behavior unchanged, and that selecting SharePoint without credentials fails with
  a clear "MS_TENANT_ID is required" error rather than crashing or silently doing nothing,
  matching this app's existing fail-clearly convention.

## Backups

A daily Vercel Cron (`/api/cron/backup`, see `vercel.json`) snapshots `candidates`/`jobs`/
`applications`/`resumes` to JSON and stores it in the `resumes` Storage bucket under
`backups/<timestamp>.json`. `/ops` lists recent backups and has a "Download backup now"
button for an on-demand copy (`/api/ops/export`, streamed straight to the browser, not
stored). `src/lib/backup.ts` includes restore helpers (`parseBackupSnapshot`,
`loadStoredBackupSnapshot`, `restoreBackupSnapshot`), and `/api/ops/restore` plus the
Stored backups panel on `/ops` provide an admin-only restore workflow. Restore requires the
exact phrase `RESTORE TALENTOS BACKUP` and upserts records; it is not a full point-in-time
database rollback and does not delete rows absent from the snapshot.
- **`/portal/<token>`** — public, no-login, read-only candidate-facing page. Each candidate
  gets a unique magic-link token (`candidates.portal_token`) — copy it from their profile.
  Shows their submitted applications, statuses, a per-candidate stats summary (applications/
  interviews/offers/response rate), and only the activity-log entries a teammate explicitly
  marked "share with candidate". Internal-only notes and pre-submission pipeline tickets are
  never exposed here.
- **Activity log** — every application has a free-form comment/log thread (who called, when
  an interview got scheduled, etc.), separate from the automatic status-change timeline.
  Each entry can be flagged to also appear on that candidate's portal. Comments support
  threaded replies (`parent_comment_id` on `application_comments`, POST a comment with
  `parent_comment_id` set to reply to one) — API and AI-assistant-visible now;
  `candidates/[id]` and `jobs/[id]` UI rendering of the thread structure is not wired up
  yet (those pages were mid-edit elsewhere when this landed — see ROADMAP.md).

## AI assistant (`/chat`)

A conversational data assistant with **read-only** tool access across candidates, jobs,
applications (incl. priority/review status), companies, the activity log, analytics, saved
import sources, and (admin-only) the audit log — see `src/lib/ai/tools.ts` for the exact tool
list and what each one queries. It answers
questions like "how many OSP candidates have we interviewed this month?" by calling tools
against real data, never by guessing. It has **no write/delete tools** — it cannot assign
tickets, change a status, or delete anything; that's a deliberate scope decision, not a
current limitation to "fix" later without re-deciding it. Capped at 200 user messages/day
per person as a cost guardrail against a runaway client racking up API spend unsupervised.

**Requires `ANTHROPIC_API_KEY` or `NVIDIA_API_KEY`** in `.env.local` (and in Vercel for
production) — without either, `/chat` returns a clear "not configured" error rather than
failing silently. `src/lib/ai/index.ts`'s `getActiveProvider()` prefers Anthropic if both are
set; override with `AI_PROVIDER=anthropic` or `AI_PROVIDER=nvidia`.
`src/lib/ai/provider.ts` defines the provider-agnostic interface per the original vision
doc's "provider abstraction — AI owns reasoning, app owns workflow" principle.
`src/lib/ai/anthropicProvider.ts` and `src/lib/ai/nvidiaProvider.ts` are the two real
implementations; adding OpenAI/Gemini/Ollama later means implementing the same interface, not
a rewrite. No SDK dependency for either — both call their REST API directly via `fetch`, same
pattern as every other external integration in this app (ATS fetchers, USAJobs, career-page
extractor).

**Live-tested finding — NVIDIA's `moonshotai/kimi-k2.6` is unreliable for this assistant's
tool-calling pattern.** The model reliably decides to call a tool on the first turn, but
consuming the tool's result and producing a final answer degenerates into repeated tokens
(`finish_reason: "repetition"`) a meaningful fraction of the time — reproduced across 6+
variations (different temperature/penalty settings, `content: null` vs `""`, with/without
re-sending `tools`). This isn't a formatting bug in this app's request-building (verified
against the API's actual documented response shape); it's the model/endpoint itself under
this exact multi-turn-with-tool-result pattern. Two mitigations are in place:
`frequency_penalty`/`presence_penalty` on every NVIDIA request (`nvidiaProvider.ts`) reduce
how often it happens; `looksDegenerate()` (`provider.ts`) catches it when it still happens
and falls back to showing the raw tool data instead of garbage text
(`src/app/api/chat/route.ts`). **If you have an Anthropic key, prefer it for this feature** —
NVIDIA/Kimi remains available and correctly wired for when no Anthropic key exists, but isn't
the trustworthy default for an interactive assistant that needs to reason over tool results.

## AI daily digest

A second, separate AI feature from `/chat`, on purpose: `/api/cron/digest` runs once daily
(`vercel.json`) and generates a short plain-language summary (new jobs ingested, overdue
tickets, applications submitted today, pipeline count) via **single-shot generation** — the
app gathers the data itself with plain queries (`src/lib/ai/digest.ts`) and asks for one
response, no tool-calling. Stored in `ai_digests`, viewable (and manually triggerable via
"Generate now") on `/ops`. This pattern is deliberately simpler than `/chat`'s because it
sidesteps the exact failure mode documented above — there's no second turn for the model to
degenerate on, and live-testing confirmed this produces clean, accurate output every time
tried.

**Note on the "no AI" stance:** this app intentionally had zero AI integrations through most
of its build — see ROADMAP.md's "Explicitly deferred" section for the original reasoning
(keep workflow data clean and provider-agnostic before layering AI on top). This feature is
an explicit, deliberate reversal of that stance by direct request, not a quiet scope creep —
worth knowing if you're wondering why the rest of this doc reads AI-skeptical.

## Frontend performance + nav

A real bundle-size audit (not guesswork) found the JS bundles were already small
(87-110KB First Load JS per page) — the actual "loading faster" lever here is perceived
speed and consistency, not bundle trimming:

- **`src/app/Skeleton.tsx`** — `TableSkeleton`/`CardSkeleton` shimmer placeholders, now used
  on `/jobs`, `/candidates`, `/audit`, `/import-sources`, `/ops` instead of plain "Loading…"
  text. `.loading-panel` (an existing convention on `/application-queue`, `/companies`,
  `/follow-ups`) got a shimmer animation too (`.skeleton-bar` in `globals.css`) — a pure-CSS
  change that improves those pages automatically with no JSX edits.
- **Nav reorganized**: 8+ flat links collapsed into a "More ▾" dropdown (Analytics,
  Assistant, Import Sources, Audit Log, System Health, Team) so the primary workflow
  (Candidates/Jobs/Companies/Application Queue/Follow-ups) stays uncluttered as the app
  keeps growing. This also fixed a real discoverability gap: `/chat`, `/audit`, and `/ops`
  had no nav entry at all before this — they only existed if you knew the URL.
- Did **not** touch `jobs/[id]/page.tsx` or `candidates/[id]/page.tsx` in this pass — both
  showed signs of active, simultaneous multi-file edits (page + API route + a brand-new
  sub-route all dirty together) at the time, the highest realistic collision risk in the
  app. Worth a follow-up pass once that settles.

## CSV import format

Columns expected (only `title` is required):
```
title,company,location,role_tier,salary_range,source_url,notes
```
`role_tier` should be one of `osp`, `adjacent_1`, `adjacent_2` if you want it to show the
tier badge — anything else just won't show a badge, it won't break.

## ATS / LinkedIn import

- **LinkedIn**: paste the raw JSON array a LinkedIn jobs scraper produces (camelCase fields
  like `companyName`, `postedAt`, `seniorityLevel`) into the `/api/import/linkedin` endpoint's
  `{ rows: [...] }` body. `src/lib/linkedinMapper.ts` does the field translation.
- **Greenhouse / Lever / Ashby**: on `/jobs`, click "Import from ATS", pick a provider, and
  enter the company's board token/slug (e.g. a Greenhouse board at
  `boards.greenhouse.io/asana` → token `asana`). Fetches live postings from that company's
  public job-board API. `src/lib/atsFetchers.ts` has the per-provider fetch + normalize logic.
- **USAJobs**: same "Import from ATS" modal, provider "USAJobs" — unlike the others this is
  a keyword search (e.g. "civil engineer"), not a company token. Requires a free API key:
  sign up at developer.usajobs.gov, then set `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT`
  (the email you registered with) in `.env.local`.
- **Company career pages**: `src/lib/jobPostingExtractor.ts` + `POST /api/import/career-page`
  (`{ url: "https://company.com/careers" }`) extract embedded schema.org `JobPosting`
  JSON-LD from a career page — no scraping, just reading what the page already publishes for
  Google for Jobs. Backend only for now; not yet wired into the `/jobs` import modal as a UI
  option.

## Scheduled ingestion

`/import-sources` (admin/manager) saves a board token or career-page URL against a provider
(Greenhouse/Lever/Ashby/USAJobs/career_page) — no more manual button-clicking per company.
A Vercel Cron job (configured in `vercel.json`, default daily at 06:00 UTC) hits
`/api/cron/import-sources`, which re-runs every active saved source and records
`last_run_at`/`last_result` (imported/skipped counts, or the error) back on each row. That
endpoint doesn't use a session cookie — Vercel Cron can't supply one — so it's gated by a
`CRON_SECRET` bearer token instead: set `CRON_SECRET` as an env var (locally and in Vercel),
and `src/middleware.ts` has a matching bypass for exactly this one path.

## Universal Job Import Normalizer

**Status: implemented for CSV/TSV/JSON.** The `/jobs` page now includes "Import file":
analyze the file, review or adjust detected column mappings, optionally reuse/save an
import profile, then commit cleaned and deduped jobs.

### Problem

Today there are 3 separate, hand-written import paths — CSV (fixed column names:
`title,company,location,role_tier,salary_range,source_url,notes`), LinkedIn (fixed
camelCase scraper keys), ATS (fixed per-provider API response shapes). Adding a new source
or tolerating a slightly different header name currently means writing new code. None of
the three tolerate: renamed headers, missing headers, extra/unexpected columns, or
delimiter variations (TSV, semicolon-separated, etc.).

### Goal

A single, reusable pipeline — **detect → parse → map fields → clean → dedupe → insert** —
that the existing three importers become thin adapters of, plus a new generic "Import
anything" entry point on `/jobs` for arbitrary CSV/TSV/JSON files with unknown or missing
headers.

### Pipeline stages

1. **Format detection** (`src/lib/normalizer/detect.ts`) — sniff file extension + content
   shape → `csv` | `tsv` | `json`. (Excel `.xlsx` is a later phase, not v1 — don't add a new
   dependency for it yet.)
2. **Parsing** (`src/lib/normalizer/parse.ts`) — papaparse (already a dependency) for
   delimited formats, `JSON.parse` for JSON. Output a uniform shape:
   ```ts
   { headers: string[], rows: Record<string, string>[], headersDetected: boolean }
   ```
   When a delimited file has no header row (heuristic: first row "looks like" data, not
   labels — e.g. mostly numeric/URL/date-shaped cells), synthesize positional headers
   (`col_0`, `col_1`, ...) and set `headersDetected: false` rather than guessing wrong.
3. **Field mapping** (`src/lib/normalizer/fieldMap.ts`) — **heuristic-first, by design
   decision** (see "On AI" below):
   - Normalize each header (lowercase, strip punctuation/whitespace).
   - Exact-match against a synonym dictionary per schema field, e.g.:
     ```
     title:       title, job title, position, role, job_title, posting title
     company:     company, employer, company name, organization, companyname
     location:    location, city, job location, joblocation
     source_url:  url, link, job url, posting url, source_url, apply url
     posted_at:   posted, date posted, posted_at, publish date, postedat
     salary_range: salary, salary range, comp, compensation
     role_tier:   tier, role tier, category
     notes:       notes, comment, comments, description
     ```
   - If no exact match, fuzzy-match (Levenshtein or Jaro-Winkler distance) within a
     threshold (start at edit-distance ≤ 2 or similarity ≥ 0.8 — tune against real sample
     files, don't hardcode without testing).
   - Anything still unmapped is **surfaced, not silently dropped** — feeds into stage 4.
4. **Manual-mapping fallback UI** — when `headersDetected: false`, or one+ required field
   (`title`) has no confident mapping: show a one-time screen with a preview of the first
   ~5 rows per column and a dropdown per column (assign to a schema field, or "ignore").
   This is the actual answer to "headerless data" and "all schemas" — not inference magic,
   a real but low-friction human step, same pattern as Mailchimp/Airtable-style CSV
   importers.
   - **Remember mappings**: persist confirmed mappings as a named "import profile" so the
     same vendor's recurring export doesn't need re-mapping every time. New table:
     ```sql
     create table if not exists import_profiles (
       id          uuid primary key default gen_random_uuid(),
       label       text not null,            -- e.g. "Acme Staffing weekly export"
       column_map  jsonb not null,            -- { "Job Title": "title", "Comp": "salary_range", ... }
       created_at  timestamptz default now()
     );
     ```
     On a new import, if the file's header set matches a saved profile closely, offer to
     reuse it instead of re-mapping.
5. **Cleaning** (`src/lib/normalizer/clean.ts`):
   - Trim whitespace on every string field.
   - Parse dates in multiple common formats (`MM/DD/YYYY`, `YYYY-MM-DD`, `Month D, YYYY`,
     relative strings like "3 days ago") into ISO `date` for `posted_at`.
   - Normalize `role_tier` to one of `osp` / `adjacent_1` / `adjacent_2` only when
     confidently recognizable (exact or near-exact match); otherwise `null` — never guess a
     wrong tier.
   - Drop fully-empty rows (no `title` and nothing else useful).
6. **Dedup** — extend the existing `filterNewJobs` (`src/lib/jobDedup.ts`, matches on
   `source_url`) with a fallback for rows with no URL: fuzzy-match on normalized
   `title + company + location` against existing jobs, same confidence-threshold approach
   as field mapping. Don't dedupe on title alone — too many false positives across
   different companies/locations.
7. **Insert** — same `jobs` table. `source` becomes either the existing labels
   (`csv_import` / `linkedin` / `greenhouse` / `lever` / `ashby`) when called from an
   existing adapter, or `"normalized_import"` (or the import profile's label) for the new
   generic entry point.

### Migrating the existing importers

Once the pipeline exists, `import/jobs`, `import/linkedin`, and `import/ats` routes should
become thin callers of the same `parse → map → clean → dedupe → insert` pipeline instead of
each having their own bespoke mapping/insert logic — reduces duplicated dedup/insert code
across 4 routes to 1. This is a refactor of working code, so do it as its own pass with
tests/manual verification before and after, not bundled into the new-feature work.

### On AI — explicit decision, don't relitigate

This pipeline is **heuristic-only for v1**: synonym dictionary + fuzzy string matching +
the manual-mapping UI as the fallback for anything heuristics can't confidently resolve.
That's a deliberate choice to keep this app's standing no-AI-integrations stance intact.

Leave one clean extension point for later, but do not wire it up by default:
```ts
// src/lib/normalizer/fieldMap.ts
export interface FieldMapper {
  mapFields(headers: string[], sampleRows: Record<string, string>[]): FieldMapping;
}
// Default export: heuristicFieldMapper (synonym dict + fuzzy match, described above).
// A future llmFieldMapper implementing the same interface could replace only the
// "still unmapped after heuristics" columns — gated behind an explicit opt-in (e.g. an
// env var or a per-import checkbox), never the default path.
```
This mirrors the original project vision's "provider abstraction, AI owns reasoning / app
owns workflow" principle (see `ROADMAP.md`) without actually adding an AI dependency now.

### Out of scope for this phase

- Excel/`.xlsx` parsing (would add a new dependency — `xlsx`/`exceljs` — defer until a real
  need shows up).
- Free-text or PDF job-description parsing.
- Auto-applying a saved import profile without user confirmation on first use with a new
  file (always show what it's about to do before inserting).

## Architecture notes

- Next.js 14 App Router, plain CSS (no component library) — see `src/app/globals.css` for
  the full token/class set (`.card`, `.table`, `.modal`, `.filter-bar`, `.bulk-bar`, `.badge`,
  `.avatar-circle`, etc.).
- All API routes (`src/app/api/**/route.ts`) talk to Supabase via the shared client in
  `src/lib/supabase.ts`, using the **service role key** (full access, bypasses Row Level
  Security). Authorization is enforced in the app layer instead: `src/middleware.ts` requires
  a valid session cookie on every route except `/login`, `/portal/*`, `/api/portal/*`, and
  `/api/auth/*`; `src/lib/auth.ts`'s `requireCurrentUser(roles?)` additionally checks roles
  across most write paths. Role-based action gating is now mostly implemented for the
  important mutations: master-data creation/editing, destructive candidate/job/application
  actions, assignment changes, public API key management, audit/team/admin ops, and
  application-engineer queue visibility. It is still app-layer authorization, not Supabase
  RLS policy enforcement. RLS is enabled on every table
  (`20260618102000_enable_rls.sql`) with no policies, since nothing queries Supabase directly
  from the browser with the anon key — if that ever changes, policies need writing then.
- That shared client explicitly disables Next.js's fetch caching (`cache: "no-store"`).
  Without it, any GET route with no dynamic path segment (e.g. `/api/analytics`,
  `/api/follow-ups`) gets its first-ever response cached by Next.js forever — a real bug
  hit and fixed during development. If you add a new param-less GET route, this is already
  handled for you; don't reintroduce per-route caching without testing it against writes.
- Filtering on list pages is done client-side over the already-fetched list (small dataset,
  internal tool) rather than server-side query params — keep that in mind if the data grows
  to thousands of rows; see ROADMAP.md.
- DB schema is documented in full in `sql/01_schema.sql`; real applied changes are tracked
  as ordered migrations in `supabase/migrations/`.

- **`/api/notifications`** — a lightweight per-user counts feed (queue size, overdue,
  urgent, pending review, due follow-ups), scoped to "your own" items for the
  `application_engineer` role. API only as of this writing — no nav badge/bell wired to it
  yet.

## Known gaps (read before relying on this for anything sensitive)

- **First admin bootstrap is explicit.** There is no self-serve signup. Create the first Auth user/password in Supabase Authentication, then run `npm run seed:admin` to create or update the TalentOS admin profile before logging in.
- Candidate self-login is still not implemented. The public candidate portal remains a
  magic-link flow at `/portal/<token>` with expiry/revocation fields available, not a
  candidate account/session dashboard.
- Gmail intelligence/email classification is still not implemented. Gmail OAuth/linking
  exists, but the app does not yet classify rejections, recruiter replies, interview
  invites, or auto-update application state from email.
- Resume tailoring now generates editable markdown drafts and saves/attaches variants. Cover-letter generation and deeper truth-scoring/approval automation are still future work.
- **`CRON_SECRET` must be set in production** or every `/api/cron/*` route, including the
  Vercel cron jobs in `vercel.json`, 401s silently every day, forever — see
  [HANDOVER.md](./HANDOVER.md) for the full operational checklist before deploying.

## Deploy

The current deployment path is **Vercel + Supabase**: push to GitHub, import into Vercel,
and add the required Supabase and cron env vars there. Supabase remains the database,
auth, and default storage backend. Cloudflare full-stack hosting is not configured, and a
Cloudflare D1/R2 migration is not part of the current architecture.

Don't forget the bootstrap-account step above — without it, every route redirects to a
`/login` no one can use yet.

## Integration Docs

Talent OS webhook notifications, Microsoft Teams forwarding, and Gmail OAuth setup are
documented in [docs/integrations.md](./docs/integrations.md).

Public REST API scopes, endpoints, and examples are documented in
[docs/public-api.md](./docs/public-api.md).

## Background

This started from a much larger vision document (`Project Goals.docx`, distilled from
`Deep Research Blueprint for a Candidate Placement Operating System.docx`) describing a full
"Candidate Placement Operating System" — job aggregation, resume tailoring AI, email/calendar
sync, interview prep, the works. What's built so far is the internal operating-tracker
slice of that vision, with a few AI features now added deliberately (chat, digest, job
categorization) and larger AI workflows still deferred. See [ROADMAP.md](./ROADMAP.md) for
what's next and why each piece was sequenced where it was.

- **Resume draft builder + versioning from accepted suggestions** — admins/managers/recruiters/application_engineers can build a reviewable resume draft from accepted AI suggestions without overwriting original or base resume content. The draft builder loads source content by `source_type` (base_resume / original_resume / blank / manual), applies only accepted suggestions with `truth_status !== fabrication_risk`, skips warnings and format improvements, and creates a new `application_resume_versions` draft row or updates an existing one. API: `GET/POST /api/applications/[id]/resume-drafts`, `PATCH /api/applications/[id]/resume-drafts/[versionId]`, `POST /api/applications/[id]/resume-drafts/[versionId]/attach`. Studio UI: Draft tab with Build New Draft / Update Current Draft, draft list, preview, warnings, Attach to Packet button. Activity logged on all operations. No new direct Supabase calls in routes or client code — uses repository/service abstractions throughout.
