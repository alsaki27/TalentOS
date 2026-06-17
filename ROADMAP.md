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

## Next up (priority order)

1. **Authentication + roles.** The single biggest gap — there is currently zero auth, and
   every API route runs with full database access via the service role key. Needs:
   Supabase Auth (or Clerk) integration, a `users`/`profiles` table, at least two roles
   (e.g. agency admin, recruiter — candidates likely don't need their own login for an
   internal tool, but confirm), and every existing API route gated on the caller's role.
   This touches every route, so it's sized as its own dedicated pass, not a quick add.
2. **Pagination / server-side filtering.** Current filtering is client-side over the full
   fetched list. Fine today; revisit once any list approaches ~1,000 rows.
3. **Storage cleanup on delete.** Deleting a candidate, resume variant, or job removes the
   DB row but leaves the file behind in Supabase Storage. Low risk, low cost — just hasn't
   been done yet.
4. **More job sources.** USAJobs (real public API, needs a free API key signup), company
   career pages via Google's `JobPosting` structured data. Same non-AI, real-data pattern as
   the existing Greenhouse/Lever/Ashby importers.
5. **Scheduled ingestion.** Right now ATS/CSV/LinkedIn imports are manual button-clicks.
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
