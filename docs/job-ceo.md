# JOB CEO — Multi-Agent Job Ingestion

## Architecture

The JOB CEO is a multi-agent job-ingestion pipeline for TalentOS. It sources jobs from **OpenJobData** (https://openjobdata.com — a public, daily-updated Hugging Face dataset repo at `hf://datasets/scholarweave/Jobs-Dataset-v2`, migrated 2026-10-11 from OpenJobData's earlier storage-bucket product), not Apify.

### Agents

| Agent | ID | Role |
|-------|-----|------|
| **Job CEO** | `job_ceo_orchestrator` | Plans runs, proposes agent tuning changes |
| **Query Scout** | `job_ceo_scout` | Formulates search/Boolean terms for job sourcing |
| **QA Bouncer** | `job_ceo_qa` | Filters raw jobs on a quality/relevance matrix |
| **Deep Fetch** | `job_ceo_deep_fetch` | Scrapes full JD text from source URLs |
| **Matchmaker** | `job_ceo_matchmaker` | Matches jobs to candidates (>=90%), drafts outreach |
| **Description Enricher** | `job_ceo_enricher` | Backfills full descriptions for already-logged jobs with thin/missing text, on its own cron |

Model routing (real, per `sql/neon_fixes/042_agent_model_overrides.sql` — this is already
cost-optimized, correcting an earlier, stale claim here that all agents used the reasoning
tier): `job_ceo_orchestrator` and `job_ceo_matchmaker` use `gemini-2.5-pro` (reasoning tier);
`job_ceo_scout`, `job_ceo_qa`, `job_ceo_deep_fetch`, and `job_ceo_enricher` use the cheaper
`gemini-2.5-flash-lite`. QA Bouncer additionally short-circuits to its own regex classifier
(no AI call at all) for confident cases — an obvious off-industry title, or 3+ strong
target-industry keyword matches — only calling AI for genuinely ambiguous jobs.

### Why descriptions can come out thin, and how Description Enricher fixes it

Deep Fetch only ever touches `job_ceo_staging` rows, once, during ingest — and it's
gated entirely on `source_url` being present. OpenJobData rows don't reliably carry
a working direct URL (depends on the dataset's own column layout), and even when a
URL exists, a single failed fetch (bot-blocked site, JS-rendered page, transient
error) leaves the thin description permanent — nothing ever revisits a `jobs` row
after it's logged.

`fetchJobPage.ts`'s content-quality gate (`isContentUseless()`) rejects known login walls
and known error/expired/unavailable/404/captcha pages before they're ever saved as
`description_text` — not just short content. This closes a real gap found in production:
some OpenJobData postings supply an application-FORM url rather than a job-detail url, and
scraping one can return a browser/application error page; because those pages were often
*longer* than the Enricher's 500-char "too thin to trust" cutoff, a long garbage page used
to look "complete" and was never revisited. Fixed at the source (the shared fetch function
both Deep Fetch and the Enricher call), not by changing either length threshold.

Description Enricher is a separate agent that runs independently of the ingest
pipeline, on its own 15-minute cron (`job-description-enrichment` in
`scheduled-jobs.yml`). It scans the **live** `jobs` table — any source, not just
OpenJobData — for rows with a `source_url`/`apply_url` but `description_text`
under 500 characters, retries the fetch + extraction, and writes the result back
via `jobs.description_enrich_attempts`/`description_enriched_at`. Capped at 3
attempts per job so a genuinely dead link doesn't get retried forever. A manual
"Enrich Descriptions" button on `/job-ceo` pulls a batch forward immediately
instead of waiting for the next tick.

## Data Flow

1. **Scout**: Query Scout generates search terms for OpenJobData
2. **Ingest**: GitHub Actions downloads daily parquet, pre-filters on keyword title match
   and a fresher-roles-only senior-title filter, POSTs to `/api/job-ceo/ingest`
3. **Deep Fetch**: Deep Fetch scrapes source URLs for full JD text and extracts
   `requirements` (including years-of-experience), staged under `"ingested"` → `"researched"`
4. **QA**: QA Bouncer scores each already-fetched job (best/medium/worthy/skip), staged
   `"researched"` → `"qa_passed"`/`"qa_dropped"` — **runs after Deep Fetch, not before**
   (corrected here; this doc previously stated the opposite order)
5. **Matchmaking**: Matchmaker first rejects any job whose extracted years-of-experience
   exceeds the fresher-roles cap (5 years) without calling AI, then — for jobs that pass —
   compares against the candidate pool and drafts outreach for 90%+ matches
6. **Log**: Matching jobs are created in the `jobs` table with `source='openjobdata'`

A QA-before-Deep-Fetch reorder (skipping the scrape+AI-extraction step entirely for jobs QA
would reject as off-industry) is a known, larger follow-up — deferred because it requires
renaming the run's status values (`ingesting`/`qa`/`deep_fetch`/`matchmaking`) to stay
self-consistent with the new order, touching the dispatcher and the admin run-status UI.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/job-ceo/ingest` | Bearer (`JOB_CEO_INGEST_SECRET`) | Ingest raw jobs |
| POST | `/api/job-ceo/dispatch` | None (admin) | Process next batch |
| GET | `/api/job-ceo/dispatch` | Bearer (`CRON_SECRET`) | Cron dispatch |
| POST | `/api/job-ceo/trigger` | Admin auth | Start a new run |
| GET | `/api/job-ceo/runs` | None | List recent runs |
| GET | `/api/job-ceo/runs/[id]` | None | Run detail + funnel |
| GET | `/api/job-ceo/scout-terms` | Bearer (`JOB_CEO_INGEST_SECRET`) | Get latest scout terms |
| GET | `/api/job-ceo/proposals` | Admin | List config proposals |
| POST | `/api/job-ceo/proposals` | Admin/Internal | Create proposal |
| POST | `/api/job-ceo/proposals/[id]/approve` | Admin | Apply proposal to config |
| POST | `/api/job-ceo/proposals/[id]/reject` | Admin | Reject proposal |
| POST | `/api/job-ceo/enrich` | Admin/Manager | Manually run one enrichment batch |
| GET | `/api/job-ceo/enrich` | Bearer (`CRON_SECRET`) | Cron-triggered enrichment batch |

## Configuration Proposals

The CEO can propose agent configuration changes. Proposals require human approval:

1. CEO creates a proposal with `targetAutomationId`, `proposedChanges`, and `rationale`
2. Proposals appear in `/job-ceo/proposals`
3. Admin approves or rejects — approving applies the field to `ai_agent_configs` using the same field allowlist as the AI Control Center

## Required Setup

The OpenJobData dataset (`hf://datasets/scholarweave/Jobs-Dataset-v2`) is public — no
HF token to configure. `scripts/openjobdata_ingest.py` reads the daily delta shard(s)
under `data/changes/minimal/date=YYYY-MM-DD/run_id=.../part-*.parquet` directly via
`HfFileSystem`, joins the latest `data/companies/snapshot_date=YYYY-MM-DD/part-*.parquet`
snapshot for company names, filters titles against the 72 OSP/CAD/GIS keywords in
`docs/keywords-osp-gis-cad.md`, and filters `posted_at >= SINCE_DATE`.

### GitHub Secrets
- `JOB_CEO_INGEST_SECRET` — Shared secret for ingest authentication

### Workflow inputs (`.github/workflows/openjobdata-ingest.yml`, manual dispatch)
- `since` — earliest `posted_at` date to include, `YYYY-MM-DD` (default `2026-07-12`)
- `limit` — max jobs to ingest (default `2000`)

### Cloudflare Worker Secrets
```bash
wrangler secret put JOB_CEO_INGEST_SECRET
```

## Database Tables

- `job_ceo_runs` — Per-ingestion-run metadata and counts
- `job_ceo_staging` — Per-job staging with stage lifecycle (ingested → qa_passed → researched → matched → logged)
- `agent_config_proposals` — CEO-proposed agent config changes pending human approval

## Important Notes

- **Matchmaker drafts outreach only** — never sends. Outreach drafts are stored in activity logs.
- **All new SQL is idempotent** — migrations `034_job_ceo.sql` and `035_job_description_enricher.sql` auto-run on deploy.
- **Never pushes to main** — this layer lives on `saki-new-agent-layer`.
- **Existing Apify `/job-agent` system is untouched** — this is a parallel, additive layer.
