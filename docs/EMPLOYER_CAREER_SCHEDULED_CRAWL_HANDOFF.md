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
  `INGEST_SECRET`. Only the scheduled wrapper applies the private permission
  manifest; invoking the crawler CLI directly does not enforce that manifest.

## What is not ready to enable across all sources

The tracker snapshot contains 9,919 verified source groups across 10,718
verified employer keys. The latest full-denominator report in this checkout is
an offline reconciliation dated 2026-11-26 of saved crawl attempts through
2026-11-14. It selects historical adapter results v11-v25 and records 1,477
complete groups (1,194 with jobs, 283 confirmed empty) and 8,442 incomplete
groups (6,323 partial, 1,406 errors, 649 blocked, 56 needing revalidation, six
held, and two payload-count mismatches). It contains 117,738 unique payloads
from complete groups, of which 117,135 passed integration-readiness checks;
`live_ingest_performed` is false. Fifty-four result URLs outside the current
tracker were excluded from the denominator and payload output.

The folder name `v28-overall-readiness-frozen` is a cohort label: its original
report selected historical results only through v23. The new offline report
adds saved Nov 13-14 attempts through v25, but the checked-in crawler is now
v29; none of these counts proves a full crawl with the current adapter code.
The latest saved scheduler validation, dated 2026-11-14, had zero permission
rows, selected zero sources, started no content fetch, and invoked no
TalentOS ingest.

The v26 robots audit recorded 5,932 source URLs allowed, 69 disallowed, and
3,918 unresolved. Later November 14 retries covered only subsets and did not
produce a new full-denominator audit. Robots allowance does not establish the
right to collect and reuse jobs. The private per-source permission manifest
is absent from this checkout; its template is blank. The scheduled runner
therefore has no recorded approved sources and must make no content requests
until the private manifest is populated with reviewed evidence.
This leaves zero source groups cleared for scheduled content collection in the
saved operational checkpoint, even though the code can schedule an approved
subset once the private inputs are supplied.

The current crawler recognizes 480 direct ATS/API routes in the tracker; the
other 9,439 use generic discovery. For those generic routes, the offline
consolidation records 923 `scraped`, 232 `no_jobs`, 6,235 `partial`, 1,387
`error`, 600 `blocked`, 56 `needs_revalidation`, five `held`, and one
`payload_count_mismatch`. These are historical outcomes through v25, not
current-code validation or permission. The 9,074-host route audit found 8,834
hosts represented once, so much of the remaining adapter work is a long tail of
custom employer pages. Current exact-route cohorts identified in the audit
include GovernmentJobs / SchoolJobs (69), ADP Workforce Now (23), UKG / UltiPro
(27), Paycom (22), Jobvite (7), Dayforce (9), USAJOBS (7), and Taleo Business
Edition (7). The route match
alone does not prove vendor identity or collection rights.

The direct URL adapters cover Greenhouse, Lever, Ashby, SmartRecruiters,
Workable, Recruitee, Pinpoint, Breezy, Teamtailor, Personio, BambooHR, iCIMS,
ApplicantStack, ApplicantPro, JazzHR, Paylocity, Rippling, Workday, and Taleo
Enterprise. ADP Workforce Now now has a strict customer API adapter in
`scripts/adp_wfn_adapter.py`. It requires an exact source/employer mapping,
written authorization evidence, provisioned read scope, confirmed response
fields, mutual-TLS credentials, and an operator-verified exact candidate-host
allowlist. During setup, the operator must verify that each host belongs to the
employer's candidate-facing flow; the adapter validates syntax and exact
membership but cannot verify ownership. It uses the documented 20-item pages
and marks the source incomplete if the total, public job URL, or full
description cannot be verified. ADP sources remain held without that exact
private configuration.

Store ADP settings in `TALENTOS_ADP_WFN_CONFIG_JSON`, keyed by the exact
normalized Workforce Now recruitment URL. The config must list the exact
canonical scope
`/staffing/staffingManagement/workFulfillmentManagement/jobRequisitionsManagement/jobRequisition.read`, employer keys, tenant client code,
client credentials, certificate/key paths, and candidate-host allowlist. The
public ADP sample does not establish that a full description is present on an
external posting instruction, so an authorized sanitized tenant sample must
confirm the description field before configuring that source. Credentials and
sample evidence stay in private storage.

The Dayforce adapter calls the customer `GET JobFeeds` API for nine mapped
routes, but each source stays held until the employer provides tenant
configuration and an approved permission-manifest row. The USAJOBS adapter
uses the official Search API for seven mapped routes, but they stay held until
the private runner has an API key, API email, and exact URL-or-host-to-
organization-code map.

For Jobvite, store `TALENTOS_JOBVITE_FEED_CONFIG_JSON` in the private secret
store, keyed by the exact normalized career-source URL. Each entry must match
the career-site slug and employer-key set, provide the customer API key/secret,
and cite the paid-feed contract, the TalentOS reuse grant, the single-response
coverage confirmation, and the full-description field confirmation. The
official guide does not document pagination, so the adapter makes one request
per board and requires explicit proof that the response contains all matching
jobs and complete descriptions. The documented limit is 500 calls per
credential per UTC day. The scheduler stores call counts in
`<private-output-dir>/crawl_state/jobvite_api_call_budget.sqlite3`; set
`TALENTOS_JOBVITE_CALL_BUDGET_DB` to one shared persistent path if multiple
runner processes use the same credentials. See Jobvite's [Job Feed API
guide](https://careers.jobvite.com/careersite/job_feed_api.html) and
[Terms of Use](https://www.jobvite.com/terms-of-use).

Taleo Business Edition is separate from the existing Taleo Enterprise
CareerSection adapter. Its RSS adapter is wired into crawler dispatch and
uses `TALENTOS_TALEO_TBE_CONFIG_JSON`, keyed by the exact normalized source URL.
Each entry requires the exact employer-key set, a customer-provided feed URL,
approved job-link hosts, written third-party aggregation authorization, and an
explicit `feed_coverage_confirmed=true` setting before a source can be
complete. The adapter checks robots for the feed host, follows redirects only
within that exact host, and never opens posting links. Missing feed coverage
confirmation leaves the source partial.

The remaining vendor cohorts stay held pending their missing interface or
rights evidence. Jobvite's public site is not an authorized feed; its paid
customer Job Feed API requires a customer key/secret and a TalentOS reuse grant.
UKG's [developer policy](https://developer.ukg.com/proplatform/docs/developer-policy)
requires provisioned interfaces and customer consent, and no public read-only
job feed schema was found. [Paycom's site terms](https://www.paycom.com/terms-of-use/)
and [customer API terms](https://cdn.paycom.com/mkon/www/media/resources-content/General_Terms_and_Conditions.pdf)
restrict automated extraction and third-party reuse without written
authorization. NEOGOV's [customer RSS notice](https://success.neogov.com/insight-product-updates-112/insight-summer-2025-release-notes-15859)
documents feed URL templates but no item schema, full-description guarantee,
or completeness semantics. Frontline / AppliTrack has no reviewed public feed
schema; JobDiva's API listing endpoint and third-party vacancy rights are also
unverified. Do not activate these cohorts until the vendor and employer supply
the documented interface and written permission covering TalentOS collection
and reuse.

The generic page discovery path also recognizes linked TalentBrew and SAP
SuccessFactors boards. This is the current code surface, not a claim that every
tenant layout has been validated. Built-in holds for NEOGOV GovernmentJobs /
SchoolJobs, Paycom, UKG, UKG Ready, and iSolved remain in force even if an entry
is mistakenly marked approved in the ledger. ADP and Jobvite can run only when
their strict customer API config validates in addition to the permission row.
NEOGOV's [terms](https://www.neogov.com/terms-of-use)
prohibit automated page scraping and competitive-product use of public career
pages; the RSS notice does not grant TalentOS reuse rights.

## Work plan to close the inventory

Keep the 9,919 normalized source groups as the denominator. Run these tracks
in parallel, then reconcile their source-level results in one private
checkpoint:

1. **Adapter cohorts:** fix partial/error groups only when a representative
   saved fixture or official API contract supports the change. Start with the
   480 direct ATS/API routes and the largest technically actionable vendor groups.
   Do not mark a route complete from host recognition or a successful HTTP
   response alone.
2. **Failure cohorts:** separate parser gaps from DNS, rate limits, server
   failures, robots denials, terms restrictions, and missing customer access.
   Retry only transient failures; keep blocked sources held with their reason.
3. **Long-tail pages:** use the generic structured-data/sitemap path where it
   can verify listing counts and details. Add a site-specific adapter only
   with saved page evidence and a completeness check. Most hosts in the
   inventory are singletons, so a generic “success” flag cannot stand in for
   source-specific validation.
4. **Permission and credentials:** maintain the per-URL permission manifest
   and vendor credentials in the private runner. Public visibility, robots
   allowance, or an API endpoint does not grant TalentOS collection and reuse
   rights. Sources lacking required approval, customer configuration, or API
   credentials stay held.
5. **Full checkpoint and handoff:** rerun the full tracker with the current
   adapter version, merge shards by normalized URL and attempt lineage, and
   generate the readiness report. The scheduled handoff is ready for a source
   only when the crawl is complete and its permission record is approved.

For each source group, record one verifiable outcome: complete with jobs,
complete and confirmed empty, partial with a specific gap, transient failure
with a retry condition, or a documented policy/permission hold. The overall
goal remains open until all 9,919 groups have a current disposition and every
source called schedulable passes the permission gate.

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

Automatic production import is not ready. Do not add `--ingest` to the
recurring command: that flag does not provide the combined version-aware,
incremental upload and stable retry state required for a schedule. The next
developer step is an uploader from the combined readiness selection that sends
only new or changed jobs with stable source/job IDs, preserves employer-key
mapping, and records which staged items reached `jobs`. The CLI `--ingest`
option is only a manual staging path after a separate reviewed approval. The
crawler CLI does not check the scheduler's permission manifest: a direct
`--ingest` invocation can stage sources that the scheduler would filter out.
Any manual staging run must therefore use an independently reviewed,
permission-filtered input file. Keep `BASE_URL` and `INGEST_SECRET` in the
private secret store and out of logs.

## Adapter gap work

Use the private source-level inventory and readiness results to prioritize
adapter work. For each new vendor, add an offline fixture for the board and
detail response, validate pagination/counts and unique posting IDs, assert the
adapter stays within the approved host, and keep the source partial when it
cannot account for all visible listings. Do not probe undocumented vendor
endpoints. The aggregate route inventory and terms review are local ignored
outputs from the current audit, not part of this public handoff.

## Operational review files

The current local offline readiness reconciliation is saved at
`outputs/employer-career-ingest-run-2026-11-26-offline-checkpoint-consolidation-through-2026-11-14/`.
It contains the full 9,919-row source disposition export and integration-ready
payload snapshot, uses saved attempts through Nov 14, and remains gitignored.
The Nov 14 audit report remains at
`outputs/employer-career-ingest-run-2026-11-14-v26-remaining-robots-preflight/`;
it contains the source-to-key map, robots outcomes, vendor route inventory,
and terms review. Keep both artifacts in the private workspace and share them
only through the approved private channel.
