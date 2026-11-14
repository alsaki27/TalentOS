# Employer career scheduled crawl handoff

This runbook prepares the existing employer career crawler for a recurring,
resumable run on a private machine or private runner. The source tracker and
per-source permission ledger are intentionally not committed to this public
repository.

## What is ready

- `scripts/employer_career_ingest.py` contains the current source adapters,
  robots handling, checkpointing, and the same Job CEO staging API used by the
  Actalent ingestion path.
- `scripts/employer_career_scheduled_run.py` filters the verified tracker to
  exact normalized URLs with an approved, unexpired permission record, prevents
  overlapping runs, and keeps source URLs out of console summaries.
- Scheduled runs refresh completed sources after a configurable age while
  retaining attempt/job lineage. The default scheduled refresh interval is 24
  hours.
- The scheduled summary reports `crawler_invoked` separately from the
  crawler's measured `content_request_count`; it calls a run complete only
  when the child summary matches the current adapter version and filtered
  tracker hash.
- TalentOS staging remains off unless the operator supplies `--ingest` and
  `INGEST_SECRET`.

## What is not ready to enable across all sources

The latest frozen inventory contains 9,919 source groups across 10,718
employer keys. Its v26 robots-only audit found 5,932 source URLs allowed, 69
disallowed, and 3,918 unresolved. Robots allowance does not establish the
right to collect and reuse jobs. The reviewed vendor terms did not establish a
vendor-wide TalentOS reuse grant, and the tracker currently has no per-source
permission approvals. Therefore the scheduled runner will make no content
requests until the permission manifest is populated with reviewed evidence.

The scraper's current URL patterns recognize 427 direct ATS routes in that
inventory. The other 9,492 do not match a known pattern; this includes both
employer-hosted sources and ATS hosts the scraper does not recognize. A generic
fallback may extract some of these, but the route inventory does not prove full
adapter coverage. Treat a source as ready only after the result is complete and
the visible job count/detail checks pass.

An offline v28 history snapshot for those 9,492 routes recorded 838 `scraped`,
215 `no_jobs`, 5,649 `partial`, 2,141 `error`, 587 `blocked`, 56
`needs_revalidation`, five `held`, and one `payload_count_mismatch`. These are
historical outcomes, not current readiness or permission. Of 9,074 hosts, 8,834
occur only once, so the remaining adapter work is mostly a long tail of custom
employer pages. The largest recognizable unclassified host groups were
GovernmentJobs (69), ADP (25), UKG/UltiPro (27), Paycom (22), and Jobvite (7);
these should stay held under the source policy. Smaller technical candidates
for evidence-backed adapter work include Dayforce (5), Taleo Business Edition
(5), AppliTrack (4), USAJobs (3), and JobDiva (3). Host-pattern counts do not
prove that each source is the named vendor or that collection is authorized.

The direct URL adapters cover Greenhouse, Lever, Ashby, SmartRecruiters,
Workable, Recruitee, Pinpoint, Breezy, Teamtailor, Personio, BambooHR, iCIMS,
ApplicantStack, ApplicantPro, JazzHR, Paylocity, Rippling, Workday, and Taleo.
The v28 Dayforce adapter calls the customer `GET JobFeeds` API for the five
identified routes, but remains held until each employer provides its authorized
tenant configuration and the source has an approved permission-manifest row.
The v27 USAJOBS adapter uses the official Search API, but it stays held until
the private runner has a registered API key, API email, and exact URL-or-host-
to-organization-code map.
The generic page discovery path also recognizes linked TalentBrew and SAP
SuccessFactors boards. This is the current code surface, not a claim that every
tenant layout has been validated. Built-in holds for NEOGOV GovernmentJobs /
SchoolJobs, Jobvite, Paycom, UKG, UKG Ready, iSolved, and ADP remain in force
even if an entry is mistakenly marked approved in the ledger. NEOGOV's terms
prohibit automated page scraping and competitive-product use of its public
career pages; its RSS documentation describes customer integrations, not a
blanket third-party TalentOS grant. Keep the cohort held until a suitable
authorized feed agreement exists. See [NEOGOV terms](https://www.neogov.com/terms-of-use)
and its [RSS feed customer notice](https://success.neogov.com/insight-product-updates-112/insight-summer-2025-release-notes-15859).

## Private inputs

Keep these files on the private runner or in an approved private artifact
store:

- `data/talentos-employer-careers/career_page_tracker.csv`
- A completed copy of
  `data/talentos-employer-careers/collection_permission_manifest.template.csv`
- The scheduled output directory, logs, and crawl checkpoints

Do not add the tracker, permission evidence, source URLs, job payloads, or logs
to this repository or to public CI artifacts. The tracker is gitignored.

The permission CSV has one row per normalized source URL:

| Column | Required value |
|---|---|
| `normalized_url` | Exact URL after TalentOS URL normalization |
| `permission_status` | `approved`, `pending`, `hold`, or `revoked` |
| `collection_scope` | `job_listings_and_details` for approved rows |
| `permission_evidence_ref` | Private contract, employer approval, or applicable policy reference |
| `reviewed_at_utc` | ISO-8601 review timestamp |
| `reviewed_by` | Reviewer identifier |
| `expires_at_utc` | Optional ISO-8601 expiration; expired rows are held |

An approval must cover the employer's current source route, any ATS-hosted
listing/details that the adapter visits, and TalentOS' intended collection and
reuse. For a URL shared by multiple employer keys, confirm the evidence covers
the full board scope before approving that URL. The runner rejects duplicate
normalized URLs and approved rows without scope, evidence, reviewer, or review
date.

## First run: dry-run only

From the repository root, after securely placing the private tracker and
reviewed permission CSV:

```powershell
python -m pip install -r scripts/requirements-agency-sources.txt
python scripts/employer_career_scheduled_run.py `
  --input data/talentos-employer-careers/career_page_tracker.csv `
  --permission-manifest C:\TalentOS-private\collection_permission_manifest.csv `
  --output-dir C:\TalentOS-private\employer-career-crawl `
  --workers 4 `
  --refresh-completed-after-hours 24
```

The default behavior only fetches the URLs approved in the ledger and writes a
private crawl checkpoint. It does not post to TalentOS. If there are zero
approved sources, it records a summary and makes no career-page requests.

For USAJOBS sources, register TalentOS for an API key and keep `USAJOBS_API_KEY`,
`USAJOBS_API_EMAIL`, and `TALENTOS_USAJOBS_ORGANIZATION_MAP_JSON` in the
runner's private secret/config store. The map must match each source's exact
normalized URL or hostname to its official USAJOBS `Organization` code. The
adapter requests only the documented Search API, checks page totals, uses the
official announcement URL for each job, and refuses to run without all three
settings. The current API terms allow lawful commercial use of Public Data;
TalentOS still needs API credentials and must credit USAJOBS and link each
announcement. The adapter records `source_provider=USAJOBS`, retrieval time,
and the official announcement URL. The TalentOS job view should display this
attribution and avoid implying OPM endorsement. See the [Search API reference](https://developer.usajobs.gov/api-reference/get-api-search),
[API terms](https://developer.usajobs.gov/guides/terms-of-service), and
[quick start](https://developer.usajobs.gov/general/quick-start).
The scheduler still requires a reviewed approved row for each exact tracker
URL; record the API registration and accepted terms as the evidence reference.

For Dayforce, the private runner must provide
`TALENTOS_DAYFORCE_JOBFEED_CONFIG_JSON`, keyed by the exact normalized source
URL or its Dayforce hostname. Each value must provide `company_name` (the
Dayforce API CompanyName path segment), `username`, and `password`; use the
optional `internal_job_board_code` when one tenant serves distinct career
sites. Store this
JSON in the private secret store; do not add credentials to the tracker or
repository. The employer must enable external job-board sourcing and grant the
required web-services role access. The adapter requests active postings only,
starts at Dayforce's documented `www.dayforcehcm.com` API root even when the
public portal uses a tenant subdomain, honors robots and same-host redirect
allowlists, and copies the returned public job URL without opening it. The
scheduled runner still requires an approved permission
manifest row for the source URL. See Dayforce's [Get Job Postings API guide](https://dayforce.fluidtopics.net/r/documents/Dayforce-RESTful-Web-Services-Developer-Guide/RESTful-Get-Job-Postings)
and [customer configuration guide](https://help.dayforce.com/r/documents/Recruiting-Guide/Track-Candidate-Source).

## Start recurring runs

Use Windows Task Scheduler, Linux cron, or a private self-hosted runner to call
the same command on the desired cadence. Start with a daily dry-run after the
permission ledger has been reviewed. The lock file prevents two invocations
from overlapping. Crawl results append to the persistent output directory, so
completed sources are skipped until their refresh interval elapses and failed
or partial sources remain eligible for a later retry.

For Windows, this creates a daily 4:00 AM local-time dry-run task. Replace the
repository, Python, and private-data paths for the developer's machine:

```powershell
$repoRoot = 'C:\TalentOS'
$privateRoot = 'C:\TalentOS-private'
$python = (Get-Command python).Source
$script = Join-Path $repoRoot 'scripts\employer_career_scheduled_run.py'
$tracker = Join-Path $repoRoot 'data\talentos-employer-careers\career_page_tracker.csv'
$policy = Join-Path $privateRoot 'collection_permission_manifest.csv'
$output = Join-Path $privateRoot 'employer-career-crawl'
$arguments = '"{0}" --input "{1}" --permission-manifest "{2}" --output-dir "{3}" --workers 4 --refresh-completed-after-hours 24' -f $script, $tracker, $policy, $output
$action = New-ScheduledTaskAction -Execute $python -Argument $arguments -WorkingDirectory $repoRoot
$trigger = New-ScheduledTaskTrigger -Daily -At '4:00AM'
Register-ScheduledTask -TaskName 'TalentOS Employer Career Crawl' -Action $action -Trigger $trigger -Description 'Policy-gated dry-run employer career crawl'
```

To stage only complete, validated source results through TalentOS' existing
Job CEO pipeline, configure `BASE_URL` and `INGEST_SECRET` in the runner's
secret store, then add `--ingest` to the scheduled command. The crawler still
builds a readiness report and posts only the current adapter's complete
payloads. Do not put secrets in command-line arguments or logs.

## Adapter gap work

Use the private source-level inventory and readiness results to prioritize
adapter work. For each new vendor, add an offline fixture for the board and
detail response, validate pagination/counts and unique posting IDs, assert the
adapter stays within the approved host, and keep the source partial when it
cannot account for all visible listings. Do not probe undocumented vendor
endpoints. The aggregate route inventory and terms review are local ignored
outputs from the current audit, not part of this public handoff.

## Operational review files

The current local audit report is saved at
`outputs/employer-career-ingest-run-2026-11-14-v26-remaining-robots-preflight/`
and remains gitignored. It contains the source-to-key map, robots outcome,
vendor route inventory, and current terms review for the developer to review
through the approved private channel.
