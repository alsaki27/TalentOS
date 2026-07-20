# JOB CEO — Multi-Agent Job Ingestion Layer — 50-Chunk Build Plan

> **Handover doc for an implementing AI.** Branch: `saki-new-agent-layer` (already created off `neon-cloudflare-migration`). Execute chunks **in order**. Each chunk is self-contained: do exactly its Steps, satisfy its Acceptance, then `git add -A && git commit -m "chunk NN: ..."`. Do NOT skip acceptance checks. Do NOT touch the existing Apify `/job-agent` system or change the runtime behavior of the 4 resume agents (`application_job_lens/resume_forge/hiring_panel/final_polish`). Never push to `main`.

## Context / Why
TalentOS ingests jobs via an Apify Google-Jobs scraper the team wants to move off of (rate-capped, per-result cost, shallow filtering). This adds a **new, parallel** ingestion layer: a **JOB CEO** orchestrator that hands off to single-purpose helper agents (QA/Bouncer, Deep Fetch, Matchmaker, Query Scout), sourced from **OpenJobData** (daily HuggingFace parquet processed on a GitHub Actions runner — uncapped, ~zero API cost, deep filtering). The CEO can also **propose** tuning changes to any agent (its helpers + the 4 resume agents), gated behind human approval. All new agents default to `gemini-2.5-pro`.

## Ground truth (verified — use these exact values)
- Migrations: additive idempotent SQL in `sql/neon_fixes/NNN_*.sql`, auto-applied by `.github/workflows/deploy.yml` in filename order. **Next number = `028`** (verify by `ls sql/neon_fixes/` and pick the next unused). Rules: every statement re-runnable (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, guarded `DO $$`). No DROP/data-deleting. See `sql/neon_fixes/README.md`.
- AI registry tables: `ai_automations(id, label, description, group_label, is_active)`; `ai_agent_configs(automation_id PK, display_name, system_prompt, prompt_version, output_schema_version, temperature numeric(3,2), max_output_tokens int, timeout_ms int, max_attempts int, approval_policy check(auto|risk_based|always_human), minimum_score numeric(3,1), is_active, updated_by, updated_at)`; `ai_automation_routes(id, automation_id, ai_key_id, provider, rank, is_enabled, model_override, ...)`.
- Provider keys (in `ai_api_keys`): google_vertex_proxy = **`4315b676-6f41-4566-8373-915bfc733c0a`** (primary), google = **`1732e13f-af87-41cc-969a-c2c56821a713`** (fallback). Both support `gemini-2.5-pro` and `gemini-2.5-flash`.
- Reusable code: `callWithUsageTracking(automationId, ctx, fn, excludeKeyIds)` + `getProviderForAutomation` in `src/lib/ai/routing.ts`; `backgroundDispatch(promise)` in `src/server/lib/waitUntil.ts`; `classifyWithRegex`/`classifyWithAi` in `src/lib/ai/jobAgentClassifier.ts`; `createJobs(rows[])`, `createJob`, `listAllJobsForFuzzyDedupe` in `src/server/repositories/jobsRepository.ts`; `textOf` in `src/lib/ai/provider.ts`; `logActivity` in `src/lib/activity.ts`.
- Pattern to mirror for agents: `src/lib/ai/application-agents/` (`types.ts`, `constants.ts`, `schemas.ts`, `prompts/*`, one runner per agent) + orchestrator `src/server/services/applicationAiWorkflowService.ts` (claim/dispatch loop: `dispatchNextQueuedWorkflow`, `claimNextPendingWorkflow`, `processWorkflowStage`, and between-stage self-fetch to `POST /api/application-ai-workflows/dispatch`).
- **Dispatch reliability (learned the hard way — read `src/app/api/application-ai-workflows/active/route.ts` comments):** between-stage advancement MUST be a fresh HTTP `POST` to the dispatch endpoint, never an in-process call off another request (in-process orphans slow stages). Worker-to-itself self-fetch is *also* unreliable in production; the resume pipeline now ALSO surfaces a `needsDispatch` flag so a real client→server POST (from the polling page) drives it. Replicate BOTH: self-fetch as best-effort **and** a `needsDispatch` flag consumed by the `/job-ceo` poller.
- AI Manager UI: `/admin/ai` reads grouped `GET /api/admin/ai-automations`; per-agent tune via `GET`/`PATCH /api/admin/ai/agents/[id]` (PATCH updates `ai_agent_configs`, field allowlist there is the source of truth). New agents appear automatically once seeded into `ai_automations`.
- Jobs table columns (`sql/01_schema.sql`): `title(not null), company, location, source, salary_range, source_url, notes, is_active, seniority_level, employment_type, posted_at, external_job_id, apply_url, description_html, description_text, industries, raw_source_payload jsonb, job_category, category_tags text[], category_relevance_score, last_seen_at, created_at`.
- CI cron pattern: `.github/workflows/scheduled-jobs.yml` — bearer `CRON_SECRET`, `TALENTOS_BASE_URL` var, `workflow_dispatch` inputs, one job per cron. Worker is on the **paid plan**; `wrangler.toml` has `[limits] cpu_ms = 30_000` and `[triggers] crons`.

## User prerequisites (implementing AI cannot do these; note them, don't block on them)
- GitHub repo **variable** `OPENJOBDATA_HF_DATASET` = the HuggingFace dataset id (do not hardcode/guess).
- GitHub **secrets** `JOB_CEO_INGEST_SECRET` and (if dataset gated) `HF_TOKEN`.
- Cloudflare Worker secret `JOB_CEO_INGEST_SECRET` (same value) via `wrangler secret put JOB_CEO_INGEST_SECRET`.

---

# PHASE A — Migration, scaffolding (chunks 1–8)

### Chunk 1 — Confirm branch
- Steps: ensure on `saki-new-agent-layer` (`git branch --show-current`). Working tree clean.
- Acceptance: correct branch, clean tree.

### Chunk 2 — Migration file: registry rows
- Files: create `sql/neon_fixes/028_job_ceo.sql`.
- Steps: `INSERT ... ON CONFLICT (id) DO NOTHING` into `ai_automations` for 5 rows, `group_label='Job CEO'`: `job_ceo_orchestrator` ("Job CEO", "Plans runs and proposes agent tuning"), `job_ceo_scout` ("Query Scout", "Formulates search/Boolean terms"), `job_ceo_qa` ("QA Bouncer", "Filters raw jobs on a quality/relevance matrix"), `job_ceo_deep_fetch` ("Deep Fetch", "Scrapes full JD from source URL"), `job_ceo_matchmaker` ("Matchmaker", "Matches jobs to candidates, logs + drafts outreach").
- Acceptance: valid SQL; all statements idempotent.

### Chunk 3 — Migration: agent configs
- Files: append to `028_job_ceo.sql`.
- Steps: `INSERT ... ON CONFLICT (automation_id) DO NOTHING` into `ai_agent_configs` for the same 5 ids. Defaults: temperature 0.2 (qa/matchmaker/orchestrator), 0.1 (scout), 0.3 (deep_fetch); `max_output_tokens 32768`; `timeout_ms 30000` (qa/scout), `60000` (deep_fetch/matchmaker/orchestrator); `max_attempts 2`; `approval_policy 'auto'`; `minimum_score 0`; set `output_schema_version` to each agent's V1 name (Chunk 10).
- Acceptance: 5 rows, valid `approval_policy`.

### Chunk 4 — Migration: routes → gemini-2.5-pro
- Files: append to `028_job_ceo.sql`.
- Steps: for each of the 5 ids insert two `ai_automation_routes` rows (guard with `WHERE NOT EXISTS` on `(automation_id, rank)`): rank 0 → `ai_key_id='4315b676-6f41-4566-8373-915bfc733c0a'`, `model_override='gemini-2.5-pro'`, `is_enabled=true`; rank 1 → `ai_key_id='1732e13f-af87-41cc-969a-c2c56821a713'`, `model_override='gemini-2.5-flash'`, `is_enabled=true`.
- Acceptance: each agent has 2 enabled routes, primary = gemini-2.5-pro.

### Chunk 5 — Migration: `job_ceo_runs`
- Files: append. `create table if not exists job_ceo_runs (id uuid pk default gen_random_uuid(), status text not null default 'ingesting' check (status in ('ingesting','qa','deep_fetch','matchmaking','completed','failed','cancelled')), source text default 'openjobdata', trigger_type text default 'cron', ingested_count int default 0, kept_count int default 0, researched_count int default 0, matched_count int default 0, logged_count int default 0, scout_terms jsonb, last_error text, started_by uuid references profiles(user_id), created_at timestamptz default now(), updated_at timestamptz default now())`. Index `(status, created_at desc)`.
- Acceptance: idempotent.

### Chunk 6 — Migration: `job_ceo_staging`
- Files: append. `create table if not exists job_ceo_staging (id uuid pk default gen_random_uuid(), run_id uuid references job_ceo_runs(id) on delete cascade, stage text not null default 'ingested' check (stage in ('ingested','qa_passed','qa_dropped','researched','matched','logged','error')), dedup_signature text, title text, company text, location text, source_url text, external_job_id text, snippet text, description_text text, raw jsonb, qa_score int, qa_reason text, requirements jsonb, match_results jsonb, logged_job_id uuid, claimed_at timestamptz, claim_expires_at timestamptz, last_error text, created_at timestamptz default now(), updated_at timestamptz default now())`. Indexes `(run_id, stage)`, `(stage, claim_expires_at)`.
- Acceptance: idempotent.

### Chunk 7 — Migration: `agent_config_proposals`
- Files: append. `create table if not exists agent_config_proposals (id uuid pk default gen_random_uuid(), target_automation_id text not null, proposed_changes jsonb not null, rationale text, status text not null default 'pending' check (status in ('pending','approved','rejected','superseded')), created_by text default 'job_ceo', reviewed_by uuid references profiles(user_id), reviewed_at timestamptz, created_at timestamptz default now())`. Index `(status, created_at desc)`.
- Acceptance: idempotent.

### Chunk 8 — Verify migration mechanism
- Steps: read `deploy.yml` to confirm `sql/neon_fixes/*.sql` auto-runs in order (no code change). Commit chunks 2–8 as one migration commit.
- Acceptance: highest-numbered file; README rules satisfied.

---

# PHASE B — Framework: types, schemas, constants, repos (chunks 9–14)

### Chunk 9 — Types — `src/lib/ai/job-agents/types.ts`
- `JobCeoAgentId` union of the 5 ids; `JOB_CEO_AGENT_IDS`; `JOB_CEO_AGENT_METAS` (mirror `application-agents/constants.ts`); `StagedJob` interface matching `job_ceo_staging`; `JobCeoAgentContext`. Reuse `AgentOptions` from `application-agents/types.ts`.
- Acceptance: `tsc` clean.

### Chunk 10 — Zod schemas — `src/lib/ai/job-agents/schemas.ts`
- Export schemas + inferred types: `ScoutTermsV1 { queries:string[], booleanStrings:string[], rationale:string }`; `QaVerdictV1 { keep:boolean, score:number, tier:'best'|'medium'|'worthy'|'skip', reason:string }`; `DeepFetchResultV1 { descriptionText:string, requirements:{ yearsExperience:string|null, techStack:string[], clearance:string|null, certifications:string[] } }`; `MatchmakerResultV1 { matches:{ candidateId:string, score:number, reasons:string[], outreachDraft:string }[] }`; `CeoPlanV1 { stages:string[], notes:string, proposals:{ targetAutomationId:string, proposedChanges:Record<string,unknown>, rationale:string }[] }`. `SCHEMA_VERSIONS` map.
- Acceptance: schemas compile.

### Chunk 11 — Constants — `src/lib/ai/job-agents/constants.ts`
- `JOB_CEO_CONFIG_DEFAULTS` mirroring `application-agents/constants.ts` for all 5 (values = Chunk 3).
- Acceptance: keys === `JOB_CEO_AGENT_IDS`.

### Chunk 12 — Repo: runs — `src/server/repositories/jobCeoRunRepository.ts`
- `createRun`, `findRunById`, `updateRunStatus(id,status,patch)`, `listRuns(limit)`, `bumpRunCounts(id,{field,delta})` using `@/server/db/neon`.
- Acceptance: `tsc` clean.

### Chunk 13 — Repo: staging — `src/server/repositories/jobCeoStagingRepository.ts`
- `insertStaged(runId, rows[])` (compute `dedup_signature = lower(title)+'|'+lower(company)`), `claimNextStagedBatch(stage, limit)` (SELECT ... FOR UPDATE SKIP LOCKED, set claim_expires_at now()+2min — mirror `applicationAiWorkflowRepository.ts`), `updateStaged(id,patch)`, `countByStage(runId)`, `listStagedByRun(runId)`.
- Acceptance: `tsc` clean; SKIP LOCKED used.

### Chunk 14 — Repo: proposals — `src/server/repositories/agentConfigProposalRepository.ts`
- `createProposal`, `listProposals(status?)`, `findProposalById`, `setProposalStatus(id,status,reviewedBy)`, `supersedePendingFor(targetAutomationId)`.
- Acceptance: `tsc` clean.

---

# PHASE C — Prompts + runners (chunks 15–26)

> Mirror `application-agents/resumeForge.ts`: build prompt → `provider.send({system,messages,tools:[],temperature,maxTokens,timeoutMs})` → `textOf` → strip ```json fences → `JSON.parse` → `Schema.parse`. Use **compact** `JSON.stringify(x)` in prompts (no pretty-print).

### Chunk 15 — Scout prompt — `src/lib/ai/job-agents/prompts/queryScout.ts`
- `buildQueryScoutPrompt(roleLibrary, recentMatchStats)` → `ScoutTermsV1`.
### Chunk 16 — Scout runner — `src/lib/ai/job-agents/queryScout.ts` → `runQueryScout(...)`.
### Chunk 17 — QA prompt — `src/lib/ai/job-agents/prompts/qaBouncer.ts` → `buildQaBouncerPrompt(stagedJob)` (quality/relevance matrix → `QaVerdictV1`).
### Chunk 18 — QA runner — `src/lib/ai/job-agents/qaBouncer.ts` → `runQaBouncer(...)`; on no-provider/error fall back to `classifyWithRegex` (map to `QaVerdictV1`).
### Chunk 19 — Deep Fetch prompt — `src/lib/ai/job-agents/prompts/deepFetch.ts` → `buildDeepFetchPrompt(title,company,rawText)` → `DeepFetchResultV1`.
### Chunk 20 — URL fetch helper — `src/lib/ai/job-agents/fetchJobPage.ts` → `fetchJobPageText(url)` (Worker `fetch`, 10s AbortController, strip tags, cap ~15k chars, never throws → "").
### Chunk 21 — Deep Fetch runner — `src/lib/ai/job-agents/deepFetch.ts` → `runDeepFetch(...)`: skip fetch if `description_text` already long; else fetch + LLM-extract.
### Chunk 22 — Matchmaker prompt — `src/lib/ai/job-agents/prompts/matchmaker.ts` → `buildMatchmakerPrompt(job, candidateSummaries)` (≥90 → short outreach draft) → `MatchmakerResultV1`.
### Chunk 23 — Candidate loader — `src/lib/ai/job-agents/loadCandidateSummaries.ts` → `loadCandidateSummaries(limit)` (compact summaries incl. verified_skills/tier).
### Chunk 24 — Matchmaker runner — `src/lib/ai/job-agents/matchmaker.ts` → `runMatchmaker(...)` (pure; no DB writes).
### Chunk 25 — CEO prompt — `src/lib/ai/job-agents/prompts/ceoOrchestrator.ts` → `buildCeoPrompt(runContext, agentConfigsSnapshot)` (plan stages + optional `proposals[]` for helpers AND `application_*` agents) → `CeoPlanV1`.
### Chunk 26 — CEO runner — `src/lib/ai/job-agents/ceoOrchestrator.ts` → `runCeoOrchestrator(...)` (pure).
- Acceptance (15–26): each runner returns a schema-validated object and throws a clear error on invalid JSON.

---

# PHASE D — Orchestration service (chunks 27–32)

### Chunk 27 — Service skeleton — `src/server/services/jobCeoService.ts`
- Import 5 runners; `getRunnerFor(stage)`; `callAgent(automationId, ctx, fn)` wrapping `callWithUsageTracking` + a `Promise.race` timeout (mirror `processWorkflowStage`).
### Chunk 28 — `startRun({source,triggerType,startedBy,scoutTerms})` → create `job_ceo_runs`.
### Chunk 29 — `processQaBatch(runId)` → claim `ingested`, run QA, set `qa_passed|qa_dropped` + score/reason, bump `kept_count`.
### Chunk 30 — `processDeepFetchBatch` (`qa_passed`→`researched`) + `processMatchmakerBatch` (`researched`→ dedup via `listAllJobsForFuzzyDedupe`; match; for ≥90% `createJobs(...)` with `source='openjobdata'`, `raw_source_payload=raw`; set `logged_job_id`, `stage='logged'`, store `match_results` incl. outreach drafts; bump counts).
### Chunk 31 — `dispatchNextJobCeoWork()` → find earliest active run, advance exactly ONE batch of current stage (QA→deep_fetch→matchmaking→completed), update run status; return `{dispatched,runId,stage,count}`. One batch per call.
### Chunk 32 — Between-stage advance: `backgroundDispatch(fetch(`${TALENTOS_BASE_URL}/api/job-ceo/dispatch`, {method:'POST'}))` — self-fetch only; also expose a `needsDispatch` boolean from the runs/active read for the poller to drive a real client POST.
- Acceptance (27–32): repeated dispatch calls walk a seeded run to `completed`; a ≥90% match creates exactly one `jobs` row; outreach stored, never sent.

---

# PHASE E — API endpoints (chunks 33–40)

### Chunk 33 — `src/app/api/job-ceo/ingest/route.ts` (`dynamic='force-dynamic'`)
- `POST` — check `Authorization: Bearer ${process.env.JOB_CEO_INGEST_SECRET}` (401 else). Body `{runId?, jobs:[...]}`. Create/attach run, `insertStaged`, bump `ingested_count`, self-fetch `/api/job-ceo/dispatch`. Return `{runId, staged}`.
### Chunk 34 — `src/app/api/job-ceo/dispatch/route.ts` — `POST` (admin OR bearer) → `dispatchNextJobCeoWork()`; `GET` cron variant guarded by `CRON_SECRET` (mirror application dispatch route). `dynamic='force-dynamic'`.
### Chunk 35 — `src/app/api/job-ceo/trigger/route.ts` — `POST` (admin) → `runQueryScout`, `startRun`, persist `scout_terms`, self-fetch dispatch. Return run id.
### Chunk 36 — `src/app/api/job-ceo/runs/route.ts` (GET list) + `src/app/api/job-ceo/runs/[id]/route.ts` (GET detail + `countByStage` funnel + `needsDispatch`).
### Chunk 37 — `src/app/api/job-ceo/scout-terms/route.ts` — `GET` (bearer) → latest `ScoutTermsV1` (or run Scout on demand). Consumed by the runner.
### Chunk 38 — `src/app/api/job-ceo/proposals/route.ts` — `GET` (admin) list by status; `POST` (admin/internal) create.
### Chunk 39 — `src/app/api/job-ceo/proposals/[id]/approve/route.ts` — `POST` (admin) → apply `proposed_changes` to `ai_agent_configs` using the SAME field allowlist as `PATCH /api/admin/ai/agents/[id]`, set status 'approved' + `reviewed_by`, `logActivity`.
### Chunk 40 — `src/app/api/job-ceo/proposals/[id]/reject/route.ts` — `POST` (admin) → status 'rejected'; no config change.
- Acceptance (33–40): bad bearer 401s; dispatch advances one batch; GET dispatch needs `CRON_SECRET`; approving updates the target agent's config row.

---

# PHASE F — CEO plan persistence (chunks 41–43)

### Chunk 41 — After `runCeoOrchestrator` in trigger/start, write returned `proposals[]` into `agent_config_proposals` (pending); store plan notes on the run.
### Chunk 42 — On new proposal for a `target_automation_id` with an existing `pending`, mark older `superseded` (`supersedePendingFor`).
### Chunk 43 — `logActivity` on run start, completion, job logged, proposal approved/rejected.
- Acceptance: a triggered run can produce ≤1 pending proposal per target; activity rows appear.

---

# PHASE G — UI (chunks 44–48)

### Chunk 44 — `src/app/job-ceo/page.tsx` ("use client"): header, "Trigger Run" (POST `/trigger`), run-history table (GET `/runs`).
### Chunk 45 — Funnel + live cards: per active run show funnel (ingested→qa_passed→researched→matched→logged) from `/runs/[id]`; 6s poll patching only changed rows in place (reuse `pipeline-live-dot` CSS + the poll/`needsDispatch`→client-POST pattern from `application-queue/page.tsx`). No full-page reload.
### Chunk 46 — `src/app/job-ceo/proposals/page.tsx`: list pending `agent_config_proposals`, show target + diff of `proposed_changes` + rationale, Approve/Reject.
### Chunk 47 — `src/app/NavBar.tsx`: add `{ href:'/job-ceo', label:'Job CEO', show: canManageSources }` to `moreLinks` (keep existing `/job-agent` entries).
### Chunk 48 — Wrap any new `<table className="table">` in `<div className="table-shell">`.
- Acceptance (44–48): page lists runs; counts update live w/ pulse dot, no reload; approve visibly applies; nav entry present; tables scroll on mobile.

---

# PHASE H — OpenJobData runner + docs (chunks 49–52)

### Chunk 49 — `.github/workflows/openjobdata-ingest.yml`: `schedule: - cron '0 2 * * *'` + `workflow_dispatch` (input `limit`). Setup Python 3.11, `pip install huggingface_hub pandas pyarrow requests`, run `scripts/openjobdata_ingest.py`. Env: `HF_DATASET=${{ vars.OPENJOBDATA_HF_DATASET }}`, `HF_TOKEN=${{ secrets.HF_TOKEN }}`, `INGEST_SECRET=${{ secrets.JOB_CEO_INGEST_SECRET }}`, `BASE_URL=${{ vars.TALENTOS_BASE_URL || 'https://skarion-talent-os.skarion-talentos.workers.dev' }}`.
### Chunk 50 — `scripts/openjobdata_ingest.py`: GET Scout terms from `$BASE_URL/api/job-ceo/scout-terms` (bearer); download latest parquet from `HF_DATASET` via `huggingface_hub`; load w/ pandas; regex-prefilter on Scout queries + role keywords; lightweight dedup signature; map to ingest shape; page (200/batch) `POST $BASE_URL/api/job-ceo/ingest` w/ bearer. Print counts; fail loudly on HTTP errors; exit with a clear message if `HF_DATASET` unset. Must pass `python -m py_compile`.
### Chunk 51 — Add a `job-ceo-dispatch` job to `.github/workflows/scheduled-jobs.yml` (new cron e.g. `*/10 * * * *`) that `POST`s `/api/job-ceo/dispatch` with `CRON_SECRET` — safety-net catch-up like `dispatch-workflows`. Add matching `workflow_dispatch` choice. Don't alter existing jobs.
### Chunk 52 — `docs/job-ceo.md`: architecture, the 5 agents, data flow, required GitHub vars/secrets, the `wrangler secret put JOB_CEO_INGEST_SECRET` command. Add a commented block in `wrangler.toml` listing the new secret.
- Acceptance (49–52): valid YAML; script compiles; doc lists every prerequisite.

---

# PHASE I — Verify (chunks 53–55)

### Chunk 53 — `npm run typecheck` (clean), `npm run lint` (0 errors; pre-existing warnings OK), `npm run build` (succeeds).
### Chunk 54 — After deploy: `GET /api/admin/ai-automations` shows 5 new agents under **Job CEO** on `gemini-2.5-pro`. Seed a small batch via `POST /api/job-ceo/ingest` (bearer); watch `/job-ceo` advance QA→Deep Fetch→Matchmaker; a ≥90% match creates a `jobs` row + stored outreach draft. Create a CEO proposal targeting `application_resume_forge`, approve it, confirm `ai_agent_configs` updated. Apify `/job-agent` still works untouched.
### Chunk 55 — Once user sets `OPENJOBDATA_HF_DATASET` + secrets, `workflow_dispatch` the runner with a small `limit`; confirm curated jobs reach `/ingest` and a run completes. Push `saki-new-agent-layer`. Never touch `main`.

## Guardrails (every chunk)
- Never modify the Apify `/job-agent` system or change resume-agent runtime behavior (only human-approved proposals).
- Matchmaker drafts outreach only — no sending.
- All new agents default to `gemini-2.5-pro`. All new SQL idempotent. No `main` deploys. No secrets set from code.
