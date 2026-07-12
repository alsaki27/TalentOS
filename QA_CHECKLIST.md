# Pre-Deploy QA Checklist

Run before any deploy that touches user-facing functionality.

## Core workflow (5 checks)

- [ ] **Create a test candidate** — All Step 1 fields (name, email, phone, target roles, preferred locations, salary expectation, work authorization) are preserved after save.
- [ ] **Build a base resume via Falood Studio** — Open a candidate, navigate to Falood Studio, build a base resume from manual text or uploaded file. Verify the resume variant appears in the candidate's resume list.
- [ ] **Create an application against an existing job** — From the application queue or candidate page, create a new application ticket linked to an existing job. Verify status defaults correctly and the ticket appears in the queue.
- [ ] **Start the AI pipeline from the queue** — On an in-progress application, click "Start Pipeline" or "Run Pipeline". Verify the status changes and pipeline stages begin rendering.
- [ ] **Watch pipeline progress through stages without reload** — After starting the pipeline, verify stages advance automatically (or with refresh) and the tailed resume is eventually created and linked to the application.

## Data integrity (5 checks)

- [ ] **Follow-ups page loads without errors, counts match** — Navigate to `/follow-ups`. Verify counts shown match the actual items in the list. Test overdue vs. upcoming filter counts.
- [ ] **Analytics dashboard renders all widgets** — Navigate to `/analytics`. Verify conversion metrics, source breakdown, and resume variant stats all render without blank sections or errors.
- [ ] **Review Queue count matches actionable items** — Navigate to `/review`. Verify the displayed count matches the number of items requiring review (pipeline stages needing human approval).
- [ ] **Tailored resume linked to correct application/candidate/job** — After pipeline completes, open the application detail. Verify the tailored resume variant references the correct candidate, job, and application IDs.
- [ ] **AI digest shows current date and accurate counts** — On `/ops`, generate a new AI digest. Verify the digest content references today's date (or the most recent date) and the counts for new jobs, overdue tickets, etc. are accurate.

## AI Control Center (5 checks)

- [ ] **`/admin/ai` loads all 4 tabs** — Navigate to `/admin/ai`. Verify tabs render: Key Manager, Task Routing, Agent Manager, Usage & Logs.
- [ ] **Add and test an API key** — In Key Manager, add a new API key. Click "Test" to verify the key works with the configured provider.
- [ ] **Assign key to an agent with model override** — In Task Routing or Agent Manager, assign a key to a specific agent and set a model override. Verify the override persists after page reload.
- [ ] **Verify usage events appear in Usage & Logs** — After generating a digest or running a pipeline stage, verify the AI usage event appears in the Usage & Logs tab with correct provider, model, and token counts.
- [ ] **Health overview shows accurate readiness status** — On `/ops`, verify the AI health cards (default, resume, chat, parsing, content) show correct provider names and "configured" status matching the keys in `/admin/ai`.

## Operational (4 checks)

- [ ] **Scheduled jobs workflow ran recently in GitHub Actions** — Check `.github/workflows/` for CI/CD status. Verify the latest run completed successfully without typecheck, lint, or build errors.
- [ ] **Backup ran successfully** — On `/ops`, check the Backup Health section. Verify the last successful backup timestamp is recent (within 24h) and no failure errors are shown.
- [ ] **No raw database errors visible to users** — Navigate through all major pages (`/candidates`, `/jobs`, `/application-queue`, `/follow-ups`, `/analytics`, `/ops`). Verify no raw SQL errors, stack traces, or "undefined" text appears in the UI. Errors should be user-friendly messages.
- [ ] **Manager role (if assigned) has correct access** — If a manager role account exists: log in as manager, verify access to `/candidates`, `/jobs`, `/application-queue`, `/analytics`. Verify Team page (`/team`) and AI Control Center (`/admin/ai`) are denied. If no manager account exists: note this as pending.

## Responsive layout (2 checks)

- [ ] **Tables on all pages scroll within container, not page** — At 1280px and 1366px viewport widths, verify table rows on `/candidates`, `/jobs`, `/application-queue`, `/follow-ups`, `/ops` scroll horizontally within their card containers. The page body should not gain a horizontal scrollbar.
- [ ] **No action buttons hidden off-screen without scrollbar visible** — At 1280px width, verify all primary action buttons (Create, Save, Delete, Import, Export) are visible without requiring horizontal scroll. The filter bar and bulk action bar should wrap or remain accessible.

## Pre-deploy final checks

- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run lint` passes with zero warnings
- [ ] `npm run build` completes successfully
- [ ] `.env.local` (or production env vars) includes all required values from `.env.example`
- [ ] `CRON_SECRET` is set in production for scheduled jobs
- [ ] No console errors on page load for any major route
