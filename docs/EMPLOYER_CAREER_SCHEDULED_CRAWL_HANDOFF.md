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
- TalentOS staging remains off unless the operator supplies `--ingest`, a
  private permission manifest, and `INGEST_SECRET`. The scheduled wrapper
  filters to exact approved URLs and passes the same manifest to the crawler,
  which checks every input URL again before any request. A direct dry-run with
  no manifest is still a raw crawl mode and must not be used for this inventory.

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
adds saved Nov 13-14 attempts through v25. The checked-in crawler is now v34;
none of these counts proves a full crawl with the current adapter code.
The latest saved scheduler validation, dated 2026-11-14, had zero permission
rows, selected zero sources, started no content fetch, and invoked no
TalentOS ingest.

The v26 robots audit recorded 5,932 source URLs allowed, 69 disallowed, and
3,918 unresolved. Later November 14 retries covered only subsets and did not
produce a new full-denominator audit. Robots allowance does not establish the
right to collect and reuse jobs. The approved per-source permission manifest
is absent from this checkout; its template is blank. Private review queues
have now been generated from the exact tracker/disposition join. They contain
all 9,919 groups with `pending` status and blank evidence fields; one also has
employer/route/history context. Neither queue grants permission. The current
v34 scheduler was run against the enriched queue and selected zero groups,
started zero content fetches, and invoked no ingest. The queues and preflight
output are in the gitignored private reconciliation folder named in the
Operational review files section. The scheduled runner must remain at zero
sources until reviewers record approved, unexpired exact-source evidence.

The current crawler recognizes 565 direct ATS/API routes in the tracker; the
other 9,354 use generic discovery. The v25 historical outcomes contain 335
complete and 230 incomplete direct-route groups; the private
`adapter_family_historical_matrix.csv` breaks these down by route family, and
`direct_route_remediation_matrix.csv` breaks down incomplete work: 122 groups
need exact configuration or authorization, 22 need access/freshness resolution,
and 86 need a sanitized source fixture before a parser/payload change is
justified. No direct-route group has a verified v34 attempt; even the historical
complete outcomes still need a current approved run. These are not current v34
validations. The v34 classifier also requires exact
vendor domains or dot-boundary subdomains for Greenhouse, Lever, Ashby, and
SmartRecruiters, preventing lookalike-domain false matches; none of the 9,919
current rows changed route family. This includes 14 verified iCIMS host/path
aliases and one exact ApplicantPro path-derived tenant route now handled by
existing adapters. Under the current route mapping, the v25 offline report
records 910 generic `scraped`, 232 `no_jobs`,
6,172 `partial`, 1,380 `error`, 598 `blocked`, 56 `needs_revalidation`, five
`held`, and one `payload_count_mismatch`. A direct route means that code has a source path; it
does not mean the tenant is configured, permission is approved, or current
coverage was verified. These are historical outcomes, not current-code
validation or permission. The 9,074-host route audit found 8,834 hosts represented once,
so much of the remaining adapter work is a long tail of custom employer pages.
Current exact-route cohorts identified in the audit include GovernmentJobs /
SchoolJobs (70), ADP Workforce Now (23), Jobvite (7), Dayforce (9), USAJOBS
(7), and Taleo Business Edition (7). UKG / UltiPro, Paycom, AppliTrack, and
JobDiva are generic policy-held or unresolved groups, not direct adapter
routes. A route match alone does not prove vendor identity or collection
rights.

The November 26 offline vendor audit used the current 9,919-row source
disposition file. Within the 9,354 generic groups, it found 26 Oracle Cloud
sources (25 historical partials for missing JobPosting markup, one robots
block), one separate Oracle-branded source (partial), five JobDiva sources
(all partial for missing JobPosting markup), 27 UKG / UltiPro sources, five
UKG Ready sources, one `ukg.net` source, 24 Paycom-family sources, five
AppliTrack sources (three errors, two partials), and two SilkRoad sources (one
error, one partial). The UKG and Paycom groups are policy-held. These are
subset counts, not new groups to add to the denominator.

A local recursive scan found 23 HTML files in saved output folders, but none
was provenance-linked to the Oracle or JobDiva groups, and none contained
those vendors' source markers. Treat them as unsuitable parser fixtures. There
is no evidence-backed parser change to make from the current artifacts.
Oracle's published Candidate Experience requisition REST endpoints are marked
internal-use, while its posted-job details endpoint is limited to approved
Oracle Cloud Marketplace partners; do not treat them as an anonymous public
feed. See [Oracle Candidate Experience requisitions](https://docs.oracle.com/en/cloud/saas/human-resources/farws/api-recruiting-ce-job-requisitions.html)
and [Oracle posted jobs](https://docs.oracle.com/en/cloud/saas/human-resources/farws/api-job-site-posted-jobs.html).
JobDiva's [official FAQ](https://www.jobdiva.com/faq) describes its candidate
career/jobs portal, but the reviewed official pages do not provide a publicthird-party job-feed contract. Keep both groups partial until a sanitized
board/detail fixture and a supported, authorized collection route are
available.
The alias audit also found eight source groups on known ATS hostnames where the
existing direct adapter lacks a required identifier: three Paylocity board
UUIDs, three Workday site paths (all with historical DNS errors), and two
Rippling board paths. They remain generic until the source-specific ID or route
is verified; no tenant identifier is guessed. Vendor docs say Paylocity API
access is provisioned through an integration agreement, Workday Career Site
IDs are tenant-configured and can be excluded from third-party indexing, and
Rippling recruiting APIs require company-scoped credentials and permissions;
none documents public discovery of these missing identifiers. See [Paylocity
Developer Portal](https://developer.paylocity.com/integrations/docs/using-developer-portal),
[Workday Career Sites](https://doc.workday.com/workday-education/en-us/course-manuals/recruiting-for-administrators/career-sites.html),
[Workday Recruiting API](https://developer.workday.com/documentation/axg1518029552225),
[Rippling Talent API](https://developer.rippling.com/documentation/rest-api/guides/talent-getting-started),
and [Rippling job requisitions](https://developer.rippling.com/documentation/rest-api/guides/job-requisitions).

The largest incomplete method groups in the v25 offline report are 2,580
partial `no_job_urls_in_sitemaps`, 1,828 partial
`no_jobposting_structured_data_on_linked_pages`, and 1,120 partial
`sitemap_structured_data` sources. In the first group, 2,305 sources also had
candidate pages without recognized job schema. In the sitemap group, 862 had
at least one detail without recognized schema and 132 hit a crawl or sitemap
cap. These are source-group counts; detail-note counts can overlap. The same
report has 184 partial linked Workday groups (107 recorded unavailable public
details, 47 pagination/duplicate inconsistencies, and 16 robots issues) and
104 partial linked iCIMS groups, 87 with robots restrictions. Workday v30 added
acceptance of the validated public `/job/<slug>` detail path when its location
segment is absent; the historical reports do not preserve rejected path shapes,
so recovery must be measured in a permitted current-version retry. The iCIMS
robots cohort still needs source-specific permission or a supported feed.

The v33 offline reconciliation assigns one privacy-safe primary reason to
each incomplete source group: 5,411 parser/extraction, 1,151 DNS, 632
HTTP/access, 503 robots transport/unavailable, 290 other, 243 robots denial,
110 vendor/authorization hold, 44 transport/timeout, 56 revalidation, and two
payload mismatches. Separately, the historical error audit found 1,134 DNS
failures and 165 transient robots-fetch transport/TLS failures among 1,406
error groups. These 1,299 groups are candidates for a controlled retry after
each source has an approved permission row; they stay errors until a current
attempt succeeds. The other 107 errors comprise career-page HTTP failures
(47), application-form refusals (27), unavailable robots policy (15),
timeouts (3), oversized responses (2), and other errors (13). A blocked
status remains a policy/access disposition, not a retry instruction by itself.

A November 26 terms/robots review identified ten source groups hosted directly
on third-party job boards: four Indeed, four LinkedIn, one Lensa, and one
ZipRecruiter. These are among the 9,354 generic groups, not extra groups in the
9,919 denominator. v34 holds them before source requests and at the centralized
request/redirect boundary. They need a vendor-authorized interface that grants
TalentOS collection and reuse rights; an employer's career-page permission
alone does not authorize scraping a third-party board. No current crawl has
reclassified these sources yet.

A separate review found three employer records using `jobs.silkroad.com`.
SilkRoad documents a customer RSS feed for its Candidate Experience site, but
the feed reflects only configured public detail-page fields and does not prove
complete ATS coverage or third-party reuse rights. v34 holds this host at source
preflight and the request/redirect boundary until the employer/vendor confirms
feed coverage, robots access, and recurring TalentOS collection and reuse.

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

GovernmentJobs and SchoolJobs now have a customer RSS adapter in
`scripts/neogov_customer_rss.py`. It never scrapes their public pages. Configure
`TALENTOS_NEOGOV_RSS_CONFIG_JSON` with the exact normalized source URL and
employer-key set, customer feed URL, exact feed/posting host allowlists, written
permission and TalentOS reuse references, and a sanitized sample that confirms
the item schema, full descriptions, and full-feed coverage. The crawler fetches
only that customer feed through robots checks and same-host redirect allowlists;
it never opens posting links. Without the complete configuration, the public
NEOGOV source remains held. NEOGOV's [RSS setup notice](https://success.neogov.com/insight-product-updates-112/insight-summer-2025-release-notes-15859)
documents customer feeds for external integrations, but does not grant
TalentOS reuse rights or prove the feed's fields and coverage. Its [terms](https://www.neogov.com/terms-of-use)
restrict scraping public career pages.

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
schema. JobDiva's [official FAQ](https://www.jobdiva.com/faq) confirms a
candidate career/jobs portal, but the reviewed official material does not
document a public listing API or third-party vacancy rights. No JobDiva
adapter is enabled. These domains are hard-held in the crawler even if a
permission row is mistakenly marked approved. Do not activate these cohorts
until the vendor and employer supply the documented interface and written
permission covering TalentOS collection and reuse.

The generic page discovery path also recognizes linked TalentBrew and SAP
SuccessFactors boards. This is the current code surface, not a claim that every
tenant layout has been validated. NEOGOV's public pages remain held; only its
strict customer RSS config can enable the separately authorized feed. Built-in
holds for Paycom, UKG, UKG Ready, iSolved, Frontline / AppliTrack, and JobDiva
remain in force even if an entry is mistakenly marked approved in the ledger.
ADP, Jobvite, Taleo Business Edition, and NEOGOV can run only when their exact
customer config validates in addition to the permission row.
NEOGOV's [terms](https://www.neogov.com/terms-of-use)
prohibit automated page scraping and competitive-product use of public career
pages; the RSS notice does not grant TalentOS reuse rights.

## Work plan to close the inventory

Keep the 9,919 normalized source groups as the denominator. Run these tracks
in parallel, then reconcile their source-level results in one private
checkpoint:

1. **Adapter cohorts:** fix partial/error groups only when a representative
   saved fixture or official API contract supports the change. Start with the
   565 direct ATS/API routes and the largest technically actionable vendor groups.
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

Automatic production import is not enabled. Do not add the crawler's
`--ingest` to the recurring command: it is a manual staging path, not the
combined version-aware incremental workflow. A separate
`scripts/employer_career_incremental_upload.py` is now available and is
dry-run by default. It accepts only current-adapter ready payloads, rechecks
the active exact-source permission manifest and source/job-host policy holds,
deduplicates stable external IDs, and stores a private resumable checkpoint.
With explicit `--ingest`, it stages all batches with dispatch deferred, then
dispatches the exact run once; `--wait-for-run` also checks terminal status and
reports Job CEO's `logged_count` separately from staged count. The run uses
`INGEST_SECRET` and `CRON_SECRET`. Apply
`sql/neon_fixes/127_job_ceo_deferred_staging_status.sql` first. The uploader's
14 offline tests passed; API-route tests and TypeScript checks still need to
run in a development environment with Node dependencies. The private
permission manifest is absent here, and the v34 preflight still selects zero
sources; crawl outcomes remain historical through Nov 14, so this code is not
ready to activate against TalentOS. Keep `BASE_URL`, `INGEST_SECRET`, and `CRON_SECRET` in the private
secret store and out of logs.

## Adapter gap work

Use the private source-level inventory and readiness results to prioritize
adapter work. For each new vendor, add an offline fixture for the board and
detail response, validate pagination/counts and unique posting IDs, assert the
adapter stays within the approved host, and keep the source partial when it
cannot account for all visible listings. Do not probe undocumented vendor
endpoints. The aggregate route inventory and terms review are local ignored
outputs from the current audit, not part of this public handoff.
To regenerate the privacy-safe route-family counts from a newer disposition
export, run:

```powershell
python scripts/report_employer_career_family_matrix.py `
  --dispositions <private-source-dispositions.csv> `
  --output <private-adapter-family-matrix.csv>
```

The output contains adapter family, outcome totals, and status counts; it omits
employer names and source URLs.

## Operational review files

The current local offline readiness reconciliation is saved at
`outputs/employer-career-ingest-run-2026-11-26-offline-v33-route-and-reason-reconciliation/`.
It contains the full 9,919-row source disposition export, an enriched permission
review queue and a seven-column pending manifest (all rows pending, zero
approved), an integration-ready payload snapshot, the direct adapter-family
and remediation matrices, and a generic vendor gap audit. A current-code v34 scheduler preflight
is in `pending-manifest-scheduler-preflight-v34/`; it selected zero groups,
invoked no crawler, made zero content requests, and invoked no ingest. Crawl
outcomes remain based on attempts through Nov 14. The entire folder remains
gitignored; never publish the queues or job payloads.
The Nov 14 audit report remains at
`outputs/employer-career-ingest-run-2026-11-14-v26-remaining-robots-preflight/`;
it contains the source-to-key map, robots outcomes, vendor route inventory,
and terms review. Keep both artifacts in the private workspace and share them
only through the approved private channel.
