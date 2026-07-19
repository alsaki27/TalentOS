# Handoff: Pull OSP/GIS/CAD-Drafting jobs via GitHub Actions → dedupe → Excel

**For:** an AI/agent with GitHub CLI (`gh`) authenticated against this repo.
**Repo:** https://github.com/alsaki27/TalentOS
**Branch:** `saki-new-agent-layer` (not merged to `main` yet — trigger against this branch)

---

## ⚠️ Read this before doing anything

1. **"OpenJobData" is not a real, specific dataset.** It's the generic name this project's docs use for "whatever daily-updated job-postings parquet dataset on HuggingFace gets configured." No dataset literally named `OpenJobData` exists on the HF Hub (verified by search). Before this pipeline can pull anything real, a real dataset id must be set as the GitHub repo variable `OPENJOBDATA_HF_DATASET` (e.g. `some-org/some-dataset`). If that's not set yet, check first — `gh variable list --repo alsaki27/TalentOS` — and set it if needed before triggering:
   ```bash
   gh variable set OPENJOBDATA_HF_DATASET --repo alsaki27/TalentOS --body "org/dataset-name"
   ```
2. **Public job-postings datasets are historical snapshots, not live feeds.** Whatever real dataset gets configured will have real-world listing dates — realistically 2023–2025, not "this week." Do not expect or force a recent-date filter against it; report whatever date range the dataset actually has. (Checked one realistic candidate, `MichaelYitzchak/LinkedInJobPostings` on HF — its `listed_time` field decodes to April 2024. That's the well-known Kaggle LinkedIn dataset re-uploaded; not necessarily what gets used, just illustrative of the kind of dates to expect.)
3. **Required secrets** (check with `gh secret list --repo alsaki27/TalentOS`; set if missing):
   - `JOB_CEO_INGEST_SECRET` — shared bearer secret between the runner and the ingest endpoint.
   - `HF_TOKEN` — only if the configured dataset is gated.
   - `CRON_SECRET` — should already exist (used by every scheduled job in this repo); needed to call `/api/job-ceo/dispatch` and read run results as admin-equivalent.
   These are GitHub Actions secrets, set via `gh secret set NAME --repo alsaki27/TalentOS`. The Cloudflare Worker side needs the matching `JOB_CEO_INGEST_SECRET` value too (`wrangler secret put JOB_CEO_INGEST_SECRET` — only the account owner can run this, it's not a GitHub secret).

---

## The 3 domains, full keyword list (72 titles total)

These are the exact `titles` arrays from `src/lib/jobAgentRoleLibrary.ts` (groups A, B, C) — the canonical role library this whole app already searches against.

### OSP / Fiber (34)
```
OSP Design Engineer, Outside Plant Engineer, OSP Engineer, Fiber Design Engineer,
FTTH Design Engineer, Fiber Optic Design Engineer, Telecom Design Engineer,
Splice Engineer, Fiber Splicing Engineer, OSP Planning Engineer, OSP CAD Designer,
Fiber Network Engineer, Fiber Construction Engineer, Outside Plant Designer,
Telecommunications Engineer, Fiber Route Engineer, Aerial Fiber Design Engineer,
Underground Fiber Design Engineer, Joint Use Engineer, Make Ready Engineer,
Fiber Permitting Engineer, GIS Fiber Design Technician, OSP Project Engineer,
Fiber Design Technician, OSP Field Engineer, Fiber Construction Manager,
OSP Estimator, Telecom Infrastructure Engineer, Broadband Design Engineer,
FTTx Design Engineer, Fiber Network Planner, OSP QC Engineer,
Fiber Splice Technician, Broadband Network Engineer, Fiber Engineer
```

### CAD / Drafting (19)
```
AutoCAD Drafter, CAD Technician, CAD Designer, Drafter, Drafter I, Design Drafter,
Civil CAD Drafter, Electrical CAD Drafter, Mechanical CAD Drafter, Structural Drafter,
CAD Operator, Engineering Technician CAD, Utility Drafter, Land Surveying Drafter,
Piping Designer, Site Design Technician, BIM Technician, Construction Drafter,
Telecom Drafter, Drafting Technician
```

### GIS / Geospatial (19)
```
GIS Analyst, GIS Technician, GIS Specialist, GIS Coordinator, GIS Developer,
GIS Mapping Technician, Geospatial Analyst, GIS Data Analyst, GIS Analyst I,
GIS Technician I, Utility GIS Analyst, Telecom GIS Analyst, GIS Field Technician,
Cartographer, Remote Sensing Analyst, GIS Database Technician, GIS QA/QC Analyst,
Land Records GIS Analyst, Environmental GIS Analyst, GIS Support Specialist
```

(34 + 19 + 19 = **72 titles**. There are 9 more groups — D through L, ~142 more titles covering mechanical/electrical/civil/structural/architectural/MEP/piping/utility CAD and entry-level — in the same file if broader scope is ever wanted. Not included in this pull.)

---

## Step-by-step

### 1. Confirm prerequisites are set (see warnings above)
```bash
gh variable list --repo alsaki27/TalentOS
gh secret list --repo alsaki27/TalentOS
```
If `OPENJOBDATA_HF_DATASET` is missing, this whole pipeline has nothing to pull from — stop and report that back rather than guessing a dataset.

### 2. Trigger the ingest workflow
```bash
gh workflow run openjobdata-ingest.yml \
  --repo alsaki27/TalentOS \
  --ref saki-new-agent-layer \
  -f limit=500
```
Watch it:
```bash
gh run watch --repo alsaki27/TalentOS
```
The runner (`scripts/openjobdata_ingest.py`) already:
- Pulls the latest parquet from the configured dataset.
- Fetches search terms from `GET /api/job-ceo/scout-terms` (Query Scout) to prefilter — as of this handoff, Query Scout is **not yet wired to the real 72-title role library above** (it falls back to a 4-term placeholder unless `jobCeoService.ts` is updated to pass `roleLibrary` in). If you want the search itself biased toward these exact 72 titles rather than the placeholder, either fix that wiring first, or post a batch directly (step 2b) instead of relying on the runner's own prefilter.
- POSTs curated batches to `/api/job-ceo/ingest`, which creates a `job_ceo_runs` row and kicks off the QA → Deep Fetch → Matchmaker pipeline automatically.

### 2b. (Alternative) Ingest a specific batch directly, bypassing the runner's own filtering
If you already have job records from elsewhere matching these 72 titles and just want them run through this app's QA/Deep Fetch/Matchmaker pipeline:
```bash
curl -X POST https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/ingest \
  -H "Authorization: Bearer $JOB_CEO_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jobs": [{"title": "...", "company": "...", "source_url": "...", "snippet": "..."}, ...]}'
```
Response is `{ runId, staged }` — save the `runId`.

### 3. Wait for the run to finish
```bash
curl -s "https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/runs/<runId>" | python3 -m json.tool
```
Poll until `run.status` is `completed` (or `failed` — check `run.last_error`). The dispatch loop advances on its own (self-chained + a 10-min GitHub Actions catch-up cron + the `/job-ceo` page's live poll if anyone has it open) — you can also nudge it directly:
```bash
curl -X POST https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/dispatch
```

### 4. Pull ALL jobs the run found (not just the ones that got logged)
`GET /api/job-ceo/runs/[id]` only returns aggregate counts. **Use the new bulk endpoint** (added for this handoff) to get every individual job row, regardless of whether it cleared Matchmaker's ≥90% candidate-match bar:
```bash
curl -s "https://skarion-talent-os.skarion-talentos.workers.dev/api/job-ceo/runs/<runId>/staging" \
  -H "Cookie: <admin session cookie>" \
  -o staging_dump.json
```
(Requires admin/manager auth — use a logged-in session cookie, or add a bearer-secret path to that route if running fully unattended.) Response shape:
```json
{ "run": {...}, "count": N, "jobs": [
  { "id": "...", "stage": "logged", "title": "...", "company": "...", "location": "...",
    "source_url": "...", "description_text": "...", "qa_score": 87, "qa_reason": "...",
    "requirements": {...}, "match_results": {...}, "logged_job_id": "...", ... }
] }
```

### 5. Dedupe
Two layers already exist, but do one more pass on export:
- The runner script computes a lightweight signature per row before POSTing (title+company).
- Matchmaker fuzzy-dedupes against the *existing* `jobs` table before logging a match (`listAllJobsForFuzzyDedupe`) — but that only prevents re-logging jobs already in `jobs`, it does **not** dedupe *within* the staging rows of a single run (e.g. the same posting appearing under two slightly different search terms).
- **On export**, dedupe the `jobs` array from step 4 on `dedup_signature` (already stored on each staging row — `lower(title)+'|'+lower(company)`), keeping the row with the most-complete `description_text`.

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
An `.xlsx` with one row per unique job across the OSP/GIS/CAD-Drafting searches, columns matching `job_ceo_staging` (title, company, location, source_url, description_text, qa_score, qa_reason, requirements, stage, match_results), deduplicated, with an honest note on what date range the source data actually covers (do not claim a recency the underlying dataset doesn't have).
