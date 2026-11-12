# Employer career sources: developer handoff

Branch: `codex/employer-career-dev-handoff` (created from `0c01167baa5215e8bb2221774bd9cae84e23924b`). Confirm the intended deployment branch before opening a PR.

## The short version

We have identified **9,919 distinct career-page crawl groups** from **9,942 verified URLs** linked to **10,718 employer records**. A group is one normalized URL; multiple employers can share it. This is a source inventory, not 9,919 fully working scrapers.

The November 12, 2026, 11:04 a.m. ET checkpoint selected results for 1,213 groups. **529 groups were complete** (462 with jobs, 67 confirmed empty), producing **65,933 unique job payloads eligible for integration**. The remaining groups were either unattempted (8,706), partial (577), blocked (70), errored (33), or held (4). These figures are a snapshot, not a live production count. No jobs from this crawl were posted to TalentOS.

## What is on this branch

- `scripts/employer_career_ingest.py`: the discovery crawler and a dry-run-by-default Job CEO batch uploader. It checkpoints each source in `source_results.jsonl` and payloads in `jobs.jsonl`. `--skip-attempted` resumes one inventory pass after interruption without redoing recorded failures; the default mode retries incomplete groups.
- `scripts/report_employer_career_ingest.py`: combines crawl checkpoints, selects complete results by adapter version, and writes `ready_jobs.jsonl`, `source_dispositions.csv`, and `readiness_summary.json`.
- `scripts/test_employer_career_ingest.py`: focused crawler/reporter regression coverage.
- `data/talentos-employer-careers/README.md`, `career_page_tracker_summary.json`, and `scrape_source_manifest.json`: source definitions, counts, and the exact tracker SHA-256.

The repository is **public**. The full `career_page_tracker.csv` and `career_source_dispositions_2026-11-12.csv` contain internal company IDs and review notes, so they are ignored by Git and must be given to the developer through a private channel. The tracker SHA-256 in `scrape_source_manifest.json` is `6adc74d03ce965b6ca920b6c803c2fee3bc3f67807f04f10440404528e441c6d`. Place the private tracker at `data/talentos-employer-careers/career_page_tracker.csv` before running the crawler. The large live crawl outputs under `outputs/employer-career-ingest-run*` are also excluded from Git; the developer must receive those privately or rerun the crawl.

## Existing TalentOS paths

1. `src/app/api/cron/import-sources/route.ts` and `src/lib/importSourceRunner.ts` run saved `import_sources` serially. This path has a few ATS adapters and single-page JSON-LD extraction. Do not add 9,919 rows to that serial cron.
2. `.github/workflows/agency-sources-ingest.yml` runs Actalent and Broadstaff daily. Their scripts post batches to `POST /api/job-ceo/ingest`, which deduplicates, stages, and dispatches Job CEO. The new crawler's `post_batches` function already speaks this endpoint's batch format.
3. A successful ingest POST means **staged**, not necessarily **in `jobs`**. Job CEO can reject or filter a job during deep fetch and QA before `createJob`. The existing payload keeps `employer_keys` in `raw`, not as a relational employer mapping.

## Build the automatic importer

1. Store source state by normalized source URL and adapter version: last attempt, outcome, retry time, last complete crawl, job IDs, and counts. The current `--skip-attempted` flag is an interim local resume tool; production needs durable per-source state and separate scheduled retries for partial/blocked sources.
2. Split the 9,919 groups into bounded shards/workers with per-host rate limits and robots/terms holds. Add adapters for the source types that currently return partial/error. Never label a capped sitemap, missing pagination total, or inaccessible detail page complete.
3. Build an incremental uploader from the combined, version-aware readiness selection. **Do not use the current v6 `--ingest` switch as the production schedule:** v6 is a pending-only tracker and that switch selects only its current adapter version, omitting complete v11 results. Upload only newly discovered or changed jobs with stable source/job IDs and safe retries.
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
