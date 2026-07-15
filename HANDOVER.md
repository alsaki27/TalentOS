# HANDOVER — July 14, 2026

**Project:** TalentOS (Skarion Tracker)  
**Branch:** `istiaque-updates` (merging with `origin/latest-updates`)  
**Database:** Neon Postgres  

---

## 1. Database Connection Fix

### Problem
`NeonDbError: TypeError: fetch failed` on every page load. The app was completely unusable.

### Root Cause
`src/server/db/neon.ts` passed `fetchOptions: { cache: "no-store" }` to the `neon()` constructor. This is a Next.js-specific `fetch` extension — the Neon HTTP driver passes it directly to the global `fetch()`, which on Node.js/undici doesn't recognize `cache` and throws.

Second issue: the `DATABASE_URL` in `.env.local` contained `channel_binding=require`, a raw-TCP Postgres parameter the HTTP driver can't use.

### Fix
- Removed `fetchOptions: { cache: "no-store" }` from `neon()` initialization
- Added automatic stripping of `channel_binding` from the URL in `getDatabaseUrl()`
- Added comment documenting why these params must not be passed

### File
`src/server/db/neon.ts`

---

## 2. Job Agent — Date Posted Filter

### Problem
Only the "Today" option worked. Selecting "2 Days", "7 Days", or "30 Days" returned zero results or silently ignored the filter.

### Root Cause
The Apify actor `khadinakbar~google-jobs-scraper` accepts only a specific enum for `datePosted`: `any`, `today`, `3days`, `week`, `month`. The UI was passing raw strings `2 days`, `7 days`, `30 days` which the actor didn't recognize.

### Fix
Added `toApifyDatePosted()` mapping function in `jobAgentService.ts`:

| UI Selection | Sent to Apify |
|---|---|
| Today | `today` |
| 2 Days | `3days` |
| 7 Days | `week` |
| 30 Days | `month` |
| Any Time | `any` |

Unrecognized values default to `"today"` with a console warning.

### File
`src/server/services/jobAgentService.ts`

---

## 3. Job Agent — AI Control Center Integration

### Problem
The job agent classifier (`jobAgentClassifier.ts`) called `callWithUsageTracking("job_categorization", …)` but completely ignored the `ai_agent_configs` table. System prompt, temperature, max tokens, and the active flag were all hardcoded. No default config existed for `job_categorization`.

### Fix
- Rewrote `classifyWithAi()` to call `findAgentConfigByAutomationId("job_categorization")` before each classification
- Uses configured `system_prompt`, `temperature`, `max_output_tokens`, `timeout_ms`, and `is_active`
- When no admin-set system prompt exists, uses a built-in rule set that preserves the correct tier logic for OSP/Fiber (Group A) vs entry-level groups (B–L)
- Falls back to the deterministic regex classifier if the config is disabled or AI fails
- Logs provider/model/route used on every classification
- **Parallelized classification**: changed from sequential (`for` loop with 300ms delay per job) to 5 concurrent calls per batch. 500 jobs now completes in ~100s instead of ~44 minutes

### Files
`src/lib/ai/jobAgentClassifier.ts`  
`src/server/services/jobAgentService.ts` (classifyJobs function)

---

## 4. Job Agent — Review Page Bulk Approve Fix

### Problem
"Approve All Best" and "Approve Best + Medium" buttons imported zero jobs. Only "Approve All Non-Skip" worked.

### Root Cause
`importApprovedJobs()` filtered staged jobs by `importStatus: "approved"`, but the UI never marked jobs as approved before calling import. Jobs remained in `import_status = 'staged'` and weren't found.

### Fix
- Tier-based and jobIds-based approvals now first call `bulkUpdateStagedJobStatus(runId, "approved", …)` to mark target jobs, then import them
- Imported/skipped counts now increment instead of overwrite, so multiple partial imports (Best, then Medium) don't reset each other's counts
- `excludeImportStatus: "imported"` prevents re-approving already-imported rows

### File
`src/lib/jobAgentImporter.ts`

---

## 5. Job Agent — Token Priority Fix

### Problem
New tokens defaulted to priority `0`, which always won rotation (lowest priority runs first). The UI starts at `1`.

### Fix
`insertToken()` now auto-computes the next available priority when none is supplied: `MAX(priority) + 1`, or `1` if the table is empty.

### File
`src/server/repositories/jobAgentTokenRepository.ts`

---

## 6. Job Agent — Live Scraping Feed Rework

### Problems
1. LiveFeedBoard only mounted for `status === "running"`, but runs start as `"pending"`. The board never appeared during initialization.
2. Multiple concurrent `processApifyRunData` calls created duplicate staged-job rows (no idempotency guard).
3. Without `CRON_SECRET`, the Apify run finished but `processApifyRunData` was never called — data stayed stuck in "running" forever.
4. Errors were silently logged; the UI showed no feedback.

### Fixes
- **LiveFeedBoard** now shows for `pending`, `running`, and `processing` statuses
- Added status label display (Initializing… / Scraping… / Processing…) with per-stage loading messages
- Added "last updated" timestamp and error display
- **Live API endpoint** (`runs/[id]/live/route.ts`) now auto-triggers `processApifyRunData` when it detects the Apify run has `SUCCEEDED`
- Added `processingSet` guard to prevent concurrent processing
- Run status transitions: `pending` → `running` → `processing` → `succeeded`/`failed`
- On processing failure, the run is marked `failed` with the error
- **Dashboard** (page.tsx) shows live feed for all active states; status badges show correct labels (⏳ pending…, ⏳ scraping…, ⚙ classifying…)

### Files
`src/app/job-agent/LiveFeedBoard.tsx`  
`src/app/api/job-agent/runs/[id]/live/route.ts`  
`src/app/job-agent/page.tsx`

---

## 7. Job Agent — Cron Dedup Fix

### Problem
The daily cron (`/api/cron/job-agent`) passed `customKeywords: titles` alongside `roleGroups: cg.subGroupIds`. Since `getSearchQueries()` already expands role groups to titles, every title was sent to Apify twice — doubling the query list and wasting API calls.

### Fix
Removed `customKeywords: titles` from the cron route. Role group titles are already included by `getSearchQueries()`.

### File
`src/app/api/cron/job-agent/route.ts`

---

## 8. Scoring & ATS — AI Routing Migration

### Problem
"Generate Score" on the jobs page and "ATS Score Analysis" page both failed with `429 OpenAI quota exceeded`. Four endpoints were using `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` directly, completely bypassing the AI Control Center routing system.

### Fix
All 4 endpoints now use `callWithUsageTracking()` with proper automation IDs:

| File | Automation ID | Previous approach |
|---|---|---|
| `src/lib/atsScoring.ts` | `ats_extraction` + `ats_narrative` | `new OpenAI()` x2 |
| `src/app/api/jobs/match-score/route.ts` | `job_match_score` | `new OpenAI()` |
| `src/app/api/jobs/autofill-form/route.ts` | `job_autofill` | `new OpenAI()` |
| `src/app/api/jobs/[id]/analyze/route.ts` | `jd_analysis` (reuses existing) | `new OpenAI()` |

The `import OpenAI from "openai"` is completely removed from all 4 files. The `response_format: { type: "json_object" }` / `json_schema` patterns are replaced with prompt-level JSON instructions plus a `parseJson()`/`safeJsonParse()` wrapper, which is provider-agnostic (works with Google, Anthropic, DeepSeek, etc.).

### Files
`src/lib/atsScoring.ts`  
`src/app/api/jobs/match-score/route.ts`  
`src/app/api/jobs/autofill-form/route.ts`  
`src/app/api/jobs/[id]/analyze/route.ts`

---

## 9. AI Routing — Auto-Retry on Rate Limit

### Problem
When the global fallback chain picked the exhausted OpenAI key, `callWithUsageTracking` threw immediately with a 429 error. There was no retry with the next available provider.

### Fix
- `callWithUsageTracking()` now retries up to 3 times on `rate_limit` / `auth_error`
- Failed providers are excluded via `excludeKeyIds` and `excludeProviderNames`
- `getProviderForAutomation()` now accepts `excludeProviderNames` to skip providers that already failed in the current call chain
- The global fallback path in `getProviderForAutomation()` now iterates through ALL providers (Anthropic → NVIDIA → Google Vertex → Google → OpenAI → GLM → DB keys) instead of calling `getActiveProviderAsync()` once
- On retry, the system logs which provider failed and which is being tried next

### File
`src/lib/ai/routing.ts`

---

## 10. `.env.local` — Disarmed Exhausted OpenAI Key

### Problem
`OPENAI_API_KEY=sk-proj-…` was still active in `.env.local`. The global fallback chain picked it first, got 429 on every call, and even with retry logic there was no other working key to fall back to.

### Fix
Commented out the `OPENAI_API_KEY` line with a note directing users to configure AI keys via `/admin/ai` → API Keys.

### File
`.env.local`

---

## 11. AI Control Center — Save Configuration Fixes

### Problems
1. **Route save never persisted** — `sql.transaction(queries)` passed an array of pre-executed promises from `sql.query()`. The Neon driver's `transaction()` expects a callback returning `tx.query()` promises. Every save silently failed.
2. **`prompt_version` and `output_schema_version` never saved** — validation checked `typeof === "number"` but the DB column is `text` and the frontend sends strings.
3. **New agent config insert failed with NOT NULL violation** — `display_name` has no default. Saving without typing a name threw a DB error.

### Fixes
- Route save now uses `sql.transaction((tx) => { return [tx.query(...), ...]; })` — queries execute within a single atomic transaction
- `prompt_version` and `output_schema_version` validation changed to `String(body.field)` → accepts strings, numbers, or leaves undefined
- New config INSERT falls back to the automation's label (e.g. "Job Match Score") as default `display_name`

### Files
`src/app/api/admin/ai/agents/[id]/routes/route.ts`  
`src/app/api/admin/ai/agents/[id]/route.ts`

---

## 12. Jobs Page — Pagination Improvements

### Changes
- Pagination now renders at **both top and bottom** of the table
- Added a **page number input** with a "Go" button
- Enter a page number and press Enter or click Go to jump directly
- Invalid values show a red error: `"Enter a valid page number"` or `"Page must be 1–X"`
- Pagination logic extracted into a reusable `renderPagination({ marginTop, marginBottom })` function
- Bottom pagination has added spacing above the table (`marginTop: 32`)

### File
`src/app/jobs/page.tsx`

---

## 13. Scheduled Cron — Daily Job Agent Scrape

### Problem
`vercel.json` had the poll cron (`* * * * *`) but no cron entry for the actual job agent run. The daily automated scrape was never scheduled.

### Fix
Added cron entry:
```json
{ "path": "/api/cron/job-agent", "schedule": "0 0 * * *" }
```
`0 0 * * *` = midnight UTC = **6:00 AM Bangladesh Standard Time (UTC+6)** daily.

Requires `CRON_SECRET` to be set in Vercel environment variables.

### File
`vercel.json`

---

## 14. Database — Records Cleanup

### What was done
All run history and scraped job data were deleted from the Neon database:

```sql
DELETE FROM job_agent_staged_jobs;
DELETE FROM job_agent_runs;
```

### Preserved
- 45 Apify API tokens (`job_agent_apify_tokens`)
- 2 configurations (`job_agent_configs`)
- 2 keyword groups (`job_agent_keyword_groups`)
- All AI keys, routes, and other non-Job-Agent tables

---

## 15. New Migration Files

| File | Purpose | Must apply? |
|---|---|---|
| `migrations/job_agent_ai_config.sql` | Seeds default `ai_agent_configs` row for `job_categorization` | Yes |
| `migrations/scoring_ai_automations.sql` | Seeds 4 new automation rows + default agent configs (`job_match_score`, `ats_extraction`, `ats_narrative`, `job_autofill`) | Yes |
| `neon/cleanup_job_agent_runs.sql` | Cleanup script (already executed; keep for reference) | No |

---

## What You Need to Do Next

1. **Apply the migrations** to Neon:
   ```sql
   \i migrations/scoring_ai_automations.sql
   \i migrations/job_agent_ai_config.sql
   ```

2. **Add a working AI key**: Go to `/admin/ai` → API Keys → add a Google or Anthropic key. Then Assign it to the automations in Agents & Routing.

3. **Set `CRON_SECRET`** in Vercel env vars to enable daily cron.

4. **Restart dev server** — all changes require recompilation.

5. **Push the branch** if not already done:
   ```powershell
   cd C:\Shohan\Skarion\TalentOS
   git add -A
   git commit -m "All AI routing, job agent, and pagination fixes from July 14"
   git checkout -b istiaque-updates
   git push origin istiaque-updates
   ```
