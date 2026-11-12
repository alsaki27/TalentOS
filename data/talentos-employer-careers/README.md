# Employer career-source scrape input

`career_page_tracker.csv` is the verified-source snapshot used by
`scripts/employer_career_ingest.py`. It includes all 14,634 canonical
employer keys; the runner selects only the verified official-career-page and
employer-linked-ATS rows, grouping records that share an exact URL.

Snapshot scope: 10,718 verified employer records and **9,942 exact unique
career URLs**, which normalize to **9,919 crawl groups** after lowercasing the
hostname, dropping fragments, and trimming trailing slashes while preserving
scheme, path case, parameters, and query. The three-URL discrepancy from the
previously reported 9,939 is a tracker snapshot difference; the exact input
hash and both raw and normalized counts are written to each run manifest.
All employer keys and raw URL aliases from normalized duplicates are retained
in the result records; they are not discarded. One verified route is plain
HTTP and is held by the HTTPS-only fetch guard for manual review.
There are 1,462 ambiguous and 2,454 unresolved employer records; those are
not sent to a scraper because their career sources were not verified.

The source pages were verified for employer relationship. That does not prove
they permit crawling or expose jobs in a machine-readable way. The runner
honors robots policy, records blocked/error/partial results, and treats a
source as complete only when the selected adapter reaches its terminal
condition. Generic sitemap scans with excluded paths or caps are explicitly
partial.

Some vendors require a separate authorization path. Jobvite and Paycom career
sources are held because their terms prohibit automated extraction. iSolved
sources are held pending terms clearance or written permission. UKG Pro /
UltiPro sources are held until an authorized or documented public job interface
is available; UKG Ready sources are held by robots policy. The crawler does not
probe undocumented endpoints. ADP sources are held pending authorized API
access. These sources remain in the tracker and readiness report as blocked
policy holds.

Run a small, non-ingesting pass:

```powershell
python -m pip install -r scripts/requirements-agency-sources.txt
python scripts/employer_career_ingest.py --limit 10 --workers 2
```

Run/resume the full source inventory locally:

```powershell
python scripts/employer_career_ingest.py --workers 4
```

The default output directory is `outputs/employer-career-ingest/`:

- `source_results.jsonl` — per-URL status, completeness, adapter, job count,
  errors, and notes. Successful complete URLs are skipped when resuming.
- `jobs.jsonl` — append-only crawl checkpoint. It can contain payloads from
  partial sources and earlier attempts, so use the readiness report below to
  produce a clean integration candidate set.

Build a readiness snapshot from a crawl checkpoint:

```powershell
python scripts/report_employer_career_ingest.py `
  --tracker data/talentos-employer-careers/career_page_tracker.csv `
  --results outputs/employer-career-ingest/source_results.jsonl `
  --jobs outputs/employer-career-ingest/jobs.jsonl `
  --output-dir outputs/employer-career-ingest/readiness
```

The report keeps the latest result per normalized source while preserving an
earlier complete result for that adapter. It writes `ready_jobs.jsonl` only
from complete source groups, `source_dispositions.csv` for every tracker
group, and `readiness_summary.json` with the source and payload counts. This is
a dry-run artifact; it does not call the TalentOS ingest endpoint.

The runner is dry-run by default. To stage jobs through TalentOS' existing
`POST /api/job-ceo/ingest` pipeline, set `BASE_URL` and `INGEST_SECRET` in the
environment and pass `--ingest`. Before posting, it builds a readiness snapshot
and sends only current-version payloads from complete source groups. The
endpoint applies its existing deduplication and starts the Job CEO processing
flow; it does not directly insert into `jobs`.

Current ATS API adapters: Greenhouse, Lever, Ashby, Workday, Workable,
Recruitee, and Paylocity (public V2 feed documented at
[Paylocity Job Feed](https://recruiting.paylocity.com/Recruiting/v2/api/feed/documentation)). Other verified career sources use robots-aware sitemap traversal and
same-host linked-page discovery, extracting schema.org `JobPosting` JSON-LD or
microdata. Payloads record which structured-data format supplied each job.
Pinpoint-hosted pages use Pinpoint's documented public
[`postings.json` career feed](https://developers.pinpointhq.com/docs/jobs-json-endpoint),
which returns the postings as displayed on the employer career site.
The adapter validates each posting's ID, title, URL, and uniqueness before
marking that board complete.
Breezy career pages expose their active openings in a robots-checked public
JSON feed; the adapter validates each listed posting and enriches it from the
same-board detail page when available.
Personio-hosted pages use Personio's documented
[XML positions feed](https://developer.personio.de/v1.0/reference/get_xml).
Teamtailor-hosted pages use Teamtailor's documented
[RSS feed](https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide)
with offset pagination and full descriptions.
BambooHR career boards expose same-origin public JSON used by their career
pages. The adapter follows robots rules, validates the board's `totalCount`,
and fetches each same-board detail record before marking the source complete.
iCIMS public portals use server-rendered search-page pagination and structured
job detail pages. The adapter validates page indicators, collects unique job
cards across pages, and fetches each detail page for its `JobPosting` data.
ApplicantPro boards use the tenant's public `job_site_map.xml`, compare unique
posting IDs with a visible public-board total when static HTML exposes one, then
fetch every public job page. A sitemap must contain a valid posting set and all
detail pages must yield job payloads for the board to be marked complete.
ApplicantStack boards use their visible `Showing start-end of total` indicator,
validate the count against unique job links, and fetch each same-board detail.
Robots `Crawl-delay` directives are enforced by the request scheduler.
Taleo Enterprise career-section routes use the matching public
`/careersection/sitemap.jss?portalCode=...` sitemap, then fetch every job URL
listed for that section. A sitemap index is filtered to the route's matching
portal; unrelated sections are not combined. Taleo Business Edition `/ats/`
routes are not covered by this adapter and remain on the generic discovery
path.
Rippling boards use their public server-rendered pagination and detail-page data;
the adapter validates reported page totals and follows only same-board job URLs.
SmartRecruiters uses its robots-permitted public career-board HTML pagination,
validating page counts and per-location job-card totals without calling the
separate robots-disallowed API host.
The crawler also follows redirects and explicit career-page links to those
supported ATS boards. Network timeouts and transient server/rate-limit responses
are retried. Only groups marked `complete` are counted as fully ready; partial,
blocked, held, and error outcomes remain visible for follow-up.
Sites that need vendor-specific APIs or JavaScript rendering remain visible as
partial/error outcomes for subsequent adapter work.
