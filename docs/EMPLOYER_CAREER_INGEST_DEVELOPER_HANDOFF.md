# Employer career sources: developer handoff

Branch: `codex/employer-career-dev-handoff` (created from `0c01167baa5215e8bb2221774bd9cae84e23924b`). Confirm the intended deployment branch before opening a PR.

## The short version

We have identified **9,919 distinct career-page crawl groups** from **9,942 verified URLs** linked to **10,718 employer records**. A group is one normalized URL; multiple employers can share it. This is a source inventory, not 9,919 fully working scrapers.

The November 12, 2026, 11:53 a.m. ET checkpoint selected results for 1,251 groups and 486 complete listings. Its earlier claim that 53,341 payloads were integration-ready is **superseded**: that report did not require a usable description or exclude job links leading to application forms. No jobs from this crawl were posted to TalentOS.

A later frozen v14 checkpoint brought the historical result union to **1,295 groups**. The v14 coverage cohort contains 8,852 groups: 220 already attempted in that checkpoint and 8,632 placed in four host-exclusive shards. The historical union plus those shards covers all 9,919 groups after eight overlaps. The first four-shard run at 256 total workers produced 247 robots-check failures mislabeled as blocks; its four output folders are marked `INVALID_ROBOTS_RUN.json` and must never be included in readiness. Adapter v15 preserves the underlying robots-fetch error and treats transient network/HTTP failures as retryable errors.

The stopped v15 checkpoint plus historical results covers **1,310 groups**. An attempt-lineage audit found that 21 of its 492 source-reported complete groups lacked **8,538 saved job rows**; those groups are held for revalidation. The remaining **471 groups** have matching source and payload counts, with 55,512 candidate rows. The reporter holds 31,307 records with invalid or unverified job URLs, 4,683 whose descriptions would trigger Job CEO to fetch the URL, and 394 with application-form URLs; **19,128 payloads pass these minimum readiness checks**. The 31,307 URL holds include 29,313 historical and 1,994 v15 Workday listings whose URLs omitted the Workday site segment. The four v15 shards stopped after 20 valid source results to add an application-form redirect guard and Workday detail validation. The v16 continuation repairs Workday job details and rejects Taleo portal-shell false positives. Of the 471 count-matched complete groups, 164 still have at least one held payload. All remaining groups still need a first pass, and a complete listing result alone does not prove its job payloads are ready or that Job CEO will log them.

The scrape-only continuation now has a reconciled checkpoint: the four v16 first-pass shards were stopped after **158 groups** and **21,397 saved job rows**, all valid JSONL with no complete-source payload shortfall. A 24-worker-per-shard v21 trial was stopped after 59 results because 15 unrelated hosts had TLS failures while checking robots files. Its four folders are marked `INVALID_ROBOTS_RUN.json` and excluded from readiness. A 16-worker-per-shard v21b run recorded five valid outcomes and requeued one error. The four v22 shards were frozen after **131 count-matched source results**; the v23 continuation recorded seven results (three partial, four error) before it was paused. Its frozen checkpoint requeued **8,335 groups** to four active v24 shards, so **158 + 5 + 131 + 3 + 8,335 = 8,632** with no unassigned group. The four v23 errors are in the v24 retry set; three partial results are retained in the checkpoint and need source-specific follow-up. The v22 crawler stops after ten consecutive denied public job details; v23 also stops after 20 consecutive pages without an extractable job. Both limits leave the source partial with an unvisited count. Other cohorts overlap this inventory, so **do not add their group counts** to the 9,919 denominator. At the pause, Workday revalidation had 115 of 116 results; TalentBrew v18 had 34 of 37, its v20 retry had 14 of 14 (11 scraped, 3 partial), and payload-count revalidation had 19 of 21. These checkpoints are preserved and not yet reconciled into one final report. Taleo revalidation finished four groups, all partial with no validated jobs. The v20 Workable replay completed 15 of 15 groups with 797 minimum-ready jobs. The v20 TalentBrew Consor pilot completed 162 of 162 jobs, including 130 public HTML detail descriptions; the v22 Toro pilot completed 190 of 190 minimum-ready jobs. SmartRecruiters revalidation completed 13 of 18 groups at v19 and recovered another four groups with 25 minimum-ready jobs at v21; one source with a stale HTTP 404 detail remains partial. The v23 SuccessFactors first pass found that Barton Malow’s page omits the schema title and URL; the v24 adapter now requires its exact public page title, listing-card title, single JobPosting root, single long description, and matching same-host job ID. The v24 retry finished all three supported boards: Barton Malow is complete with 162 ready jobs; Lincoln Electric is partial with 272 of 273 details validated; Hubbell is partial with 644 of 646 details validated. The three missing details did not provide usable descriptions, so both incomplete sources remain held from readiness. A private triage of 28 Phenom sources found 28,175 denied sitemap candidates and no verified alternate public listing. These are access holds; the denied candidate count is not a job count. No jobs from these runs have been posted to TalentOS, and their results are not in the frozen v15 private ZIP.

## What is on this branch

- `scripts/employer_career_ingest.py`: the discovery crawler and a dry-run-by-default Job CEO batch uploader. It checkpoints each source in `source_results.jsonl` and payloads in `jobs.jsonl`. Since v19, every result and its job rows share a crawl-attempt ID; the writer saves payloads before publishing the result, and it does not suppress refreshed rows from another source or attempt. `--skip-attempted` resumes one inventory pass after interruption without redoing recorded failures; the default mode retries incomplete groups. `--shared-host-rate-dir` enforces cross-process per-host request spacing.
- `scripts/report_employer_career_ingest.py`: combines crawl checkpoints, selects complete results by adapter version **and exact attempt**, and writes `ready_jobs.jsonl`, `source_dispositions.csv`, and `readiness_summary.json`. It holds a source if the selected complete result's job count differs from its saved payload rows. Legacy results without attempt IDs qualify only when their source/version appears in exactly one result attempt across the selected runs. Ready payloads require a valid HTTPS job URL outside application-form routes and at least 201 description characters, so Job CEO uses the supplied description without fetching the URL. Use `--min-sitemap-adapter-version employer-career-ingest-v14` to hold historical generic sitemap results until revalidated.
- `scripts/shard_employer_career_tracker.py`: creates balanced, host-exclusive private cohort trackers and a hash manifest. `--exclude-adapter-version` names the version in the checkpoint used for exclusion.
- `scripts/prepare_employer_career_resume.py`: audits frozen shards for exact source and payload-attempt coverage and builds private retry CSVs. It retains valid source results, requeues errors and incomplete payload attempts, and never changes the frozen input files.
- `scripts/report_employer_career_safe_runs.py`: pairs result/job files and excludes run folders marked `INVALID_ROBOTS_RUN.json`; `--allow-pending` permits a live shard folder that has not created both files yet.
- `scripts/open_position_links.py`: a conservative same-host openings fallback that remains partial until a source-specific completeness check exists.
- `scripts/jazzhr_public_board.py`: validates public JazzHR listing pages without an undocumented feed.
- `scripts/workday_public_detail.py`: validates public Workday CXS details, full descriptions, and canonical job URLs before a Workday source is complete.
- `scripts/talentbrew_public_board.py`: validates TalentBrew/Radancy HTML listing totals, pagination, and same-host details.
- `scripts/talentbrew_public_detail.py`: validates public TalentBrew HTML job descriptions when a job page lacks schema.org JobPosting data, using the listed card title and same-host job ID.
- `scripts/successfactors_public_board.py`: validates server-rendered public SuccessFactors All-Jobs totals, pagination, and exact same-host details. When microdata omits title and URL, it accepts only one matching public JobPosting root, one long description, an exact page title/card-title match, and the listed same-host job ID. Other layouts remain partial.
- `scripts/smartrecruiters_public_detail.py`: validates full public SmartRecruiters job details against the HTML listing cards; v21 strips only a single UUID `trid` tracking query before fetching a public job page. Stale or mismatched detail pages leave the source partial.
- `scripts/workable_public_job_url.py`: derives a public Workable job page from a matching `/j/<id>/apply` URL without visiting the application route. The v20 crawler merges multiple location rows for one Workable job ID and retains the location set in `raw`.
- `scripts/careerplug_public_listing.py`: listing-only research parser. CareerPlug job links redirect to application forms, so this is not an integration-ready adapter.
- The broad offline suite passed 211 tests for v23b; 10 focused SuccessFactors tests pass after the v24 detail fallback. Four resume-audit tests cover checkpoint integrity and retry partitioning.
- `data/talentos-employer-careers/README.md`, `career_page_tracker_summary.json`, and `scrape_source_manifest.json`: source definitions, counts, and the exact tracker SHA-256.

The repository is **public**. The full `career_page_tracker.csv` and `source_dispositions.csv` contain internal company IDs and review notes, so they are ignored by Git and must be given to the developer through a private channel. The tracker SHA-256 in `scrape_source_manifest.json` is `6adc74d03ce965b6ca920b6c803c2fee3bc3f67807f04f10440404528e441c6d`. Place the private tracker at `data/talentos-employer-careers/career_page_tracker.csv` before running the crawler. The local ignored `outputs/employer-career-ingest-run-2026-11-12-v15-readiness-v19-final/employer-career-private-handoff-v15-audited-v19-2026-11-12.zip` contains the tracker, corrected dispositions, 19,128 gated payloads, run selection, cohort manifest, and hash manifest; deliver it privately. Its SHA-256 is `583d6f91f2f46994dd35261a2ac57f263c710bc10451ebfa3e9cd349b36b8a0b`. All earlier handoff ZIPs are superseded. Later crawl checkpoints require an updated private handoff.

To reproduce the local v14 cohort's exclusion while running newer code, use the *v14* checkpoint version explicitly. The private cohort input and checkpoint must be present first. The expected manifest records 220 excluded groups and 8,632 emitted groups.

```powershell
python scripts/shard_employer_career_tracker.py `
  --input outputs/employer-career-ingest-run-2026-11-12-v14/career_page_tracker_v14_coverage.csv `
  --exclude-results outputs/employer-career-ingest-run-2026-11-12-v14/source_results.jsonl `
  --exclude-adapter-version employer-career-ingest-v14 `
  --shards 4 `
  --output-dir outputs/employer-career-ingest-run-2026-11-12-v14/shards-4-v14-rebuilt
```

After the active shards finish, combine historical checkpoints and every clean continuation/revalidation run in version order. The safe-run wrapper excludes the four marked invalid v14 folders. Keep `--allow-pending` only for an interim snapshot.

```powershell
$runs = @(
  'outputs/employer-career-ingest-run-2026-11-05-v5',
  'outputs/employer-career-ingest-run-2026-11-05-v6',
  'outputs/employer-career-ingest-run-2026-11-12-v14'
)
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v15-shard-{0:D2}' -f $_) }
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v16-shard-{0:D2}' -f $_) }
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v21-shard-{0:D2}' -f $_) } # marked invalid; wrapper excludes
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v21b-shard-{0:D2}' -f $_) }
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v22-shard-{0:D2}' -f $_) }
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v23-shard-{0:D2}' -f $_) }
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v24-shard-{0:D2}' -f $_) }
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v16-workday-{0:D2}' -f $_) }
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v16-taleo'
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v18-talentbrew-{0:D2}' -f $_) }
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v18-workable'
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v19-payload-{0:D2}' -f $_) }
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v19-smartrecruiters'
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v20-workable'
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v20-talentbrew-consor-pilot'
1..4 | ForEach-Object { $runs += ('outputs/employer-career-ingest-run-2026-11-12-v20-talentbrew-{0:D2}' -f $_) }
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v22-talentbrew-toro-pilot'
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v21-smartrecruiters'
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v23-successfactors-hubbell-pilot' # partial dispatch pilot
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v23b-successfactors-hubbell-pilot'
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v23b-successfactors-supported-cohort'
$runs += 'outputs/employer-career-ingest-run-2026-11-12-v24-successfactors-run'
$reportArgs = @(
  'scripts/report_employer_career_safe_runs.py',
  '--tracker', 'data/talentos-employer-careers/career_page_tracker.csv',
  '--adapter-version', 'employer-career-ingest-v11,employer-career-ingest-v12,employer-career-ingest-v13,employer-career-ingest-v14,employer-career-ingest-v15,employer-career-ingest-v16,employer-career-ingest-v17,employer-career-ingest-v18,employer-career-ingest-v19,employer-career-ingest-v20,employer-career-ingest-v21,employer-career-ingest-v22,employer-career-ingest-v23',
  '--min-sitemap-adapter-version', 'employer-career-ingest-v14',
  '--output-dir', 'outputs/employer-career-ingest-run-2026-11-12-v24-readiness'
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
