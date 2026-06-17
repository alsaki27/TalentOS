# TalentOS (Skarion Tracker) — Candidate Placement Dashboard

An internal tool for tracking candidates, the jobs they're targeting, and every application
in between. Started as a simple candidate/job/application tracker and has grown into a
small "candidate placement OS" — job sourcing from multiple channels, resume version
tracking, follow-up reminders, a status timeline per application, and conversion analytics.
No AI integrations yet (see [ROADMAP.md](./ROADMAP.md) for why and what's planned).

## Setup (10–15 min)

1. **Create a Supabase project** (free tier) at supabase.com.
2. **Run the schema:** open the SQL editor in your Supabase project, paste in `sql/01_schema.sql`,
   run it. This creates `candidates`, `jobs`, `applications`, `resumes`, and `application_events`
   tables plus a `resumes` storage bucket (also used for candidate profile photos, under an
   `avatars/` prefix).
   - If the storage bucket insert at the bottom errors, create a bucket named `resumes`
     (public) manually via Storage in the Supabase dashboard instead.
   - Alternatively, if you have the Supabase CLI linked to your project, the same schema
     lives as incremental migrations in `supabase/migrations/` — `supabase db push` applies
     them in order.
3. **Env vars:** create `.env.local` in the project root:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
   Both values are in your Supabase project settings → API. **Never commit this file** —
   the service role key bypasses all database access control.
4. **Install + run:**
   ```bash
   npm install
   npm run dev
   ```
5. Open `http://localhost:3000` — it redirects to `/candidates`.

## What's here

- **`/candidates`** — masterlist with search + status/tier filters, multi-select bulk delete,
  CSV export. Click a name for their profile: contact info, target roles/locations/salary/work
  authorization, a profile photo (shown as a circle avatar throughout the app), a primary
  resume upload, multiple **resume/cover-letter variants** (tailored per job), and every
  application they've made — each with a follow-up date and an expandable status-change
  history.
- **`/jobs`** — the job masterlist. Search + filter by source/tier/active-status/employment
  type, sort by posted date, multi-select bulk delete, CSV export. Add jobs manually, import
  a CSV, import a raw LinkedIn scraper JSON dump, or pull live postings straight from a
  company's public **Greenhouse/Lever/Ashby** job board (no scraping, no auth). Re-importing
  any source skips jobs already in the masterlist (matched by posting URL) instead of
  duplicating them. Click a job to see/edit every field, including the LinkedIn/ATS-sourced
  ones (seniority level, employment type, applicant count, company size/website, posted
  date). Applicants for a job show as avatar circles so you can tell at a glance who's
  already applied. "Log application" lets you pick which resume variant was used.
- **`/follow-ups`** — every application with a follow-up date set, across all candidates.
  Filter by status/search/overdue-vs-upcoming, mark done (clears the date) or delete the
  application outright, single or in bulk.
- **`/analytics`** — non-AI conversion metrics: response/interview/offer rates, performance
  broken down by job source (which channels actually convert) and by resume variant (which
  tailored resume gets more interviews).

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

## Architecture notes

- Next.js 14 App Router, plain CSS (no component library) — see `src/app/globals.css` for
  the full token/class set (`.card`, `.table`, `.modal`, `.filter-bar`, `.bulk-bar`, `.badge`,
  `.avatar-circle`, etc.).
- All API routes (`src/app/api/**/route.ts`) talk to Supabase via the shared client in
  `src/lib/supabase.ts`, using the **service role key** (full access, bypasses Row Level
  Security) since there is currently **no authentication** — see Known gaps below.
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

## Known gaps (read before relying on this for anything sensitive)

- **No authentication at all.** Every API route uses the Supabase service role key directly.
  Anyone with the app URL has full read/write access to every candidate, resume, and
  application. Do not deploy this publicly without adding auth first (tracked in ROADMAP.md).
- No pagination — list pages fetch and render every row client-side. Fine at hundreds of
  rows, will need addressing before thousands.
- Storage cleanup on delete is incomplete: deleting a candidate/resume-variant/job removes
  the database row but not the underlying file in Supabase Storage.

## Deploy

Push to GitHub, import into Vercel, add the same two env vars there. Done — no other config
needed (until auth is added, see ROADMAP.md).

## Background

This started from a much larger vision document (`Project Goals.docx`, distilled from
`Deep Research Blueprint for a Candidate Placement Operating System.docx`) describing a full
"Candidate Placement Operating System" — job aggregation, resume tailoring AI, email/calendar
sync, interview prep, the works. What's built so far is deliberately the **non-AI v1 slice**
of that vision. See [ROADMAP.md](./ROADMAP.md) for what's next and why each piece was
sequenced where it was.
