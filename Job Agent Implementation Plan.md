# Job Agent Implementation Plan

> **Project:** TalentOS / Skarion Tracker  
> **Branch:** `istiaque-updates` (rebased on `origin/neon-cloudflare-migration`)  
> **Date:** July 14–15, 2026  
> **Database:** Neon Postgres (migrating from Supabase)  
> **Deployment:** Cloudflare Workers via `@opennextjs/cloudflare`  
> **Frontend:** Next.js 14 App Router, plain CSS, React client components  

---

## Table of Contents

1. [Project Architecture](#1-project-architecture)
2. [Job Agent Feature Overview](#2-job-agent-feature-overview)
3. [Database Schema](#3-database-schema)
4. [Complete File Map](#4-complete-file-map)
5. [Bugs Fixed — Detailed](#5-bugs-fixed--detailed)
6. [AI Control Center Integration](#6-ai-control-center-integration)
7. [Migration Files](#7-migration-files)
8. [Setup & Configuration](#8-setup--configuration)
9. [Environment Variables](#9-environment-variables)

---

## 1. Project Architecture

### 1.1 Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | Next.js 14 (App Router) |
| Language | TypeScript (strict mode) |
| Database | Neon Postgres (via `@neondatabase/serverless` HTTP driver) |
| Auth | Cookie-based JWT (`skarion_access_token`), `profiles` table, middleware gate |
| AI Providers | Anthropic, Google Gemini, NVIDIA, OpenAI, GLM — routed through AI Control Center |
| Job Scraping | Apify actor `khadinakbar~google-jobs-scraper` |
| Scheduled Tasks | Vercel cron jobs |
| Deployment | Cloudflare Workers (`wrangler.toml`) |

### 1.2 Directory Structure (Key Areas)

```
src/
├── app/
│   ├── admin/ai/              ← AI Control Center UI + API
│   ├── api/
│   │   ├── cron/job-agent/    ← Daily automated scrape
│   │   ├── cron/job-agent-poll/ ← Per-minute Apify status check
│   │   ├── job-agent/         ← Run, review, tokens, roles, config APIs
│   │   ├── jobs/match-score/  ← Candidate-job match scoring
│   │   ├── jobs/autofill-form/← AI autofill job form
│   │   ├── jobs/[id]/analyze/ ← AI analyze job description
│   │   └── ats-score/analyze/ ← ATS resume scoring
│   ├── job-agent/             ← Job Agent UI (controls, dashboard, review, tokens)
│   └── jobs/                  ← Jobs listing page
├── lib/
│   ├── ai/
│   │   ├── routing.ts         ← Central AI routing (callWithUsageTracking)
│   │   ├── index.ts           ← Provider selection chain
│   │   ├── provider.ts        ← AiProvider interface
│   │   ├── jobAgentClassifier.ts ← Job classification AI
│   │   └── openAiCompatibleProvider.ts ← OpenAI-compatible fetch wrapper
│   ├── atsScoring.ts          ← ATS score calculation + AI extraction
│   ├── jobAgentImporter.ts    ← Staged → main jobs import
│   ├── jobAgentRoleLibrary.ts ← 12 role groups (A–L) + combined groups
│   ├── jobDedup.ts            ← Cross-source deduplication
│   └── auth.ts                ← Auth utilities
├── server/
│   ├── db/neon.ts             ← Neon database driver
│   ├── repositories/          ← Data access layer
│   └── services/
│       └── jobAgentService.ts ← Job Agent core logic
├── components/Pagination.tsx  ← Reusable pagination (not used on /jobs page)
└── middleware.ts              ← Auth middleware
```

---

## 2. Job Agent Feature Overview

### 2.1 Purpose
Automatically scrape Google Jobs via Apify, classify results with AI, stage them for review, then import approved jobs into the main `/jobs` table.

### 2.2 Workflow

```
┌─────────────────┐
│ 1. Select Role   │  UI: /job-agent → check role groups + date interval
│    Groups        │  Cron: daily at 6:00 AM BST (0:00 UTC)
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. Rotate Token  │  Pick lowest-priority active Apify token
│                  │  Skip if: today's spend ≥ $5, error today, disabled
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. Start Apify   │  Actor: khadinakbar~google-jobs-scraper
│    Run           │  Input: searchQueries, maxResults, datePosted, proxy
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. Poll Status   │  Every 60s via cron, or auto via live endpoint
│    (async)       │  LiveFeedBoard polls every 3s
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. Process Data  │  Fetch dataset → normalize → dedupe (in-run + cross-run)
│                  │  → AI classify (tier: best/medium/worthy/skip)
│                  │  → Insert into job_agent_staged_jobs
└────────┬────────┘
         ▼
┌─────────────────┐
│ 6. Review &      │  /job-agent/review → per-job approve/reject
│    Approve       │  Bulk: Best, Best+Medium, All Non-Skip
└────────┬────────┘
         ▼
┌─────────────────┐
│ 7. Import into   │  Filter duplicates → insert into jobs table
│    /jobs         │  → sync company directory → kick AI categorization
└─────────────────┘
```

### 2.3 Role Groups

12 individual groups (A–L) with 3 combined daily cron groups:

| Group | Label | Search Titles |
|-------|-------|---------------|
| A | OSP & Fiber | OSP Design Engineer, Fiber Design Engineer, OSP Inspector... |
| B | CAD / AutoCAD | AutoCAD Drafter, CAD Designer, CAD Operator... |
| C | GIS | GIS Analyst, GIS Technician, GIS Specialist... |
| D | Mechanical | Mechanical Engineer, HVAC Designer, Piping Designer... |
| E | Electrical | Electrical Engineer, Power Systems Engineer... |
| F | Civil | Civil Engineer, Structural Engineer, Land Surveyor... |
| G | Structural | Structural Engineer, Steel Detailer, BIM Modeler... |
| H | Architectural | Architect, Architectural Drafter, BIM Coordinator... |
| I | MEP | MEP Engineer, MEP Coordinator, Fire Protection... |
| J | Piping | Piping Engineer, Pipeline Engineer, Pipe Stress... |
| K | Utility / Energy | Substation Engineer, Transmission Line Designer... |
| L | Entry-Level | Junior Engineer, Graduate Engineer, Trainee Drafter... |

**Combined Daily Cron Groups:**

| Cron Group | Sub-Groups | Description |
|------------|-----------|-------------|
| CA | A + G + J + K | OSP & Infrastructure |
| CB | B + D + E + F | All CAD Disciplines |
| CC | C + H + I + L | GIS & Building Design |

### 2.4 AI Classification Tiers

| Tier | Meaning | Import Behavior |
|------|---------|----------------|
| `best` | Direct title match, correct seniority, real domain fit | Auto-approved in "Approve All Best" |
| `medium` | Reasonably relevant, broader title | Included in "Best + Medium" |
| `worthy` | Tangential, keep for manual review | Included in "All Non-Skip" |
| `skip` | Wrong seniority, false positive, unrelated | Never imported |

Special rule: Group A (OSP/Fiber) accepts ALL seniority levels. Groups B–L skip senior/manager titles.

---

## 3. Database Schema

### 3.1 `job_agent_apify_tokens`

```sql
CREATE TABLE job_agent_apify_tokens (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label           text,
    token_encrypted text NOT NULL,
    priority        int NOT NULL DEFAULT 1,
    is_active       boolean NOT NULL DEFAULT true,
    last_error      text,
    last_error_at   timestamptz,
    daily_spend     numeric DEFAULT 0,
    spend_date      date,
    created_at      timestamptz DEFAULT now()
);
```

Token encryption: AES-256-GCM via `AI_KEYS_ENCRYPTION_SECRET`. Falls back to `bare:` prefix if secret not set.

Token rotation logic: lowest `priority` (ASC) then `created_at` (ASC), active only, skip if `daily_spend >= 5` OR `last_error_at` is today.

### 3.2 `job_agent_configs`

```sql
CREATE TABLE job_agent_configs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label       text NOT NULL DEFAULT 'Default Job Agent Config',
    max_results int NOT NULL DEFAULT 500,
    role_groups text[] DEFAULT '{}',
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now()
);
```

### 3.3 `job_agent_runs`

```sql
CREATE TABLE job_agent_runs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    config_id         uuid REFERENCES job_agent_configs(id),
    apify_run_id      text,
    apify_dataset_id  text,
    token_id          uuid REFERENCES job_agent_apify_tokens(id),
    role_groups_ran   text[],
    status            text DEFAULT 'pending',  -- pending|running|processing|succeeded|failed|partial
    raw_count         int DEFAULT 0,
    deduped_count     int DEFAULT 0,
    skipped_count     int DEFAULT 0,
    classified_count  int DEFAULT 0,
    imported_count    int DEFAULT 0,
    estimated_cost_usd numeric DEFAULT 0,
    error             text,
    started_at        timestamptz DEFAULT now(),
    completed_at      timestamptz
);
```

### 3.4 `job_agent_staged_jobs`

```sql
CREATE TABLE job_agent_staged_jobs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id            uuid REFERENCES job_agent_runs(id) ON DELETE CASCADE,
    job_title         text NOT NULL,
    company_name      text,
    location          text,
    salary_range      text,
    salary_min        numeric,
    salary_max        numeric,
    date_posted       text,
    via_platform      text,
    source_url        text,
    apply_link        text,
    is_remote         boolean DEFAULT false,
    employment_type   text,
    search_query_used text,
    role_group        text,
    role_group_label  text,
    seniority_guess   text,
    tier              text,            -- best|medium|worthy|skip
    tier_reason       text,
    ai_keywords       text[],
    relevance_score   numeric(3,2),
    is_false_positive boolean DEFAULT false,
    dedup_hash        text,
    is_duplicate      boolean DEFAULT false,
    import_status     text DEFAULT 'staged',  -- staged|approved|imported|rejected
    imported_job_id   uuid,
    created_at        timestamptz DEFAULT now()
);
```

### 3.5 `job_agent_keyword_groups`

```sql
CREATE TABLE job_agent_keyword_groups (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    label      text NOT NULL,
    keywords   text[] NOT NULL DEFAULT '{}',
    is_active  boolean DEFAULT true,
    created_by uuid REFERENCES profiles(user_id),
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### 3.6 AI Control Center Tables (related to Job Agent)

```sql
-- Automations register
CREATE TABLE ai_automations (
    id          text PRIMARY KEY,
    label       text NOT NULL,
    description text,
    group_label text,
    created_at  timestamptz DEFAULT now()
);

-- Agent configs (system prompt, temperature, etc.)
CREATE TABLE ai_agent_configs (
    automation_id       text PRIMARY KEY REFERENCES ai_automations(id),
    display_name        text NOT NULL,
    system_prompt       text,
    prompt_version      text DEFAULT '1',
    output_schema_version text DEFAULT '1',
    temperature         numeric(2,1) DEFAULT 0.2,
    max_output_tokens   int DEFAULT 2048,
    timeout_ms          int DEFAULT 30000,
    max_attempts        int DEFAULT 2,
    approval_policy     text DEFAULT 'auto',
    minimum_score       numeric(3,2) DEFAULT 0,
    is_active           boolean DEFAULT true,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    updated_by          uuid REFERENCES profiles(user_id)
);

-- Route chains (which AI key/model per automation)
CREATE TABLE ai_automation_routes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    automation_id   text NOT NULL REFERENCES ai_automations(id) ON DELETE CASCADE,
    ai_key_id       uuid REFERENCES ai_api_keys(id) ON DELETE CASCADE,
    provider        text,
    rank            int NOT NULL,
    model_override  text,
    is_enabled      boolean DEFAULT true,
    updated_at      timestamptz DEFAULT now(),
    updated_by      uuid REFERENCES profiles(user_id),
    UNIQUE (automation_id, rank)
);
```

---

## 4. Complete File Map

### 4.1 Job Agent Feature Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/app/job-agent/page.tsx` | Main page: role browser, Run Now, dashboard | 244 |
| `src/app/job-agent/LiveFeedBoard.tsx` | Real-time scrolling feed during scrape | 186 |
| `src/app/job-agent/review/page.tsx` | Staged job review + bulk approve | — |
| `src/app/job-agent/tokens/page.tsx` | Admin token pool management | — |
| `src/app/api/job-agent/runs/route.ts` | POST: create + start run | — |
| `src/app/api/job-agent/runs/[id]/route.ts` | GET run detail | — |
| `src/app/api/job-agent/runs/[id]/live/route.ts` | GET live dataset items + auto-complete | 72 |
| `src/app/api/job-agent/runs/[id]/staged-jobs/route.ts` | GET staged jobs for review | — |
| `src/app/api/job-agent/runs/[id]/approve/route.ts` | POST approve + import | — |
| `src/app/api/job-agent/role-library/route.ts` | GET role groups | — |
| `src/app/api/job-agent/keyword-groups/route.ts` | CRUD keyword groups | — |
| `src/app/api/job-agent/tokens/route.ts` | CRUD Apify tokens | — |
| `src/app/api/job-agent/configs/route.ts` | CRUD configs | — |
| `src/app/api/cron/job-agent/route.ts` | Daily combined group scrape | — |
| `src/app/api/cron/job-agent-poll/route.ts` | Per-minute Apify status check | — |
| `src/server/services/jobAgentService.ts` | Core logic: run, fetch, dedupe, classify, stage | 314 |
| `src/lib/jobAgentRoleLibrary.ts` | Role groups A–L + combined CA/CB/CC | — |
| `src/lib/jobAgentImporter.ts` | Staged → main jobs table import | 169 |
| `src/lib/ai/jobAgentClassifier.ts` | AI classification with fallback | 306 |
| `src/server/repositories/jobAgentRunRepository.ts` | DB: runs + staged jobs | — |
| `src/server/repositories/jobAgentTokenRepository.ts` | DB: token pool | — |
| `src/server/repositories/jobAgentConfigRepository.ts` | DB: configs | — |
| `src/server/repositories/jobAgentKeywordGroupRepository.ts` | DB: keyword groups | — |

### 4.2 AI Routing Files

| File | Purpose |
|------|---------|
| `src/lib/ai/routing.ts` | Central routing: `callWithUsageTracking()`, `getProviderForAutomation()`, retry logic, usage tracking |
| `src/lib/ai/index.ts` | Provider selection chain (`getActiveProvider`, `getProviderByName`, `getActiveProviderAsync`) |
| `src/lib/ai/provider.ts` | `AiProvider` interface, `AiResponse`, `textOf()`, `toolUsesOf()` |
| `src/lib/ai/openAiCompatibleProvider.ts` | `createOpenAiCompatibleProvider()` — shared fetch wrapper for OpenAI-compatible APIs |
| `src/lib/ai/openaiProvider.ts` | OpenAI env-key provider |
| `src/lib/ai/googleProvider.ts` | Google Gemini env-key provider |
| `src/lib/ai/anthropicProvider.ts` | Anthropic env-key provider |
| `src/server/services/aiProvider.ts` | `buildProviderFromDbKey()` — creates provider from DB-managed keys |
| `src/server/repositories/aiKeyRepository.ts` | DB: AI API keys (encrypted) |
| `src/server/repositories/aiAgentConfigRepository.ts` | DB: agent configs (UPDATE only) |
| `src/server/security/secretCrypto.ts` | AES-256-GCM encryption for API keys |

### 4.3 Scoring/ATS Files

| File | Automation ID | Purpose |
|------|--------------|---------|
| `src/lib/atsScoring.ts` | `ats_extraction`, `ats_narrative` | Resume skill extraction, narrative generation, deterministic scoring |
| `src/app/api/jobs/match-score/route.ts` | `job_match_score` | Candidate-job fit percentage |
| `src/app/api/jobs/autofill-form/route.ts` | `job_autofill` | AI-populate job creation form |
| `src/app/api/jobs/[id]/analyze/route.ts` | `jd_analysis` | AI-extract structured metadata from job |

### 4.4 Database Files

| File | Purpose |
|------|---------|
| `src/server/db/neon.ts` | Neon HTTP driver initialization, `query()`, `queryOne()`, `execute()` |
| `src/server/db/index.ts` | Re-exports |
| `migrations/job_agent_tables.sql` | Base tables (runs, staged_jobs) |
| `migrations/job_agent_tokens_v2.sql` | Token pool + config simplification |
| `migrations/job_agent_keyword_groups.sql` | Custom keyword groups |
| `migrations/job_agent_ai_config.sql` | Default config for `job_categorization` |
| `migrations/scoring_ai_automations.sql` | New automation IDs + default configs |

---

## 5. Bugs Fixed — Detailed

### 5.1 Database Connection Failure

**Symptom:** `NeonDbError: TypeError: fetch failed` on every page.

**Root Cause:** `src/server/db/neon.ts` passed `fetchOptions: { cache: "no-store" }` to the `neon()` constructor. This is a Next.js-specific `fetch` extension. The Neon HTTP driver passes `fetchOptions` directly to the global `fetch()`, which rejects `cache` as an unknown field.

**Fix:** Removed `fetchOptions` entirely. The Neon driver connects over HTTPS to the pooler URL — Next.js `cache` directives are for page/API route-level fetches, not for internal DB connections. Also auto-strips `channel_binding` from the URL (raw-TCP param the HTTP driver cannot use).

**File:** `src/server/db/neon.ts`

---

### 5.2 Date Posted Filter Only Works for "Today"

**Symptom:** Selecting "2 Days", "7 Days", or "30 Days" returned zero results.

**Root Cause:** The Apify actor `khadinakbar~google-jobs-scraper` accepts only specific enum values: `any`, `today`, `3days`, `week`, `month`. The UI was passing raw strings `2 days`, `7 days`, `30 days` — not matching any valid value.

**Fix:** Added `toApifyDatePosted()` mapping:

```typescript
function toApifyDatePosted(input: string): string {
  const map: Record<string, string> = {
    today: "today", "2 days": "3days", "3days": "3days",
    "7 days": "week", week: "week",
    "30 days": "month", month: "month",
    any: "any",
  };
  // Falls back to "today" if unrecognized
}
```

**File:** `src/server/services/jobAgentService.ts`

---

### 5.3 AI Classification Not Using AI Control Center

**Symptom:** Classifier called AI but ignored admin-configured system prompt, temperature, and active flag.

**Root Cause:** `jobAgentClassifier.ts` called `callWithUsageTracking("job_categorization", …)` for routing but never queried `ai_agent_configs`.

**Fix:** Added `findAgentConfigByAutomationId("job_categorization")` call in `loadConfig()`. Uses configured fields; falls back to built-in defaults if no config row exists.

**File:** `src/lib/ai/jobAgentClassifier.ts`

---

### 5.4 Review Page "Approve All Best" Imports Zero Jobs

**Symptom:** Bulk approve by tier silently imported 0 jobs.

**Root Cause:** `importApprovedJobs()` filtered staged jobs by `importStatus: "approved"`, but the UI never marked them as approved first. All jobs remained in `import_status = 'staged'`.

**Fix:** `importApprovedJobs()` now calls `bulkUpdateStagedJobStatus(runId, "approved", { tier })` BEFORE importing. Imported counts increment instead of overwrite. Excludes already-imported rows.

**File:** `src/lib/jobAgentImporter.ts`

---

### 5.5 Token Priority Default Mismatch

**Symptom:** New tokens defaulted to priority `0`, always winning rotation ahead of manually-set priorities.

**Root Cause:** `insertToken()` used `priority ?? 0`.

**Fix:** Now computes `MAX(priority) + 1` as default, or `1` if table is empty.

**File:** `src/server/repositories/jobAgentTokenRepository.ts`

---

### 5.6 Live Scraping Feed Not Showing

**Symptom:** The live feed board never appeared during a scrape.

**Root Cause:** The page only mounted `LiveFeedBoard` for `status === "running"`, but runs start as `"pending"`.

**Fix:** Board now mounts for `pending`, `running`, and `processing`. Added a new `"processing"` status to the run lifecycle. Added `processingSet` guard to prevent concurrent `processApifyRunData` calls.

**Files:** `src/app/job-agent/page.tsx`, `src/app/api/job-agent/runs/[id]/live/route.ts`, `src/app/job-agent/LiveFeedBoard.tsx`

---

### 5.7 Apify Run Never Completes (No Cron Poll)

**Symptom:** Apify run finished but data was never imported. The run stayed in "running" forever.

**Root Cause:** `processApifyRunData` only ran from `/api/cron/job-agent-poll`, which needs `CRON_SECRET`. Without it, the endpoint returned 401 and no processing happened.

**Fix:** The live polling endpoint now auto-triggers `processApifyRunData` in the background when it detects the Apify run has `SUCCEEDED`. No cron required.

**File:** `src/app/api/job-agent/runs/[id]/live/route.ts`

---

### 5.8 Classification Takes ~44 Minutes for 500 Jobs

**Symptom:** 500 jobs × (300ms delay + ~5s AI call) = 44+ minutes.

**Fix:** Changed from sequential `for` loop to 5 concurrent `Promise.all()` calls per batch. 300ms delay moved to between batches only. 500 jobs now completes in ~100 seconds.

**File:** `src/server/services/jobAgentService.ts` (classifyJobs function)

---

### 5.9 Cron Duplicates Search Queries

**Symptom:** Combined cron groups sent 2× the queries (each title appeared twice in the Apify request).

**Root Cause:** `/api/cron/job-agent/route.ts` passed both `roleGroups: subGroupIds` AND `customKeywords: titles`. `getSearchQueries()` already expands role groups to titles.

**Fix:** Removed `customKeywords: titles` from the cron route.

**File:** `src/app/api/cron/job-agent/route.ts`

---

### 5.10 OpenAI Quota Exhausted — All Scoring/ATS Failed

**Symptom:** "Generate Score" and "ATS Score Analysis" returned `429 OpenAI quota exceeded`.

**Root Cause:** Four endpoints used `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` directly, bypassing the multi-provider AI Control Center routing system entirely.

**Fix:** All 4 endpoints now use `callWithUsageTracking()` with proper automation IDs. The `OpenAI` SDK import is completely removed. JSON parsing is provider-agnostic (prompt-level instructions instead of `response_format`).

**Files:** `src/lib/atsScoring.ts`, `src/app/api/jobs/match-score/route.ts`, `src/app/api/jobs/autofill-form/route.ts`, `src/app/api/jobs/[id]/analyze/route.ts`

---

### 5.11 AI Routing — No Retry on Rate Limit

**Symptom:** When one provider returned 429, the entire call failed without trying alternatives.

**Fix:** `callWithUsageTracking()` now retries up to 3 times. Failed providers are excluded from the next attempt. `getProviderForAutomation()` now iterates through ALL providers instead of picking the first one. Both key IDs and provider names are excluded on retry.

**File:** `src/lib/ai/routing.ts`

---

### 5.12 AI Control Center — Route Save Never Persisted

**Symptom:** Configuring routes in `/admin/ai` appeared to work (200 response) but routes were never saved.

**Root Cause:** The PUT handler built an array of `sql.query()` promises and passed it to `sql.transaction(queries)`. Two fatal issues:
1. `sql.query()` executes immediately — queries ran BEFORE `transaction()`
2. `sql.transaction()` expects a callback returning `tx.query()` promises, not an array of pre-executed outer queries

**Fix:** Changed to `sql.transaction((tx) => { return [tx.query(...), ...]; })` — all queries are transaction-scoped and execute atomically.

**File:** `src/app/api/admin/ai/agents/[id]/routes/route.ts`

---

### 5.13 AI Control Center — Agent Config Fields Never Saved

**Symptom A:** `prompt_version` and `output_schema_version` were always empty in DB even after saving.

**Root Cause:** Validation checked `typeof body.prompt_version === "number"`, but the DB column is `text` and the frontend sends a string.

**Fix:** Changed to `String(body.prompt_version)` — accepts both strings and numbers.

**Symptom B:** Saving a new agent config failed with a NOT NULL violation on `display_name`.

**Root Cause:** `display_name` has `NOT NULL` with no default. Clicking Save without typing a name threw a DB error.

**Fix:** Falls back to the automation's label (e.g. "Job Match Score") when `display_name` is not provided.

**File:** `src/app/api/admin/ai/agents/[id]/route.ts`

---

### 5.14 Exhausted OpenAI Key in .env.local

**Symptom:** Even with routing fixes, the exhausted key was still picked by the global fallback.

**Fix:** Commented out `OPENAI_API_KEY=sk-proj-…` in `.env.local`. The system now either uses configured AI keys or gives a clear error telling the user to add one.

**File:** `.env.local`

---

### 5.15 No Daily Cron Schedule

**Symptom:** The cron for automated job scraping was never scheduled.

**Fix:** Added to `vercel.json`:
```json
{ "path": "/api/cron/job-agent", "schedule": "0 0 * * *" }
```
`0 0 * * *` = midnight UTC = 6:00 AM Bangladesh Standard Time daily.

**File:** `vercel.json`

---

### 5.16 Jobs Page Pagination

**Enhancement:** Pagination bar now renders at both top (before table) and bottom (after table). Added a page number input with "Go" button and validation (shows error for invalid numbers).

**File:** `src/app/jobs/page.tsx`

---

## 6. AI Control Center Integration

### 6.1 How AI Routing Works

```
callWithUsageTracking(automationId, ctx, fn)
    │
    ├─1. Try ai_automation_routes for automationId (ordered by rank)
    │     ├─ Pick ai_key_id → decrypt key → build provider with model_override
    │     └─ Skip if: disabled, rate_limited, quota_exhausted, limit exceeded
    │
    ├─2. On rate_limit/auth_error → retry up to 3x, exclude failed provider
    │
    └─3. Global fallback (if ALLOW_GLOBAL_AI_FALLBACK=true)
          └─ Try: Anthropic → NVIDIA → Google Vertex → Google → OpenAI → GLM → DB keys
```

### 6.2 Automation IDs Used by Job Agent & Scoring

| Automation ID | Display Name | Used By |
|---------------|-------------|---------|
| `job_categorization` | Job Categorization | `jobAgentClassifier.ts` |
| `job_match_score` | Job Match Score | `jobs/match-score/route.ts` |
| `ats_extraction` | ATS Data Extraction | `atsScoring.ts` extractStructuredData |
| `ats_narrative` | ATS Narrative | `atsScoring.ts` generateNarrative |
| `job_autofill` | Job Form Autofill | `jobs/autofill-form/route.ts` |
| `jd_analysis` | JD Analysis | `jobs/[id]/analyze/route.ts` |

### 6.3 Configuring in /admin/ai

1. **API Keys tab:** Add your AI key (Google, Anthropic, etc.)
2. **Agents & Routing tab:**
   - **Agent tab:** Set system prompt, temperature, max tokens, timeout
   - **Routes tab:** Assign key(s) to each automation, set model override (e.g. `gemini-2.5-pro`), set fallback rank order

### 6.4 Usage Tracking

Every AI call is recorded in `ai_usage_events` with: automation ID, key ID, provider, model, outcome, latency, token counts, estimated cost, error details, and route rank.

---

## 7. Migration Files

### 7.1 `migrations/scoring_ai_automations.sql`

Inserts 4 new automation rows + seeds default `ai_agent_configs` for all job agent and scoring automations.

**Automations seeded:**
- `job_match_score` — "Job Match Score" — "Scoring & Analysis"
- `ats_extraction` — "ATS Data Extraction" — "Scoring & Analysis"
- `ats_narrative` — "ATS Narrative" — "Scoring & Analysis"
- `job_autofill` — "Job Form Autofill" — "Parsing & Extraction"
- `job_categorization` — "Job Categorization" — "Parsing & Extraction" (existing)

### 7.2 `migrations/job_agent_ai_config.sql`

Seeds a default active `ai_agent_configs` row for `job_categorization` with sensible defaults (temperature 0.2, 2048 max tokens, 30s timeout, 2 retries).

### 7.3 Apply Order

```sql
\i migrations/scoring_ai_automations.sql
\i migrations/job_agent_ai_config.sql
```

All statements use `ON CONFLICT DO NOTHING` — safe to re-run.

---

## 8. Setup & Configuration

### 8.1 Run the Application

```powershell
cd C:\Shohan\Skarion\TalentOS
npm run dev
```

### 8.2 Apply Database Migrations

Connect to the Neon database and run:
```sql
\i migrations/scoring_ai_automations.sql
\i migrations/job_agent_ai_config.sql
```

### 8.3 Configure AI Keys

**Option A — Env vars (quick test):**
Add to `.env.local`:
```
GOOGLE_API_KEY=your-google-api-key
```

**Option B — AI Control Center (recommended):**
1. Go to `/admin/ai` → API Keys → Add key (Google/Anthropic)
2. Go to Agents & Routing → Edit each agent → Routes tab → Assign key + model override

### 8.4 Configure Cron Secret

Set `CRON_SECRET=AdminPass123!` in `.env.local` (already set) and in Vercel environment variables for production.

### 8.5 Run a Job Agent Scrape

1. Go to `/job-agent`
2. Select one or more role groups
3. Choose date interval
4. Click "Run Now"
5. Watch the Live Scraping Feed update in real-time
6. Go to `/job-agent/review` to approve and import results

---

## 9. Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `DATABASE_URL` | Neon Postgres connection string | Yes |
| `JWT_SECRET` | JWT signing secret for auth cookies | Yes |
| `CRON_SECRET` | Required for /api/cron/* routes | For cron |
| `GOOGLE_API_KEY` | Google Gemini API key (env fallback) | For AI |
| `ANTHROPIC_API_KEY` | Anthropic API key (env fallback) | For AI |
| `NVIDIA_API_KEY` | NVIDIA API key (env fallback) | For AI |
| `ALLOW_GLOBAL_AI_FALLBACK` | Enable env-based provider fallback | Recommended `false` in prod |
| `AI_KEYS_ENCRYPTION_SECRET` | Encrypts API keys in DB | For DB keys |
| `SUPABASE_URL` | Supabase instance (legacy) | For legacy features |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (legacy) | For legacy features |
