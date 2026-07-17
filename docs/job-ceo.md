# JOB CEO — Multi-Agent Job Ingestion

## Architecture

The JOB CEO is a multi-agent job-ingestion pipeline for TalentOS. It sources jobs from **OpenJobData** (daily HuggingFace parquet), not Apify.

### Agents

| Agent | ID | Role |
|-------|-----|------|
| **Job CEO** | `job_ceo_orchestrator` | Plans runs, proposes agent tuning changes |
| **Query Scout** | `job_ceo_scout` | Formulates search/Boolean terms for job sourcing |
| **QA Bouncer** | `job_ceo_qa` | Filters raw jobs on a quality/relevance matrix |
| **Deep Fetch** | `job_ceo_deep_fetch` | Scrapes full JD text from source URLs |
| **Matchmaker** | `job_ceo_matchmaker` | Matches jobs to candidates (>=90%), drafts outreach |

All agents use `gemini-2.5-pro` as primary model with `gemini-2.5-flash` fallback.

## Data Flow

1. **Scout**: Query Scout generates search terms for OpenJobData
2. **Ingest**: GitHub Actions downloads daily parquet, pre-filters, POSTs to `/api/job-ceo/ingest`
3. **QA**: QA Bouncer scores each job (best/medium/worthy/skip)
4. **Deep Fetch**: Deep Fetch scrapes source URLs for full JD text
5. **Matchmaking**: Matchmaker compares against candidate pool, drafts outreach for 90%+ matches
6. **Log**: Matching jobs are created in the `jobs` table with `source='openjobdata'`

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

## Configuration Proposals

The CEO can propose agent configuration changes. Proposals require human approval:

1. CEO creates a proposal with `targetAutomationId`, `proposedChanges`, and `rationale`
2. Proposals appear in `/job-ceo/proposals`
3. Admin approves or rejects — approving applies the field to `ai_agent_configs` using the same field allowlist as the AI Control Center

## Required Setup

### GitHub Variables
- `OPENJOBDATA_HF_DATASET` — HuggingFace dataset ID (e.g. `username/dataset-name`)

### GitHub Secrets
- `JOB_CEO_INGEST_SECRET` — Shared secret for ingest authentication
- `HF_TOKEN` — HuggingFace API token (only if dataset is gated)

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
- **All new SQL is idempotent** — migration `034_job_ceo.sql` auto-runs on deploy.
- **Never pushes to main** — this layer lives on `saki-new-agent-layer`.
- **Existing Apify `/job-agent` system is untouched** — this is a parallel, additive layer.
