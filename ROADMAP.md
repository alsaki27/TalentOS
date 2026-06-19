# Roadmap

This app is being built incrementally from the full "Candidate Placement Operating System"
vision in `Project Goals.docx`. Each phase below was a deliberate scoping decision, not an
oversight — the reasoning is included so future work doesn't undo it by accident.

## Done

- Core tracker: candidates, jobs, applications, resume upload, CSV import.
- LinkedIn scraper JSON import, mapped via `src/lib/linkedinMapper.ts` to the real field
  names a LinkedIn jobs scraper returns (`seniorityLevel`, `employmentType`,
  `applicantsCount`, `companyEmployeesCount`, `companyWebsite`, `postedAt`).
- **V1 no-AI expansion**: richer candidate profiles (target roles, locations, salary
  expectation, work authorization), multiple resume/cover-letter variants per candidate,
  job de-duplication on import, live job sourcing from Greenhouse/Lever/Ashby's public
  job-board APIs, follow-up reminders, an automatic application status timeline, and a
  non-AI analytics dashboard (response/interview/offer rates, by-source and by-resume-variant
  performance).
- Job detail/edit page (previously jobs were add-only with no way to view or edit the
  LinkedIn/ATS-sourced fields after import).
- Filters, multi-select bulk delete, and single-row delete across all four list views
  (candidates, jobs, a candidate's applications, follow-ups).
- Candidate profile photos, shown as avatar circles on the jobs list so you can see at a
  glance who's already applied to a role; posted-date column + sort on the jobs list; CSV
  export on candidates/jobs.
- **Manager → application engineer assignment workflow.** Applications can now exist as
  pre-submission work tickets (`assigned` / `stacked` / `in_progress`) before the actual
  `applied` status, with `assigned_by` / `assigned_to` / `assignment_note` /
  `assignment_due_at` / `completed_at` metadata. From `/jobs`, "Assign application" supports
  picking multiple candidates at once to fan out the same job to several people in one
  ticket-creation pass. `/application-queue` is the application engineer's dashboard:
  filter by status/owner, see overdue tickets highlighted, edit an assignment's
  owner/due-date/note, remove a wrong assignment, or progress a ticket (Start → Mark
  applied). `/jobs` applicant avatars are now clickable to remove a wrong assignment
  directly from the job row. Analytics excludes pipeline tickets from conversion-rate math
  (a real application only counts once it's actually `applied`) and surfaces a separate
  "In pipeline" total.
- **List pagination + server-side filtering.** `/api/jobs` paginates (50/page) and
  filters/sorts server-side instead of shipping every row to the browser — the unpaginated
  version had grown to a 24MB response at 1,000 rows. Candidates, application queue, and
  follow-ups now also return paginated/filterable API responses. CSV export still exports
  all matching job rows (up to a 5,000-row cap), not just the current page.
- **Storage cleanup on delete/replace.** `src/lib/storage.ts` adds a best-effort
  `deleteStorageFile()` used by candidate delete (resume + avatar + every resume variant),
  resume-variant delete, and both upload routes (the old file is removed when a resume or
  photo is replaced — uploads use a `Date.now()` path, so replacing without cleanup was
  silently leaking a new orphaned file on every re-upload, not just on delete). Jobs have no
  associated Storage files (their `company_logo_url`/etc. are external CDN links, not our
  bucket), so job delete needed no change.
- **USAJobs as a job source.** `fetchUsaJobs()` in `src/lib/atsFetchers.ts`, wired into the
  existing "Import from ATS" modal as a 4th provider. Unlike Greenhouse/Lever/Ashby this is
  a keyword search (e.g. "civil engineer"), not a per-company board token. Requires a free
  API key from developer.usajobs.gov — set `USAJOBS_API_KEY` and `USAJOBS_USER_AGENT`
  (the email used to register) as env vars; without them the import returns a clear error
  naming the missing vars rather than failing silently. Not live-tested end-to-end (no API
  key available in this environment) — verified the endpoint and required auth headers are
  correct by confirming it 403s without credentials, but do a real import once a key is in
  place before relying on it.
- **Application activity log + candidate portal.** Every application now has a free-form
  comment/log thread (`application_comments`) separate from the automatic status-change
  timeline — the "for v1 the log is a comment" decision from the 2026-06-17 planning call.
  Each candidate gets a `portal_token` magic-link to a public, read-only `/portal/<token>`
  page showing their submitted applications, a per-candidate stats summary, and only the
  log entries a teammate flagged `visible_to_candidate`. Internal notes and pre-submission
  pipeline tickets never reach it.
- **Authentication + roles.** Real accounts via Supabase Auth, a `profiles` table with four
  roles (`admin`/`manager`/`application_engineer`/`recruiter`), `src/middleware.ts` gating
  every route on a valid session, `/team` (admin-only user management), `/account`
  (self-service profile/password), and `audit_logs` written on
  create/update/delete actions across applications and users. RLS is enabled on every table
  with no policies (every route still goes through the service-role-keyed server client, so
  this is a defense-in-depth measure, not a behavior change yet). `assigned_by_user_id` /
  `assigned_to_user_id` were added alongside the original free-text `assigned_by`/
  `assigned_to` fields rather than replacing them, so existing data and code keep working.
  **Known gap:** there's no self-serve bootstrap — `POST /api/users` requires an existing
  admin session, so the very first account must be created directly via Supabase's Admin API
  or dashboard. Until that happens, every route redirects to a `/login` no one can use.
- **Role-based action gating — mostly implemented.** Admin/team/audit/ops surfaces are
  gated; master-data creation/editing, destructive candidate/job/application actions,
  assignment changes, public API key management, and application-engineer queue visibility
  now enforce roles in the app layer. Remaining work is policy refinement and edge-case
  review, not the old "roles exist but actions are mostly ungated" state.
- **Audit log viewer.** `/audit` (admin-only) reads back everything `audit_logs` has been
  collecting — finally a UI for the "we need logs and metrics" half of the auth work.
  Filterable by action/entity type, paginated.
- **Company career pages via Google's `JobPosting` structured data — backend.**
  `src/lib/jobPostingExtractor.ts` fetches a career page URL and extracts embedded JSON-LD
  `JobPosting` blocks (handles `@graph`-wrapped pages and arrays of postings), mapped onto
  the same `JobRow` shape as the other importers and posted to
  `/api/import/career-page` (same dedup-via-`filterNewJobs` pattern). No new dependency
  (regex-based JSON-LD extraction, not a full HTML parser) — consistent with the "don't add
  a dependency without a real need" stance used for the universal import normalizer. UI
  wiring into the `/jobs` import modal still pending (see Next up).
- **Scheduled ingestion.** `/import-sources` (admin/manager) saves a board token/career-page
  URL per provider; `/api/cron/import-sources`, invoked daily by Vercel Cron
  (`vercel.json`), re-runs every active one and records `last_run_at`/`last_result`. Matches
  the original planning-call vision directly: "even with 1,000 companies, you can keep
  running it on a schedule." That endpoint can't use a session cookie (Cron has none), so
  it's gated by a `CRON_SECRET` bearer check instead, with a matching one-line bypass added
  to `src/middleware.ts` — the one piece of that contested file touched for this, kept
  minimal and additive on purpose. **Note:** the `/import-sources` page and the manual
  "Run now" endpoint (`/api/import-sources/[id]/run`) were independently rebuilt afterward
  by a second build pass — that's the canonical version now. `src/lib/importSourceRunner.ts`
  and the `import_runs` history table (below) predate that rebuild and aren't wired into the
  manual-run path, only the scheduled cron path — a known minor inconsistency, not a bug.
- **Import run history + system health dashboard.** `import_runs` logs every scheduled
  import attempt (not just the latest, which `import_sources.last_result` already
  overwrites). `/ops` (admin-only) surfaces it alongside live Supabase reachability/latency
  and row counts — built directly from this session's experience: an hour-long Supabase
  outage and a fully wiped `jobs` table went undetected until someone happened to check by
  hand. Next time, that's a glance at one page.
- **Automated + on-demand backups.** `src/lib/backup.ts` snapshots
  candidates/jobs/applications/resumes to JSON. `/api/cron/backup` runs it daily (Vercel
  Cron, `vercel.json`) and stores the result in Supabase Storage under `backups/`; `/ops`
  also has a "Download backup now" button for an immediate copy. Direct response to this
  session's actual jobs-table wipe, where recovery only worked because a source file
  happened to still be on disk. Restore library helpers now exist
  (`parseBackupSnapshot`, `loadStoredBackupSnapshot`, `restoreBackupSnapshot`), with an
  admin-only `/api/ops/restore` route and `/ops` restore control. Restore is an upsert
  workflow, not a full point-in-time database rollback.
- **Application proof upload.** `POST /api/applications/[id]/proof` accepts proof files
  (10MB cap), stores them, records `application_proofs`, updates the application's latest
  proof metadata, and logs activity. `/application-queue` surfaces the latest proof link.
- **AI data assistant (`/chat`) — explicit reversal of the "no AI" stance below.** Read-only
  tool-calling chatbot over candidates/jobs/applications/activity-log/analytics/import-sources
  and (admin-only) the audit log — see `src/lib/ai/tools.ts` for the exact tool list. No
  write/delete tools by deliberate scope decision: it answers questions, it doesn't take
  actions. `src/lib/ai/provider.ts` is a provider-agnostic interface — this was requested
  directly, not a quiet scope creep past the prior "explicitly excluded" decision. Hardened
  since first built: a per-user 200-messages/day cap (cost guardrail against an unsupervised
  runaway client), and failed turns now persist a visible "(error) ..." message in the
  transcript instead of silently dropping the reply half of the exchange. **Bug found and
  fixed during a later pass:** `get_analytics_summary` did a same-origin
  `fetch("/api/analytics")`, which silently 401s now that auth was added (no cookie on a
  server-side fetch) — every call was hitting the bare 3-count fallback, never the real
  rates. Now computes the summary directly instead of round-tripping through the gated
  route. Also added `query_companies` and surfaced `priority`/`review_status` on
  `query_applications` to match tables/columns added after the tool list was first written.
- **Second provider: NVIDIA-hosted `moonshotai/kimi-k2.6`** (`src/lib/ai/nvidiaProvider.ts`),
  added when a real `NVIDIA_API_KEY` arrived mid-session — this is what made live-testing the
  chat assistant possible for the first time (Anthropic's key was never actually set in this
  environment). **Finding from that live test, not a hypothetical:** this model reliably
  decides to call a tool, but degenerates into repeated tokens
  (`finish_reason: "repetition"`) consuming the tool's result a meaningful fraction of the
  time — reproduced across 6+ request variations, so it's the model/endpoint under this
  exact pattern, not a request-format bug here. Mitigated with `frequency_penalty`/
  `presence_penalty` (reduces frequency) and a `looksDegenerate()` output check that falls
  back to raw tool data instead of garbage text — but **prefer Anthropic for this feature
  once that key exists**; NVIDIA/Kimi is the fallback for when it doesn't, not the
  recommended default. `getActiveProvider()` (`src/lib/ai/index.ts`) picks whichever is
  configured, Anthropic first.
- **AI daily digest.** Single-shot (no tool-calling) summary of new jobs/overdue
  tickets/applications-today/pipeline-count, generated daily via `/api/cron/digest` and
  viewable + manually triggerable on `/ops`. Deliberately the simpler generation pattern —
  confirmed live it doesn't hit the degeneration failure mode above, since there's no second
  turn for the model to break on.
- **AI job categorization.** `src/lib/ai/jobCategorization.ts` categorizes jobs against
  active categories and extracts useful salary/work-authorization signals. Processing is
  available through job categorization routes and the `categorize-jobs` cron route. This
  is separate from resume tailoring.
- **Resume tailoring workflow.** Admins/managers/recruiters can open "Tailor resume for
  job" from candidate/job detail surfaces, select a base resume and target job, generate an
  editable markdown draft through the active AI provider, save it as an
  `application_resume_versions` variant, and attach it to an application packet. The prompt
  forbids invented experience and the UI warns to review before sending.
- **Frontend perceived-performance pass + nav rework.** Bundle sizes were already small
  (audited, not assumed) — real win was skeleton loading states (`src/app/Skeleton.tsx`)
  replacing plain "Loading…" text on `/jobs`/`/candidates`/`/audit`/`/import-sources`/`/ops`,
  plus a shimmer animation added to the existing `.loading-panel` convention so
  `/application-queue`/`/companies`/`/follow-ups` improved with zero JSX changes. Nav
  collapsed 8+ flat links into a "More ▾" dropdown and added missing entries for `/chat`,
  `/audit`, `/ops` (previously URL-only, no nav entry). Deliberately skipped
  `jobs/[id]`/`candidates/[id]` — both had page + API route + a new sub-route all dirty
  simultaneously at the time, signaling an active feature deploy not safe to edit around.
- **Company directory.** `/companies` + `/companies/[id]`, normalized from job-posting data
  (`src/lib/companyDirectory.ts`) rather than hand-entered — every distinct employer seen
  across imported postings gets a profile aggregating its jobs and any scraped contact
  people (`company_people`, with an inferred influence level: recruiter/hiring_manager/
  manager/executive/unknown, derived from job title keywords).
- **Saved job searches.** Named, optionally team-shared filter presets for `/jobs`
  (`saved_job_searches` table, `/api/saved-job-searches`) — saves the current
  source/tier/category/employment-type/active/sort combination so a recurring search
  doesn't need re-entering every time.
- **Per-user notifications feed.** `/api/notifications` — queue size/overdue/urgent/
  pending-review counts plus due-follow-up count, scoped to "assigned to me" for the
  `application_engineer` role. API-only so far; no nav badge consumes it yet.
- **External integrations: TalentOS webhook, Microsoft Teams relay, Gmail OAuth.** Fully
  documented in `docs/integrations.md` (env vars, payload shapes, route list) — not
  duplicated here. Summary: an external system can push events into
  `/api/integrations/talent-os/webhook` (shared-secret auth), which logs to
  `integration_events` and optionally relays to a Teams channel webhook; staff and
  candidates (via the portal) can link a Gmail account through an OAuth flow, with tokens
  stored in `integration_accounts`. All three require credentials
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `TEAMS_TALENT_OS_WEBHOOK_URL`,
  `TALENT_OS_WEBHOOK_SECRET`) that aren't set in this environment — wired and ready, not
  yet live anywhere.

- **Threaded comment replies.** `application_comments` got a nullable `parent_comment_id`
  self-reference (`20260618180000_threaded_comments.sql`) — a comment can now be a reply
  to another. This came from comparing this app's recruiting domain against the team's
  separate `skarion-api`/`skarion-app` repos (a different product: course sales +
  affiliate program + a much shallower candidate-tracking module on a NestJS/TypeORM
  backend) — their `JobApplication.comments` jsonb already had a `parentId` field for
  replies, and it was worth porting as an idea even though almost everything else in that
  comparison went the other way (this app's recruiting domain is more mature: resume
  variants, follow-up automation, status timeline, priority/review workflow, audit log,
  companies directory, source/variant analytics — none of which exist there). API
  (`/api/applications/[id]/comments`) and the AI assistant's activity-log tool both
  support/return `parent_comment_id` now. **UI rendering of the thread structure on
  `candidates/[id]` and `jobs/[id]` is deliberately not done yet** — both pages had large
  uncommitted diffs (130+ and 65+ lines) from concurrent work at the time, the same
  collision signal that deferred the skeleton-loading pass on those same two pages
  earlier. Revisit once that settles.
- **Candidate self-login dashboard — scoped, not built.** See
  [docs/candidate-self-login.md](./docs/candidate-self-login.md) for the design doc. The
  one genuinely good idea from the `skarion-api` comparison that doesn't already exist
  here in a better form: candidates get a real account and log in to see their own
  applications/stats, instead of (or alongside) today's magic-link `/portal/<token>`.
  Deliberately not implemented yet — it's a real auth/role-model change, not a copy-paste,
  and needs a decision on whether it replaces or supplements the token portal before
  starting.
- **Live job crawler ingestion + real-time push, and pluggable SharePoint resume
  storage.** Both built and live-tested — see README.md's "What's here" list for the full
  description (dedup behavior, auth gating, SSE mechanism, fail-clearly behavior when
  SharePoint credentials are absent). Both came from the same `skarion-api` comparison;
  the team's actual implementations weren't ported (their crawler bot lives outside both
  repos we could see, and their SharePoint code wasn't reviewed) — these are this app's
  own implementations of the same ideas, built to fit its existing architecture (Supabase
  Realtime instead of Socket.IO, a pluggable storage interface instead of a hard
  dependency on SharePoint).

## Next up (priority order)

1. ~~Bootstrap the first admin account.~~ **Done** — confirmed live: `admin@skarion.local`
   and `engineer@skarion.local` exist in Supabase Auth now. Login is usable.
2. **Candidate self-login dashboard.** Scoped in
   [docs/candidate-self-login.md](./docs/candidate-self-login.md), still not built. The
   current candidate portal is still a magic-link page, not an account/session dashboard.
3. **Gmail intelligence/email classification.** Gmail OAuth/linking exists, but rejection
   detection, recruiter-reply detection, interview invite detection, follow-up generation,
   and application-status updates from email are still not implemented.
4. **Cover-letter generation and deeper tailoring QA.** Resume tailoring now covers
   editable markdown resume drafts. Cover letters, automated truth scoring, and richer
   approval workflows are still not implemented as a production workflow.
5. **Company career pages via Google's `JobPosting` structured data — UI wiring only.**
   Backend done (see "Done" above) and now also runnable on a schedule via
   `/import-sources`, but still not wired into the `/jobs` "Import from ATS" modal as a
   one-off manual option — that file is mid-flight with the auth work.
5. **Application workflow redesign (in progress — Chunk 1 done, Chunk 2 done, Chunk 3 done).**
   - Chunk 1 (schema foundation): nullable `job_id`, pasted JD storage, AI-extracted job
     metadata, resume source tracking — landed.
   - Chunk 2 (JD Analyzer API, parse-only): `POST /api/jobs/analyze` extracts structured
     data from raw JD text via AI. Returns title, company, skills, salary, red flags, etc.
     Does NOT create jobs yet — pure analysis endpoint. Role-gated (admin/manager/recruiter/
     application_engineer only; reviewer excluded).
   - Chunk 3 (Auto-create job from parsed JD): `POST /api/jobs/from-jd` runs the full
     parse → dedup → create workflow. Three-pass duplicate detection (exact URL, exact
     normalized title+company+location, fuzzy Levenshtein). Returns 409 if duplicates found
     unless `forceCreate: true`. On success, inserts a `pasted_jd` source job with all
     AI-extracted fields mapped, triggers webhooks, and logs activity. Gated to
     `MASTER_DATA_MANAGER_ROLES`.
   - Chunk 3.5 (Portability guardrails + Admin AI key manager): Data-access abstractions
     (`src/server/repositories/`) prevent new feature routes from adding direct Supabase
     lock-in. Admin-only `/api/admin/ai-keys` CRUD + test routes. Keys encrypted with
     AES-256-GCM, fingerprinted, never returned to browser. `getActiveProviderAsync()` supports
     DB-managed keys as fallback. Migration readiness doc: `docs/migration-neon-cloudflare.md`.
   - Next chunks: quick-application modal with "Paste JD" option (Chunk 4), resume source
     selector (Chunk 5), AI suggestion generation (Chunk 6), PDF export (Chunk 7). See
     `plan-application-workflow-redesign.md`.

## Explicitly deferred (not just "later" — needs a real decision first)

- **Communication Intelligence (Gmail/Outlook sync).** Email/calendar sync, interview
  detection, rejection detection, and email classification. This is a large OAuth-app-registration + webhook
  surface on its own, comparable in size to the auth work above. Don't start this without
  scoping it as its own phase.
- **The rest of the AI Layer** (cover letters, job-match scoring,
  interview prep, weekly summaries). The blanket "zero AI integrations" version of this
  decision was reversed by direct request — see "Done" above for the one piece built so far
  (a read-only chat assistant). The other pieces listed here are still deferred: each is its
  own scoping decision (data-write implications, cost, accuracy expectations), not something
  that falls out automatically now that *a* AI integration exists. Provider abstraction
  (Ollama-first, swappable to OpenAI/Anthropic/Gemini) is still the right approach when these
  are picked up — `src/lib/ai/provider.ts` already establishes that pattern.
- **Generic event-bus / background worker infrastructure.** The vision doc describes a
  full event-driven architecture (`job_discovered`, `candidate_created`, etc. as first-class
  events). What exists today is the narrow slice that's actually load-bearing —
  `application_events` for the status timeline. Don't build the general version until a
  second real consumer of "events" shows up (e.g. scheduled ingestion, or notifications).
- **Cloudflare full-stack hosting / D1 / R2 migration.** The current app remains Vercel +
  Supabase oriented. Cloudflare hosting is not configured, and D1/R2 migration is not part
  of the current architecture.

## Source documents

- `Project Goals.docx` — the distilled build brief actually used to scope this app.
- `Deep Research Blueprint for a Candidate Placement Operating System.docx` — the original,
  more expansive vision the build brief was distilled from.
