# Employer career sources: developer handoff

Branch: `codex/employer-career-dev-handoff` (created from `0c01167baa5215e8bb2221774bd9cae84e23924b`). Confirm the intended deployment branch before opening a PR.

## The short version

We have identified **9,919 distinct career-page crawl groups** from **9,942 verified URLs** linked to **10,718 employer records**. A group is one normalized URL; multiple employers can share it. This is a source inventory, not 9,919 fully working scrapers.

The November 12, 2026, 11:53 a.m. ET safety-gated checkpoint selected results for 1,251 groups. **486 groups were complete** (416 with jobs, 70 confirmed empty), producing **53,341 unique job payloads eligible for integration**. Another 61 historical generic completions require v14 revalidation; 8,668 groups had not started. The rest were partial (609), blocked (68), errored (23), or held (4). These figures are a snapshot, not a live production count. No jobs from this crawl were posted to TalentOS.

A later frozen v14 checkpoint brought the historical result union to **1,295 groups**. The November 12 baseline report selected **491 complete groups** and **53,919 unique ready payloads** from that union, with no live ingestion. The v14 coverage cohort contains 8,852 groups: 220 already attempted in that checkpoint and 8,632 placed in four host-exclusive shards. The historical union plus those shards covers all 9,919 groups after eight overlaps. The first four-shard run at 256 total workers produced 247 robots-check failures mislabeled as blocks; its four output folders are marked `INVALID_ROBOTS_RUN.json` and must never be included in readiness. Adapter v15 preserves the underlying robots-fetch error and treats transient network/HTTP failures as retryable errors. A clean v15 shard pass is the continuation; do not call the 9,919 groups scraped until that pass finishes and its dispositions are reviewed.

## What is on this branch

- `scripts/employer_career_ingest.py`: the discovery crawler and a dry-run-by-default Job CEO batch uploader. It checkpoints each source in `source_results.jsonl` and payloads in `jobs.jsonl`. `--skip-attempted` resumes one inventory pass after interruption without redoing recorded failures; the default mode retries incomplete groups. `--shared-host-rate-dir` enforces cross-process per-host request spacing.
- `scripts/report_employer_career_ingest.py`: combines crawl checkpoints, selects complete results by adapter version, and writes `ready_jobs.jsonl`, `source_dispositions.csv`, and `readiness_summary.json`. Use `--min-sitemap-adapter-version employer-career-ingest-v14` to hold historical generic sitemap results until revalidated.
- `scripts/shard_employer_career_tracker.py`: creates balanced, host-exclusive private cohort trackers and a hash manifest. `--exclude-adapter-version` names the version in the checkpoint used for exclusion.
- `scripts/report_employer_career_safe_runs.py`: pairs result/job files and excludes run folders marked `INVALID_ROBOTS_RUN.json`; `--allow-pending` permits a live shard folder that has not created both files yet.
- `scripts/open_position_links.py`: a conservative same-host openings fallback that remains partial until a source-specific completeness check exists.
- `scripts/jazzhr_public_board.py`: validates public JazzHR listing pages without an undocumented feed.
- `scripts/test_employer_career_ingest.py` and the focused JazzHR, rate-limit, robots, shard, safe-report, and Open Positions tests: offline regression coverage.
- `data/talentos-employer-careers/README.md`, `career_page_tracker_summary.json`, and `scrape_source_manifest.json`: source definitions, counts, and the exact tracker SHA-256.

The repository is **public**. The full `career_page_tracker.csv` and `source_dispositions.csv` contain internal company IDs and review notes, so they are ignored by Git and must be given to the developer through a private channel. The tracker SHA-256 in `scrape_source_manifest.json` is `6adc74d03ce965b6ca920b6c803c2fee3bc3f67807f04f10440404528e441c6d`. Place the private tracker at `data/talentos-employer-careers/career_page_tracker.csv` before running the crawler. The local ignored `outputs/employer-career-ingest-run-2026-11-12-v14/employer-career-private-handoff-v14-safe-2026-11-12.zip` contains the private tracker, disposition, safe ready payloads, and cohort manifest from the 11:53 snapshot; deliver it privately. The earlier November 12 ZIP is superseded. The live v15 crawl checkpoints remain outside Git and require a later private handoff.

To reproduce the local v14 cohort's exclusion while running v15 code, use the *v14* checkpoint version explicitly. The private cohort input and checkpoint must be present first. The expected manifest records 220 excluded groups and 8,632 emitted groups.

```powershell
python scripts/shard_employer_career_tracker.py `
  --input outputs/employer-career-ingest-run-2026-11-12-v14/career_page_tracker_v14_coverage.csv `
  --exclude-results outputs/employer-career-ingest-run-2026-11-12-v14/source_results.jsonl `
  --exclude-adapter-version employer-career-ingest-v14 `
  --shards 4 `
  --output-dir outputs/employer-career-ingest-run-2026-11-12-v14/shards-4-v14-rebuilt
```

After the clean v15 shards finish, combine only the historical checkpoints and the four clean v15 folders. The safe-run wrapper also excludes any marked invalid folder if one is listed. Keep `--allow-pending` only for an interim snapshot.

```powershell
$runs = @(
  'outputs/employer-career-ingest-run-2026-11-05-v5',
  'outputs/employer-career-ingest-run-2026-11-05-v6',
  'outputs/employer-career-ingest-run-2026-11-12-v14'
)
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v15-shard-{0:D2}' -f $_) }
$reportArgs = @(
  'scripts/report_employer_career_safe_runs.py',
  '--tracker', 'data/talentos-employer-careers/career_page_tracker.csv',
  '--adapter-version', 'employer-career-ingest-v11,employer-career-ingest-v12,employer-career-ingest-v13,employer-career-ingest-v14,employer-career-ingest-v15',
  '--min-sitemap-adapter-version', 'employer-career-ingest-v14',
  '--output-dir', 'outputs/employer-career-ingest-run-2026-11-12-v15-readiness'
)
foreach ($run in $runs) { $reportArgs += @('--run-dir', $run) }
python @reportArgs
```

## Existing TalentOS paths

1. `src/app/api/cron/import-sources/route.ts` and `src/lib/importSourceRunner.ts` run saved `import_sources` serially. This path has a few ATS adapters and single-page JSON-LD extraction. Do not add 9,919 rows to that serial cron.
2. `.github/workflows/agency-sources-ingest.yml` runs Actalent and Broadstaff daily. Their scripts post batches to `POST /api/job-ceo/ingest`, which deduplicates, stages, and dispatches Job CEO. The new crawler's `post_batches` function already speaks this endpoint's batch format.
3. A successful ingest POST means **staged**, not necessarily **in `jobs`**. Job CEO can reject or filter a job during deep fetch and QA before `createJob`. The existing payload keeps `employer_keys` in `raw`, not as a relational employer mapping.

## Build the automatic importer

1. Store source state by normalized source URL and adapter version: last attempt, outcome, retry time, last complete crawl, job IDs, and counts. The current `--skip-attempted` flag is an interim local resume tool; production needs durable per-source state and separate scheduled retries for partial/blocked sources.
2. Use the host-exclusive shard and shared-rate prototypes as the starting point for a durable schedule with robots/terms holds. Add adapters for the source types that currently return partial/error. Never label a capped sitemap, missing pagination total, or inaccessible detail page complete.
3. Build an incremental uploader from the combined, version-aware readiness selection. **Do not use the crawler's `--ingest` switch as the production schedule:** a shard run selects only its own current adapter version and omits complete historical results. Upload only newly discovered or changed jobs with stable source/job IDs and safe retries.
4. Map each job to its verified employer key/company ID, including sources shared by multiple employers. Keep the source URL, evidence URL, adapter version, crawl timestamp, and source status for audit.
5. Reconcile each source's discovered, ready, posted, staged, filtered, logged, duplicate, and failed counts. Show the final `jobs` ID for every accepted posting. Decide explicitly how the requirement to import *every* posting interacts with Job CEO's existing role/QA filters; do not treat `staged` as `logged`.
6. Define behavior for removed/expired postings and for a source that becomes unavailable. Prevent duplicates across daily runs. Add a dashboard or run report that shows completeness and errors for all 9,919 groups.
7. Add a scheduled workflow or durable worker with a dry-run mode, scoped replay, alerts, and rollback. Keep secrets in the existing secret store; do not commit credentials or raw crawl payloads.

## Acceptance checks

- The exact tracker denominator and hash are recorded for every run, and every normalized group has a disposition.
- Complete means all reported pages/detail records for that source were reached; partial/blocked/held/error remain visible and retryable where appropriate.
- A small dry run and replay produce stable IDs and no duplicate jobs; a deliberately interrupted shard resumes where it stopped.
- A staging run reports source-level counts through Job CEO and verifies which records actually reached `jobs`.
- The scheduled run can process the source inventory within its agreed time budget without starving the existing Actalent/Broadstaff and Job CEO jobs.
- Deployment and live ingestion are separate reviewed steps. This branch currently contains a prototype and source inventory, not a production activation.
