# Handoff: Pull OSP/GIS/CAD-Drafting jobs via GitHub Actions → dedupe → Excel

**For:** an AI/agent with GitHub CLI (`gh`) authenticated against this repo.
**Repo:** https://github.com/alsaki27/TalentOS
**Branch:** `saki-new-agent-layer` (not merged to `main` yet — trigger against this branch)

---

## OpenJobData is real — verified

**OpenJobData (https://openjobdata.com) is a real, live, publicly-hosted job-postings
source.** It is a Hugging Face **storage bucket** (not a standard "dataset" repo —
that's why an HF dataset-search API call won't find it), at:

```
hf://buckets/Invicto69/Jobs-Dataset-bucket
```

No dataset ID to configure, no HF token needed (public bucket). Structure:

```
data/full/                    # complete base dataset, includes raw JSON payload
data/minimal/                 # lightweight base dataset, no JSON columns
data/full/changes/YYYY-MM-DD.parquet     # daily delta, full schema
data/minimal/changes/YYYY-MM-DD.parquet  # daily delta, minimal schema
data/companies/companies.parquet         # company_id -> name/website/industry/etc lookup
```

Jobs schema (minimal + full both have): `id` (compound `{unique_id}/{job_id}`),
`job_id`, `company_id` (FK → companies.id), `title`, `department`, `employment_type`,
`workplace_type`, `country`, `is_remote`, `posted_at` (tz-aware datetime), `apply_url`,
`fetched_time`, `status` (`active`/`closed`), `close_time`. Full-only adds `entire_json`
and `job_model_json` (raw scrape + normalized payload — heavy, not needed for a
title/date/company pull). No free-text description field in minimal — that's why
Deep Fetch / the Description Enricher agent exist, to pull full JD text from `apply_url`
after a job is logged.

Verified live on 2026-07-19: delta files exist for every date 2026-07-12 through
2026-07-18 except **2026-07-16 (no file that day — a genuine gap in the source, not
a bug)**, plus 2026-07-17 and 2026-07-18. Filtering those deltas to
`posted_at >= 2026-07-12` + `status = 'active'` + title matching the 72 keywords
below yielded **78 unique real jobs** as of this handoff.

`scripts/openjobdata_ingest.py` already implements this correctly: reads the delta
files for a date range via `HfFileSystem`, joins companies, filters on `posted_at`
and the 72 keywords, dedupes on the bucket's own compound `id` + title/company
signature, and POSTs to `/api/job-ceo/ingest`. Nothing further needs to be built to
source real, recent data — just trigger it (or run it locally) and let it flow
through the existing QA → Deep Fetch → Matchmaker pipeline.

---

## Required secrets

Check with `gh secret list --repo alsaki27/TalentOS`; set if missing:
- `JOB_CEO_INGEST_SECRET` — shared bearer secret between the runner and the ingest endpoint.
- `CRON_SECRET` — should already exist; needed to call `/api/job-ceo/dispatch` and read run results as admin-equivalent.

Set via `gh secret set NAME --repo alsaki27/TalentOS`. The Cloudflare Worker side needs
the matching `JOB_CEO_INGEST_SECRET` value too (`wrangler secret put JOB_CEO_INGEST_SECRET`
— only the account owner can run this, it's not a GitHub secret).

No `OPENJOBDATA_HF_DATASET` variable and no `HF_TOKEN` are needed anymore — the bucket
path is public and hardcoded into the script.

---

## The 3 domains, full keyword list (72 titles total)

See `docs/keywords-osp-gis-cad.md` for the standalone list (same content, sourced from
`src/lib/jobAgentRoleLibrary.ts` groups A–C, and hardcoded into `scripts/openjobdata_ingest.py`
as `ROLE_KEYWORDS`).

---

## Step-by-step

### 1. Confirm prerequisites are set
```bash
gh secret list --repo alsaki27/TalentOS
```

### 2. Trigger the ingest workflow
```bash
gh workflow run openjobdata-ingest.yml \
  --repo alsaki27/TalentOS \
  --ref saki-new-agent-layer \
  -f since=2026-07-12 \
  -f limit=2000
```
Watch it:
```bash
gh run watch --repo alsaki27/TalentOS
```
The runner (`scripts/openjobdata_ingest.py`):
- Reads `data/minimal/changes/YYYY-MM-DD.parquet` for every date from `since` through today.
- Filters `posted_at >= since`, `status = 'active'`, title matches one of the 72 role keywords.
- Joins `data/companies/companies.parquet` for company name + career URL.
- Dedupes on the bucket's compound `id`, then on a `title|company` signature.
- POSTs batches to `/api/job-ceo/ingest`, which creates a `job_ceo_runs` row and kicks off QA → Deep Fetch → Matchmaker automatically.

### 2b. (Alternative) Run it locally instead of via Actions
```bash
pip install huggingface_hub pandas pyarrow requests
INGEST_SECRET=<JOB_CEO_INGEST_SECRET> SINCE_DATE=2026-07-12 LIMIT=2000 \
  python scripts/openjobdata_ingest.py
```

### 3. Wait for the run to finish
```bash
curl -s "https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/runs/<runId>" | python3 -m json.tool
```
Poll until `run.status` is `completed` (or `failed` — check `run.last_error`). Nudge the dispatch loop directly if needed:
```bash
curl -X POST https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/dispatch
```

### 4. Pull ALL jobs the run found (not just the ones that got logged)
```bash
curl -s "https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/runs/<runId>/staging" \
  -H "Cookie: <admin session cookie>" \
  -o staging_dump.json
```
Response shape:
```json
{ "run": {...}, "count": N, "jobs": [
  { "id": "...", "stage": "logged", "title": "...", "company": "...", "location": "...",
    "source_url": "...", "description_text": "...", "qa_score": 87, "qa_reason": "...",
    "requirements": {...}, "match_results": {...}, "logged_job_id": "...", ... }
] }
```

### 5. Dedupe on export
The runner already dedupes before POSTing. On export, dedupe once more on
`dedup_signature` (`lower(title)+'|'+lower(company)`, stored on each staging row),
keeping the row with the most-complete `description_text`.

### 6. Export to Excel
```python
import json, pandas as pd

with open("staging_dump.json") as f:
    data = json.load(f)

rows = data["jobs"]
df = pd.DataFrame(rows)
df = df.sort_values("description_text", key=lambda s: s.str.len(), ascending=False, na_position="last")
df = df.drop_duplicates(subset="dedup_signature", keep="first")

df.to_excel("openjobdata_osp_gis_cad_pull.xlsx", index=False, engine="openpyxl")
```

---

## What "done" looks like
An `.xlsx` with one row per unique job across the OSP/GIS/CAD-Drafting searches, columns
matching `job_ceo_staging` (title, company, location, source_url, description_text,
qa_score, qa_reason, requirements, stage, match_results), deduplicated, covering real
`posted_at` dates on/after 2026-07-12 (verified achievable — 78 matches found as of
2026-07-19).
