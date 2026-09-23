# Handover: Multi-Agent Job Layer (`saki-new-agent-layer`)

**For:** the dev merging this branch into `neon-cloudflare-migration`.
**Branch:** `saki-new-agent-layer` (12 commits ahead of merge-base `c671366`, diverged cleanly — see §7).
**Status:** code-complete, typecheck/lint/build clean at every commit, reviewed for security issues (2 real ones found and fixed — see §4). **Not yet live-tested end-to-end** — that needs secrets only the product owner can set (§6).

---

## 1. The vision

TalentOS ingested jobs via an Apify Google-Jobs scraper. That system is disliked: rate/pagination-capped, costs per result, and does shallow filtering. The product owner's replacement concept: **one orchestrator ("Job CEO") coordinating several single-purpose helper agents**, instead of one AI doing five jobs badly. Each helper does exactly one thing well; the CEO plans runs and — critically — has visibility into *every* AI agent in the app (its own helpers **and** the pre-existing 4-agent resume-tailoring pipeline) and can **propose** tuning changes to any of them. Proposals require human approval before they touch a live agent's config — the CEO can suggest, never silently mutate production behavior.

Job sourcing moved from Apify to **OpenJobData**: a daily HuggingFace parquet dump, processed by a GitHub Actions runner (uncapped recall, near-zero API cost, full programmatic filtering — pandas can't run in a 30s Cloudflare Worker request, so the heavy lifting happens on the runner, and only curated batches get POSTed in).

This is built as a **fully separate, additive system**. The existing Apify `/job-agent` pages and the resume pipeline's 4 agents (`application_job_lens/resume_forge/hiring_panel/final_polish`) are **untouched** — nothing about them changed on this branch.

---

## 2. Architecture — the 6 agents

| Agent | `automation_id` | Role |
|---|---|---|
| **Job CEO** | `job_ceo_orchestrator` | Plans each run, proposes config tuning for any agent (its helpers + the resume pipeline) |
| **Query Scout** | `job_ceo_scout` | Formulates search queries / Boolean strings for the OpenJobData runner |
| **QA Bouncer** | `job_ceo_qa` | Filters raw ingested jobs on a quality/relevance matrix (drops spam, wrong seniority, generic titles) |
| **Deep Fetch** | `job_ceo_deep_fetch` | During ingest: scrapes the full JD from `source_url` for snippet-only jobs |
| **Matchmaker** | `job_ceo_matchmaker` | Scores jobs against the candidate pool; ≥90% matches get logged to `jobs` + a drafted (never sent) outreach message |
| **Description Enricher** | `job_ceo_enricher` | *Added after initial build* — background cron that backfills thin descriptions on **already-logged** jobs (see §3.9 for why this was needed) |

All 6 default to **`gemini-2.5-pro`** primary, **`gemini-2.5-flash`** fallback (per the product owner's explicit instruction), registered exactly like the existing app's AI agents — they show up automatically in **AI Control Center → "Job CEO" group**, tunable via the same `PATCH /api/admin/ai/agents/[id]` the rest of the app uses.

### Data flow

```
GitHub Actions (nightly + manual)                Cloudflare Worker
─────────────────────────────────                ──────────────────
openjobdata_ingest.py
  ├─ GET  /api/job-ceo/scout-terms   ─────────►   Query Scout runs (on demand)
  ├─ pulls latest HF parquet
  ├─ pandas prefilter + dedup
  └─ POST /api/job-ceo/ingest (batches) ───────►  job_ceo_staging rows created
                                                    (stage='ingested')
                                                          │
                                          POST /api/job-ceo/dispatch (self-chained
                                          + a 10-min catch-up cron + the /job-ceo
                                          page's live poll)
                                                          ▼
                                    QA Bouncer  → stage='qa_passed' | 'qa_dropped'
                                                          ▼
                                    Deep Fetch  → stage='researched'
                                                          ▼
                                    Matchmaker  → dedup vs existing jobs,
                                                  ≥90% match → INSERT INTO jobs,
                                                  stage='logged'
                                                          ▼
                              (independently, every 15 min)
                              Description Enricher scans the LIVE jobs table
                              for thin descriptions and backfills them
```

The CEO also runs at trigger-time, producing a plan + optional `agent_config_proposals` rows that surface in `/job-ceo/proposals` for human approval.

---

## 3. What was actually built (chronological)

1. **Migration `sql/neon_fixes/034_job_ceo.sql`** — registers the first 5 agents into the existing `ai_automations`/`ai_agent_configs`/`ai_automation_routes` tables (idempotent `INSERT ... ON CONFLICT DO NOTHING`), plus three new tables:
   - `job_ceo_runs` — one row per ingestion run, with per-stage counts (`ingested_count`, `kept_count`, `researched_count`, `matched_count`, `logged_count`) and `status` (`ingesting→qa→deep_fetch→matchmaking→completed|failed|cancelled`).
   - `job_ceo_staging` — one row per candidate job moving through the pipeline, with a `stage` state machine (`ingested→qa_passed/qa_dropped→researched→matched→logged`).
   - `agent_config_proposals` — CEO-authored, human-approved config change requests, `status` (`pending/approved/rejected/superseded`).

2. **Framework** (`src/lib/ai/job-agents/`): `types.ts`, `constants.ts` (per-agent defaults — temperature/tokens/timeout/max attempts), `schemas.ts` (hand-rolled Zod-style validators for each agent's JSON output shape: `ScoutTermsV1`, `QaVerdictV1`, `DeepFetchResultV1`, `MatchmakerResultV1`, `CeoPlanV1`). Mirrors the existing `src/lib/ai/application-agents/` pattern used by the resume pipeline.

3. **Repositories**: `jobCeoRunRepository.ts`, `jobCeoStagingRepository.ts` (claim-batch pattern for stage processing), `agentConfigProposalRepository.ts`.

4. **Prompts + runners** — one prompt builder + one runner per agent in `src/lib/ai/job-agents/`, each following the same shape: build prompt → call the model → parse/validate JSON → return.

5. **Orchestration service** (`src/server/services/jobCeoService.ts`, ~440 lines) — the claim/dispatch loop: `dispatchNextJobCeoWork()` finds the earliest active run and advances exactly one batch of its current stage, `startRun()`, `persistCeoProposals()`, and `callAgent()` (a shared timeout-guarded wrapper around `callWithUsageTracking`, now exported for reuse by the Enricher).

6. **API endpoints** (`src/app/api/job-ceo/`): `ingest` (bearer-secured, accepts external batches), `dispatch` (POST for manual/self-chain, GET for cron), `trigger` (admin, starts a run), `runs` + `runs/[id]` (status/funnel), `scout-terms` (runner reads this to prefilter), `proposals` + `proposals/[id]/approve|reject`.

7. **UI**: `/job-ceo` dashboard (run history, live funnel with a 6s poll + the same "pulse dot" pattern used elsewhere in this app for live status, "Trigger Run" button) and `/job-ceo/proposals` (approve/reject queue). Nav entry added under "More" — the existing `/job-agent` (Apify) entries are still there, untouched.

8. **OpenJobData runner**: `.github/workflows/openjobdata-ingest.yml` (nightly + manual dispatch) + `scripts/openjobdata_ingest.py` (downloads the parquet via `huggingface_hub`, prefilters with pandas, pages results to `/ingest`). A `job-ceo-dispatch` cron (every 10 min) and now a `job-description-enrichment` cron (every 15 min) were added to `scheduled-jobs.yml` as catch-up safety nets.

9. **Description Enricher (added post-review)** — the product owner tested and found OpenJobData jobs often lacked full descriptions. Root cause: Deep Fetch (step 4 above) only ever runs once, during ingest, and is entirely gated on `source_url` being present on the *staging* row — OpenJobData's schema doesn't guarantee one, and a single failed fetch is permanent (nothing ever revisits a job once it's logged). The fix was a **new, independent agent** that runs on its own cron against the **live `jobs` table** (any source, not just OpenJobData), retrying fetch+extraction for any job with a URL but under 500 chars of description, capped at 3 attempts per job (`jobs.description_enrich_attempts`/`description_enriched_at`, added in `sql/neon_fixes/035_job_description_enricher.sql`). Reuses Deep Fetch's existing prompt/schema and the SSRF-guarded fetch helper rather than duplicating them.

---

## 4. Security review — 2 real issues found and fixed

The code was independently reviewed (not just checked against its own acceptance criteria) before being considered mergeable:

1. **SSRF in Deep Fetch/Enricher.** `fetchJobPageText()` originally fetched `source_url` — untrusted, externally-ingested data — with zero validation. A crafted job posting could make the Worker fetch internal services or cloud metadata endpoints (`169.254.169.254`, `localhost`, etc.). **Fixed**: `isSafeExternalUrl()` in `src/lib/ai/job-agents/fetchJobPage.ts` — http(s)-only, rejects private/loopback/link-local IPv4 and IPv6 ranges and common internal hostnames. (Defense-in-depth, not DNS-rebinding-proof — Workers has no synchronous pre-resolution API.)
2. **Fail-open auth on `/api/job-ceo/ingest`.** The bearer check was `if (secret && authHeader !== ...)` — if `JOB_CEO_INGEST_SECRET` isn't configured (its current state — see §6), auth was skipped entirely and the endpoint accepted job data from anyone. **Fixed**: now fails closed (`if (!secret || authHeader !== ...)`).
3. **Dispatch reliability** — the self-chaining fetch calls in `ingest/route.ts` and `trigger/route.ts` were plain, un-awaited `fetch().catch()`, the exact pattern already proven (on the resume pipeline, earlier in this project's history) to get silently killed by Cloudflare before the target request runs. Fixed to wrap in `backgroundDispatch`/`ctx.waitUntil`, matching the one call site (`jobCeoService.ts`) that already did it correctly, and matching every dispatch trigger in the resume pipeline.

Confirmed **clean** on review (no changes needed): Matchmaker only ever writes an `outreachDraft` field — no send/email code path exists anywhere in this branch. The proposal-approval endpoint uses a hardcoded field allowlist with fully parameterized queries — no injection risk.

---

## 5. File manifest

```
Migrations
  sql/neon_fixes/034_job_ceo.sql                       — 5 agents, 3 tables
  sql/neon_fixes/035_job_description_enricher.sql       — 6th agent, jobs-table tracking columns

Agent framework
  src/lib/ai/job-agents/types.ts, constants.ts, schemas.ts
  src/lib/ai/job-agents/{queryScout,qaBouncer,deepFetch,matchmaker,ceoOrchestrator,enricher}.ts
  src/lib/ai/job-agents/prompts/*.ts
  src/lib/ai/job-agents/fetchJobPage.ts                 — SSRF-guarded URL fetch (shared)
  src/lib/ai/job-agents/loadCandidateSummaries.ts

Repositories
  src/server/repositories/jobCeoRunRepository.ts
  src/server/repositories/jobCeoStagingRepository.ts
  src/server/repositories/agentConfigProposalRepository.ts
  src/server/repositories/jobsRepository.ts             — +enrichment query/update helpers (existing file, extended)

Services
  src/server/services/jobCeoService.ts                  — ingest-pipeline orchestration
  src/server/services/jobEnrichmentService.ts            — live-table backfill

API
  src/app/api/job-ceo/{ingest,dispatch,trigger,runs,runs/[id],scout-terms,enrich}/route.ts
  src/app/api/job-ceo/proposals/route.ts
  src/app/api/job-ceo/proposals/[id]/{approve,reject}/route.ts

UI
  src/app/job-ceo/page.tsx
  src/app/job-ceo/proposals/page.tsx
  src/app/NavBar.tsx                                    — +1 line, new nav entry only

Runner + CI
  .github/workflows/openjobdata-ingest.yml               — new
  .github/workflows/scheduled-jobs.yml                   — +2 cron jobs (job-ceo-dispatch, job-description-enrichment)
  scripts/openjobdata_ingest.py                          — new

Config
  wrangler.toml                                          — +1 comment line documenting the new secret

Docs
  docs/job-ceo.md                                        — architecture reference
  docs/saki-new-agent-layer-plan.md                       — the original 50-chunk build spec (historical)
  docs/handover-saki-new-agent-layer.md                   — this file
```

45 files changed, ~4,000 insertions. `package-lock.json` also changed (~800 lines) — that's a lockfile resync from a plain `npm install`, no new dependencies were actually added (verify with `git diff c671366...HEAD -- package.json` — it's empty).

---

## 6. Not done yet — prerequisites before this can run for real

Nobody but the product owner can do these; they're not blockers for merging, only for the pipeline actually ingesting real jobs:

- **GitHub repo variable** `OPENJOBDATA_HF_DATASET` — the HuggingFace dataset id. The runner exits with a clear error if this is unset; it will not silently fail.
- **GitHub secrets** `JOB_CEO_INGEST_SECRET` (and `HF_TOKEN` if the dataset is gated).
- **Cloudflare Worker secret**, same value: `wrangler secret put JOB_CEO_INGEST_SECRET`.

Until these are set, `/api/job-ceo/ingest` will correctly reject all callers (see §4.2), and the GitHub Actions runner will no-op with a clear message rather than crash.

**Not yet done**: a real end-to-end smoke test with live OpenJobData data (needs the above). Everything has been verified structurally (typecheck/lint/build clean at every commit) and reviewed at the code level, but nobody has watched a real run go ingest→QA→Deep Fetch→Matchmaker→logged against live data yet.

---

## 7. Merge instructions

This branch is **purely additive** relative to `neon-cloudflare-migration` — no existing file's *behavior* was changed except `NavBar.tsx` (+1 line, a new nav entry) and `jobsRepository.ts` (new functions appended, nothing existing modified) and `wrangler.toml` (+1 comment line). The two branches diverged cleanly: `neon-cloudflare-migration` only picked up one small unrelated commit (extension API / readiness-service work) since the merge-base, touching files this branch never touches. **No merge conflicts are expected.**

```bash
git fetch origin
git checkout neon-cloudflare-migration
git pull
git merge origin/saki-new-agent-layer   # or open a PR the normal way
npm run typecheck && npm run lint && npm run build   # re-verify after merge
git push origin neon-cloudflare-migration
```

If conflicts do appear anyway (branch may have moved further since this doc was written), they'll be in files unrelated to this feature — resolve by keeping both sides' changes; nothing here should require picking one over the other.

---

## 8. Post-merge smoke test checklist

1. `GET /api/admin/ai-automations` → confirm 6 new agents appear under **Job CEO**, all on `gemini-2.5-pro`.
2. `/job-ceo` loads, "Trigger Run" works (will 0-out on `ingested_count` until real data is ingested — that's expected pre-secrets).
3. `/job-ceo/proposals` loads.
4. `/job-agent` (Apify) still works, completely unaffected.
5. AI Control Center still shows the original 4 resume-pipeline agents unchanged.
6. Once the product owner sets the 3 prerequisites in §6: `workflow_dispatch` the `openjobdata-ingest` GitHub Action with a small `limit`, confirm jobs land in `job_ceo_staging` and flow through to `jobs` for a ≥90% candidate match.
