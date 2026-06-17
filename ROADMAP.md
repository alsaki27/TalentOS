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
- **Jobs list pagination + server-side filtering.** `/api/jobs` now paginates (50/page) and
  filters/sorts server-side instead of shipping every row to the browser — the unpaginated
  version had grown to a 24MB response at 1,000 rows (full LinkedIn HTML descriptions + raw
  scraper payloads on every row). The list view also now excludes `description_html` and
  `raw_source_payload` (detail-page-only fields). A new `/api/jobs/facets` endpoint supplies
  filter dropdown options (sources/employment types/categories) without needing the full
  unpaginated dataset. CSV export still exports all matching rows (up to a 5,000-row cap),
  not just the current page.
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

## Next up (priority order)

1. **Authentication + roles.** The single biggest gap — there is currently zero auth, and
   every API route runs with full database access via the service role key. Needs:
   Supabase Auth (or Clerk) integration, a `users`/`profiles` table, at least two roles
   (e.g. agency admin, recruiter — candidates likely don't need their own login for an
   internal tool, but confirm), and every existing API route gated on the caller's role.
   This touches every route, so it's sized as its own dedicated pass, not a quick add.
   This is also why `assigned_by`/`assigned_to` on applications are still free-text names
   rather than real user references — revisit once accounts exist.
2. **Pagination / server-side filtering for the remaining lists.** Jobs is done (see
   above). Candidates, the application queue, and follow-ups are still small (single/low
   double-digit rows today) and filter client-side; revisit each once it approaches ~1,000
   rows, same threshold and approach as jobs.
3. **Company career pages via Google's `JobPosting` structured data.** Same non-AI,
   real-data pattern as the ATS importers — fetch a career page URL, extract embedded
   JSON-LD `JobPosting` schema.org data. Not started.
4. **Scheduled ingestion.** Right now ATS/CSV/LinkedIn imports are manual button-clicks.
   Could move to a Vercel cron hitting `/api/import/ats` on a schedule per saved
   company/board — deferred because it adds a recurring-job concept with no UI for managing
   it yet.

## Explicitly deferred (not just "later" — needs a real decision first)

- **Communication Intelligence (Gmail/Outlook sync).** Email/calendar sync, interview
  detection, rejection detection. This is a large OAuth-app-registration + webhook
  surface on its own, comparable in size to the auth work above. Don't start this without
  scoping it as its own phase.
- **The AI Layer** (resume tailoring, job-match scoring, email classification, interview
  prep, weekly summaries). Explicitly excluded by request — this app intentionally has zero
  AI integrations right now. When this is revisited, the original vision doc calls for
  provider abstraction (Ollama-first, swappable to OpenAI/Anthropic/Gemini) rather than
  hardcoding one provider.
- **Generic event-bus / background worker infrastructure.** The vision doc describes a
  full event-driven architecture (`job_discovered`, `candidate_created`, etc. as first-class
  events). What exists today is the narrow slice that's actually load-bearing —
  `application_events` for the status timeline. Don't build the general version until a
  second real consumer of "events" shows up (e.g. scheduled ingestion, or notifications).

## Source documents

- `Project Goals.docx` — the distilled build brief actually used to scope this app.
- `Deep Research Blueprint for a Candidate Placement Operating System.docx` — the original,
  more expansive vision the build brief was distilled from.
