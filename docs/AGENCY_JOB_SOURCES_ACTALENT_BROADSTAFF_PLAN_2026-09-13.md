# Plan — Add Actalent + Broadstaff as daily job sources

**Date:** 2026-09-13
**Status:** Implemented 2026-09-13. See §9 for what was actually built, where it
deviated from this document, and what remains before the first scheduled run.
**Scope:** Add two agency career sites as recurring job sources feeding the existing Job CEO pipeline.

| | |
|---|---|
| Source 1 | `careers.actalentservices.com` (US) |
| Source 2 | `jobs.broadstaffglobal.com` |
| Target | `POST /api/job-ceo/ingest` → existing Job CEO stages → `jobs` table |
| Cadence | Daily, GitHub Actions, mirroring `openjobdata-nightly-ingest.yml` |

---

## 0. How to read this document

Everything in §1 and §2 was **verified live against the two sites and against this
repository on 2026-09-13**. Commands and observed responses are shown so the findings
can be re-run and disproved rather than trusted.

Anything not verified is called out explicitly under **§7 Open questions**. There are
no assumed field names, no assumed endpoints, and no invented API shapes anywhere in
this plan. Where a site behaves badly, that behaviour is recorded as a constraint, not
smoothed over.

---

## 1. Source research — verified findings

### 1.1 Actalent — `careers.actalentservices.com`

**Platform:** Phenom People. Confirmed by CDN markers in page HTML:
`https://cdn.phenompeople.com/CareerConnectResources/prod/ALGRUS/...`

**robots.txt** (fetched live) disallows `*/apply`, `*/chatbot`, `*/jobcart`,
`*/px-widgets`, `*/socialAut`, `*/iauth`, `*/glassdoor`, and the phenomtrack script.
It does **not** disallow `/search-results` or `/job/`, and it publishes four sitemaps:

```
Sitemap: https://careers.actalentservices.com/us/en/sitemap_index.xml
Sitemap: https://careers.actalentservices.com/gb/en/sitemap.xml
Sitemap: https://careers.actalentservices.com/ca/fr/sitemap_index.xml
Sitemap: https://careers.actalentservices.com/in/en/sitemap.xml
```

The two access paths we intend to use — the sitemap and the search-results page — are
both explicitly permitted. `*/apply` is disallowed and we will never touch it.

**Sitemap structure.** `us/en/sitemap_index.xml` lists 11 child sitemaps.
`sitemap1.xml` is 532 category/landing URLs; `sitemap2.xml` onward are job detail
URLs, 500 per file. All carried `lastmod 2026-09-13T08:20:32+00:00`.

**Job detail URL pattern:**

```
https://careers.actalentservices.com/us/en/job/{JP-XXXXXXXXX}/{Title-Slug}
```

`JP-006274336` is the requisition id — a stable natural key for `external_job_id`.

**Search endpoint.** `GET /us/en/search-results?keywords={kw}&from={offset}`.

The page embeds a complete JSON result set in its HTML under the key
`eagerLoadRefineSearch`. Observed shape:

```json
{"status":200,"hits":20,"totalHits":46,"data":{"jobs":[ ... ]}}
```

Per-job fields, read from a live payload (this is the full key list, not a sample):

```
title  reqId  jobId  jobSeqNo  descriptionTeaser  postedDate  dateCreated
city  state  country  cityState  cityStateCountry  location  latitude  longitude
multi_location  multi_location_array  isMultiLocation
category  subCategory  isMultiCategory  type  badge
applyUrl  externalApply  siteType  locale  ml_skills  ml_job_parser
```

**Pagination verified:**

| Request | totalHits | hits returned |
|---|---|---|
| `?keywords=fiber` | 46 | 20 |
| `?keywords=fiber&from=20` | 46 | 20 |
| `?keywords=fiber&from=40` | 46 | 6 |
| `?keywords=GIS` | 82 | 20 |
| `?keywords="OSP Design"` | 4 | 4 |
| *(no keyword)* | **5114** | 20 |

Page size is fixed at 20 — `size=100`, `pageSize=100` and `s=100` were all tested and
all returned 20. Total US inventory is **5,114 jobs**.

**Their keyword search is fuzzy and cannot be trusted for relevance.** This is the
single most important finding about this source. `keywords=fiber` returned
*"Hardware Test Engineer"* and *"Relay Technician"*; `keywords="OSP Design"` returned
*"Field Technician"*. The engine scores loosely across the whole document. Consequences
are handled in §3.2.

**Job detail page** carries a schema.org JSON-LD `JobPosting` block:

```
title              GIS Analyst
datePosted         2026-09-08
employmentType     ['CONTRACTOR']
hiringOrganization {'name': 'Actalent', ...}
jobLocation        {geo: {...}, address: {...}}
description        6305 chars (HTML, double-escaped: &lt;p&gt;&lt;strong&gt;...)
```

**Delisting signal is clean:** a removed/nonexistent requisition returns **HTTP 410
Gone** (`JP-000000000` → 410). A live one returns 200.

**Politeness/robustness:** six rapid sequential search requests all returned 200 in
1.2–3.6 s with no throttling. The site serves fine with no `User-Agent` header.

### 1.2 Broadstaff — `jobs.broadstaffglobal.com`

**Platform:** Haley Marketing. Confirmed by response header
`X-SASnode: v167-alma.haleymarketing.com`.

**robots.txt** contains no `Disallow` rules at all, and publishes one sitemap:

```
Sitemap: https://jobs.broadstaffglobal.com/sitemap/102028/sitemap.xml
```

**Inventory is small and entirely relevant.** The sitemap is a single flat file
containing **39 job URLs**, every one with `<changefreq>daily</changefreq>` and
`lastmod 2026-09-13`. Observed titles include *OSP Fiber Designer/GIS Specialist –
FTTH Drafter*, *Construction Manager OSP Underground Fiber*, *Fiber Splicing
Construction Manager*, *Coax Splicer*, *OSP Field Inspector*, *Telecom Technician –
Central Office*. This source is almost purely Group A/C material.

**Job detail URL pattern:**

```
https://jobs.broadstaffglobal.com/jb/{Slug}/{numericId}
```

**The slug is ignored.** `/jb/{correct-slug}/14162271`, `/jb/totally-wrong-slug/14162271`
and `/jb/x/14162271` all returned byte-identical 259,750-byte responses. Only the
numeric id is canonical — so URLs can be rebuilt from the id alone and slug drift can
never break us.

**Job detail page** carries two JSON-LD blocks (`Organization`, then `JobPosting`):

```
title              OSP Fiber Designer/GIS Specialist - FTTH Drafter
datePosted         2026-07-13
validThrough       2026-10-13
employmentType     CONTRACTOR
hiringOrganization {'name': 'Broadstaff', 'url': 'https://www.broadstaff.net'}
jobLocation        {'@type':'Place','address':{'addressRegion':'WI', ...}}
directApply        True
description        2283 chars
```

**Two traps, both verified:**

1. **A nonexistent job id returns HTTP 200, not 404.** `/jb/x/99999999` returned 200
   with a 235,617-byte "not found" page. Status code is therefore useless for
   delist detection — presence of a JSON-LD `JobPosting` block is the only valid test.

2. **The site 404s any `curl/*` User-Agent.** Verified matrix against the sitemap URL:

   | User-Agent | Result |
   |---|---|
   | curl default | **404** |
   | `curl/8.0` | **404** |
   | `python-requests/2.31.0` | 200 |
   | Googlebot | 200 |
   | Chrome desktop | 200 |

   A scraper that "works locally" and mysteriously returns nothing in CI would almost
   certainly be hitting this. The UA must be explicit and asserted, never left to the
   HTTP client default.

**Performance:** detail pages are slow — 7.0 s to 16.7 s each across five requests.
39 pages ≈ 4–11 minutes serially. Timeouts must be generous; a 10 s timeout would
flake constantly.

### 1.3 Side-by-side

| | Actalent | Broadstaff |
|---|---|---|
| Platform | Phenom People | Haley Marketing |
| Inventory (US) | 5,114 | 39 |
| Bulk list source | search JSON (20/page) **and** sitemap | sitemap only |
| Keyword search | exists, **fuzzy/unreliable** | not needed at this size |
| Detail format | JSON-LD `JobPosting` | JSON-LD `JobPosting` |
| Employer | always "Actalent" | always "Broadstaff" |
| Missing job | **410 Gone** | **200 + "not found" page** |
| UA sensitivity | none | **rejects `curl/*`** |
| Latency | 1.2–3.6 s | 7–17 s |

The shared JSON-LD `JobPosting` contract is what makes one extractor viable for both.

---

## 2. Existing pipeline — verified contract

Read from this repo, not assumed.

### 2.1 Ingest endpoint

`POST /api/job-ceo/ingest` (`src/app/api/job-ceo/ingest/route.ts`)

- Auth: `Authorization: Bearer ${JOB_CEO_INGEST_SECRET}`, **fails closed** if the env
  var is unset.
- Body: `{ runId?: string, jobs: Record<string,unknown>[] }`, rejects an empty array.
- Creates a run via `createRun({ triggerType: "cron", source: "openjobdata" })` when
  no `runId` is supplied.
- Dedups on `lower(title)|lower(company)` against the permanent
  `job_ceo_seen_signatures` table, then `insertStaged`.

### 2.2 Accepted staging fields

`insertStaged` (`src/server/repositories/jobCeoStagingRepository.ts`) writes exactly:

```
run_id  stage  dedup_signature  title  company  location
source_url  external_job_id  snippet  description_text  raw
```

Anything else in the posted object is ignored at this layer but survives inside `raw`.

### 2.3 Stage machine

From `dispatchNextJobCeoWork` (`src/server/services/jobCeoService.ts`):

```
run.status:     ingesting ──▶ qa ──▶ deep_fetch ──▶ matchmaking ──▶ completed
staging.stage:  ingested ──▶ researched ──▶ qa_passed ──▶ matched / logged
```

⚠️ **The run.status labels are offset from the work they perform.** While
`run.status === "ingesting"` the dispatcher calls `processDeepFetchBatch`; while
`run.status === "qa"` it calls `processQaBatch`. Deep fetch therefore runs **before**
QA. Reading the status name as the work being done is wrong, and would lead to
mis-sizing the crawl budget.

### 2.4 Two extension points that need no code change

1. **`job_ceo_runs.source` is free text.** `sql/neon_fixes/034_job_ceo.sql` defines
   `source text DEFAULT 'openjobdata'` with **no CHECK constraint** — unlike `status`
   and `stage`, which are both constrained. New source values need no migration.

2. **Provenance flows through `raw.source`.** The matchmaker builds the final row as
   `source: parsedRaw.source ?? "openjobdata"`. Setting `raw.source = "actalent"` at
   ingest tags `jobs.source` correctly with zero changes to the pipeline.

### 2.5 The deep-fetch short-circuit

`runDeepFetch` (`src/lib/ai/job-agents/deepFetch.ts`) returns immediately when
`description_text.length > 200`, without any HTTP fetch and without any AI call.

Because both sites hand us a full description in JSON-LD (6,305 and 2,283 chars in the
samples), **supplying it at ingest makes the deep-fetch stage free** — no Jina fetch, no
tokens, no third-party dependency, no login-wall risk. This is designed-in behaviour we
should exploit deliberately, and it is the main cost lever in this plan.

### 2.6 Safety rails already present

- `isSafeExternalUrl` is a **denylist** (private IPv4/IPv6, blocked hostnames and
  suffixes), not an allowlist — both target domains pass without modification.
- `createJob()` embeds the apply-link duplicate guard (`jobDuplicateGuard.ts`), the
  authoritative gate for everything Job CEO logs.

### 2.7 Keyword sources — and the gap

Two exist today:

1. **Static** — `src/lib/jobAgentRoleLibrary.ts`, groups A–R, mirrored by hand into
   `ROLE_GROUPS` in `scripts/openjobdata_ingest.py`.
2. **Dynamic** — `job_agent_keyword_groups` table (`label`, `keywords[]`), managed from
   the Job Agent and Job CEO pages.

**Gap:** `openjobdata_ingest.py` reads only its own hardcoded mirror. The DB custom
keyword groups are used by the UI paths, **not** by the nightly ingest. The
`keyword-groups` GET routes are gated behind `requireCurrentUser(MASTER_DATA_MANAGER_ROLES)`
— session auth a CI job cannot present.

So "use my keyword groups plus custom keywords" **cannot be satisfied by reusing what
exists**; it needs a machine-readable, token-authenticated way to read the effective
keyword set. That is Phase 1 below, and it benefits OpenJobData too.

### 2.8 Precedent to mirror

`.github/workflows/openjobdata-nightly-ingest.yml`: checkout pinned to
`neon-cloudflare-migration`, Python 3.12, `pip install -r scripts/requirements-openjobdata.txt`,
run the script, then drive `/api/job-ceo/dispatch` in a bounded loop with `CRON_SECRET`
until `needsDispatch=false` (50-min wall, abort after 5 consecutive failures).

Existing cron slots: `18:00` job-agent, `20:00` openjobdata nightly, `02:00`
openjobdata-ingest, `*/10` Job CEO dispatch.

---

## 3. Design

### 3.1 Shape

Three new Python modules under `scripts/`, sharing one core — mirroring how
`openjobdata_common.py` is shared today:

```
scripts/
  agency_sources_common.py     # keyword resolution, matching, JSON-LD, HTTP, POST
  actalent_ingest.py           # Actalent adapter
  broadstaff_ingest.py         # Broadstaff adapter
```

Each adapter implements one interface — `iter_listings()` and `fetch_detail(url)` —
so a third agency site later is a new adapter, not a new pipeline.

Python (not a Worker cron) for three reasons: it matches the existing ingest precedent
and its dispatch-loop tooling; Broadstaff's 7–17 s pages and Actalent's ~256-request
crawl both exceed comfortable Worker CPU/wall budgets; and it reuses the hardened
matcher that already exists in Python.

### 3.2 Keyword strategy — enumerate, then filter locally

Actalent's search relevance is demonstrably wrong (§1.1), so **we do not delegate
relevance to either site.** Both adapters enumerate the full inventory and apply *our*
matcher locally. This is the same posture `openjobdata_ingest.py` already takes against
the OpenJobData dataset.

- **Broadstaff:** 39 URLs from the sitemap. Enumerate all, filter locally. Trivial.
- **Actalent:** two enumeration modes, `--mode`:
  - `sitemap` *(default)* — walk `sitemap_index.xml`, take job URLs. Complete, cheap,
    and `lastmod` supports incremental runs.
  - `search` — iterate the keyword set through `search-results?keywords=…&from=…`.
    Retained because its JSON gives title/location/teaser/postedDate **without** a
    detail fetch, which makes it far cheaper for a titles-only pre-filter.

  Default plan: `search` mode for the daily incremental pass (cheap, keyword-scoped,
  ~20–80 hits per keyword), with `sitemap` mode as a weekly full-inventory
  reconciliation to catch anything the fuzzy search ranked out. Both feed the identical
  matcher, so the two modes cannot disagree about what qualifies.

**Matching reuses the hardened logic, it is not rewritten.** `openjobdata_common.py`
documents two real bugs found the hard way — short acronyms matching inside unrelated
words (`osp` in "ho**sp**ital", `gis` in "lo**gis**tics", `cad` in "a**cad**emic"), and
base64 blobs creating spurious word boundaries. The `_BOUNDED_ROOTS` word-boundary
regex and `looks_like_binary_blob()` must be imported and used, never re-implemented.
Re-copying that code without the fixes silently reintroduces both.

### 3.3 Effective keyword set

Resolved at runtime, in this order:

1. Static groups A–R.
2. DB custom groups from `job_agent_keyword_groups`.
3. `--keywords` CLI override for ad-hoc runs.

`--role-group` selects a subset, matching the existing script's ergonomics.

**Phase 1 delivers the read path** — a new token-authenticated endpoint,
`GET /api/job-ceo/effective-keywords`, authorised with the **existing**
`JOB_CEO_INGEST_SECRET` bearer (same fail-closed check as the ingest route), returning
the merged static + custom set. This removes the hand-maintained Python mirror as the
single source of truth and closes the §2.7 gap for OpenJobData at the same time.

Fallback: if the endpoint is unreachable, the adapter falls back to the static mirror
and **logs a loud warning**, so a keyword-service outage degrades coverage rather than
silently ingesting nothing — and is visible rather than silent.

### 3.4 Field mapping

Both adapters emit the same object to `/api/job-ceo/ingest`:

| Ingest field | Actalent | Broadstaff |
|---|---|---|
| `title` | JSON-LD `title` → search `title` | JSON-LD `title` |
| `company` | `hiringOrganization.name` → `"Actalent"` | `hiringOrganization.name` → `"Broadstaff"` |
| `location` | `jobLocation.address` → search `cityStateCountry` | `jobLocation.address` |
| `source_url` | canonical `/us/en/job/{reqId}/{slug}` | canonical `/jb/{slug}/{id}` |
| `external_job_id` | `reqId` (`JP-…`) | numeric id from URL |
| `snippet` | `descriptionTeaser` | first ~300 chars of description |
| `description_text` | JSON-LD `description`, unescaped + tags stripped | same |
| `raw.source` | `"actalent"` | `"broadstaff"` |
| `raw.posted_at` | `datePosted` / `postedDate` | `datePosted` |
| `raw.employment_type` | `employmentType` | `employmentType` |
| `raw.apply_url` | search `applyUrl` | detail apply link |
| `raw.valid_through` | — (not present) | `validThrough` |
| `raw.matched_keywords` | matcher output | matcher output |
| `raw.role_group` | matcher output | matcher output |

The company fallbacks are **source configuration**, not magic constants: each adapter
declares its operator once, and the value is only used if JSON-LD omits
`hiringOrganization`. Both sites are single-employer staffing boards, so this is a
property of the source, not a hardcoded guess about a job.

`description_text` is populated at ingest specifically to trigger the §2.5
short-circuit.

### 3.5 Dedup interaction — a genuine risk

Job CEO dedups on `lower(title)|lower(company)` **permanently**, across runs.

Because every Actalent job has company `"Actalent"`, two genuinely different
requisitions with the same title — e.g. the two distinct *"GIS Analyst"* rows both
observed live under `keywords=GIS` — collapse to one signature, and the second is
dropped forever. The same applies to Broadstaff's repeated *"OSP Field Inspector / OSP
Construction Coordinator"* postings, which differ only by region (`KY`, `Mississippi`,
`NE Alabama`, `SE Alabama`, `LaCenter WA`, `Quartzsite AZ`).

This is not hypothetical — both patterns are present in the data sampled today.

Options, to be decided before implementation (see §7):

- **(a)** Include location in the signature for these sources
  (`title|company|location`). Most faithful; needs care so it does not weaken dedup
  for existing sources.
- **(b)** Post `external_job_id` into the signature. Strongest — the requisition id is
  the true natural key — but diverges from the current scheme.
- **(c)** Accept the collapse. Cheapest, and **loses real jobs**. Recorded for
  completeness; not recommended.

Whichever is chosen must not alter dedup behaviour for OpenJobData or Apify.

### 3.6 Delisting

- **Actalent:** treat `410` as removed.
- **Broadstaff:** status is meaningless (§1.2); treat "no JSON-LD `JobPosting` block"
  as removed.

Both adapters will *report* delisted ids in their run summary. Deactivating
`jobs.is_active` is **out of scope** for this plan — no existing source does it, and
adding it here would change behaviour for the whole `jobs` table. It is listed in §7.

---

## 4. Robustness — "must not break silently"

The failure mode to design against is not a crash. It is a green CI run that quietly
ingests nothing because a selector moved. Each guard below maps to a real, observed
property of these two sites.

| # | Risk (all observed) | Guard |
|---|---|---|
| 1 | Broadstaff 404s `curl/*` UA | Explicit browser UA constant; a startup self-test asserts the sitemap returns 200 and **fails the run loudly** if not |
| 2 | Broadstaff 200s on missing jobs | Never trust status; require a parsed JSON-LD `JobPosting` |
| 3 | Phenom renames `eagerLoadRefineSearch` | Adapter tries the embedded key, then falls back to `sitemap` mode; if both yield zero it fails loudly |
| 4 | JSON-LD disappears | Structural assertion per detail page; a page missing `JobPosting` counts as an extraction failure, not an empty job |
| 5 | **Silent zero-yield** | Hard floor: if a source that has previously yielded jobs returns **0 matches**, exit non-zero. A quiet no-op is the failure we most want surfaced |
| 6 | Yield collapse | Warn when matched count falls below a configurable fraction of the trailing average |
| 7 | Broadstaff 7–17 s pages | Per-request timeout ≥ 45 s; bounded retries with exponential backoff + jitter |
| 8 | Transient 5xx / resets | Retry idempotent GETs (3 attempts, backoff); never retry the POST blindly |
| 9 | Partial run | Ingest in batches so a late failure keeps earlier batches; the run is resumable |
| 10 | Actalent fuzzy relevance | Local word-boundary matcher is authoritative; site ranking is never trusted |
| 11 | Acronym false positives | Reuse `_BOUNDED_ROOTS`; **never** substring-match short acronyms |
| 12 | Encoding | Actalent descriptions are double-escaped HTML — unescape then strip, and assert the result contains no residual `&lt;` |
| 13 | Overlapping runs | Concurrency group on the workflow, as the existing nightly does |
| 14 | GHA 6-hour cap | Bounded wall clock, same 50-min dispatch-loop pattern already proven |

**No hardcoded totals or offsets.** `totalHits` drives pagination; sitemap child count
is read from the index. Nothing assumes "11 sitemaps", "5,114 jobs" or "39 jobs" —
those are today's observations, recorded as expectations for the yield check, not as
control flow.

**Dry-run parity.** `--dry-run` exercises the full path including matching and payload
construction, and stops before the POST — same contract as the existing script.

---

## 5. Security and compliance

- **Only public, robots-permitted paths.** Actalent's `*/apply`, `*/jobcart`,
  `*/chatbot`, `*/px-widgets` are disallowed and will not be touched; we use
  `/search-results`, `/job/` and the published sitemaps. Broadstaff disallows nothing
  and publishes its sitemap.
- **No authentication, no login walls, no paywalls, no PII.** Job postings only.
- **Identify honestly.** A stable UA with contact info is preferable to impersonating
  Chrome. Broadstaff's filter blocks `curl/*` specifically, not non-browsers —
  `python-requests` passes — so a truthful custom UA should work and must be verified
  in Phase 2 before falling back to a browser UA string.
- **Rate limiting.** Serial requests with a configurable delay. Actalent tolerated six
  rapid requests, but the default should stay conservative; ~256 requests for a full
  Actalent crawl is a real load.
- **Secrets.** Reuse `JOB_CEO_INGEST_SECRET` and `CRON_SECRET` from GitHub Secrets.
  Nothing new committed. The new keyword endpoint reuses the existing bearer check.
- **SSRF.** URLs are derived from the two sitemaps and constructed from ids — never
  taken from arbitrary page input. `isSafeExternalUrl` still gates any deep fetch.
- **Injection into AI stages.** Scraped description text reaches the QA and matchmaker
  prompts. It is third-party content and must be treated as data, not instructions —
  worth an explicit note in the QA prompt, and a reason to cap description length.
- **Licensing.** These are the agencies' own public postings. We store title, company,
  location, description and a link back — the same footprint as existing sources.

---

## 6. Phases

Each phase is independently shippable and leaves the system working.

**Phase 1 — Keyword read path** *(unblocks the actual requirement)*
`GET /api/job-ceo/effective-keywords`, bearer-authorised with `JOB_CEO_INGEST_SECRET`,
returning merged static + `job_agent_keyword_groups` keywords. Benefits OpenJobData
too. Ship and verify standalone.

**Phase 2 — Shared core**
`agency_sources_common.py`: keyword resolution (endpoint + fallback), matcher imported
from `openjobdata_common.py`, JSON-LD extraction, HTTP client with UA/retry/backoff,
batched POST. Includes the Broadstaff UA self-test and the Phase-2 check on whether a
truthful custom UA is accepted.

**Phase 3 — Broadstaff adapter** *(smaller, all-relevant, best first proof)*
39 URLs, one code path, fastest end-to-end validation of the whole chain.

**Phase 4 — Actalent adapter**
Both `sitemap` and `search` modes, `from=` pagination driven by `totalHits`, 410
handling.

**Phase 5 — Dedup decision**
Implement the §3.5 choice. Must not regress OpenJobData/Apify dedup.

**Phase 6 — Workflow**
`.github/workflows/agency-sources-ingest.yml`, modelled on
`openjobdata-nightly-ingest.yml`: pinned checkout, Python 3.12, dry-run capable
`workflow_dispatch` inputs (`source`, `role_group`, `mode`, `days`, `dry_run`), then
the bounded `/api/job-ceo/dispatch` loop. Schedule off the busy slots — **21:00 UTC**
is free and sits after the 20:00 OpenJobData run.

**Phase 7 — Verification**
Dry run both sources; live run with a single narrow keyword group; confirm rows reach
`jobs` with correct `source`; confirm deep fetch short-circuits (no Jina calls, no
tokens); confirm dedup behaves as decided.

---

## 7. Open questions — decide before coding

1. **Dedup (§3.5).** Which option — (a) add location, (b) use `external_job_id`, or
   (c) accept collapse? This changes real captured volume and is the one decision I
   should not make unilaterally. Recommendation: **(b)**, since both sources expose a
   true requisition id, with (a) as the lower-risk alternative.
2. **Actalent scope.** US only (5,114), or also GB/CA/IN, which have their own
   sitemaps? Plan assumes **US only**.
3. **Daily mode.** Keyword `search` daily + weekly full `sitemap` reconciliation (this
   plan's default), or full sitemap daily (~256 requests)?
4. **Delisting (§3.6).** Report only (assumed), or also flip `jobs.is_active`?
5. **Non-US / remote-only filtering** — any location constraint at ingest, or leave it
   to the matchmaker?

---

## 8. Explicitly not verified

Stated so nothing here is mistaken for confirmed fact:

- Behaviour of Actalent's GB/CA/IN sitemaps — not fetched.
- Whether Actalent rate-limits at volumes above six rapid requests, or over a
  sustained ~256-request crawl. Only a short burst was tested.
- Whether a truthful custom User-Agent (rather than a browser string) is accepted by
  Broadstaff. Only `curl/*`, `python-requests`, Googlebot and Chrome were tested.
- Long-term stability of Phenom's `eagerLoadRefineSearch` key — an internal
  implementation detail that may change without notice. This is why `sitemap` mode
  exists as a fallback.
- Whether either site publishes a documented public API. None was found; none is
  assumed.

---

## 9. Implementation record — 2026-09-13

Everything below reflects what was actually built and verified live, including three
places where implementation surfaced something this document got wrong or where a
better design was found than the one originally proposed. Read this section as the
authority over §1–§8 wherever they disagree.

### 9.1 Resolved open questions (§7)

1. **Dedup — resolved as (b), external_job_id.** `computeJobDedupSignature()`
   (`src/server/repositories/jobCeoStagingRepository.ts`) is now the single function
   both the ingest route's cross-run gate and `insertStaged`'s stored column call —
   they previously each reimplemented `title|company` independently, which is a real
   bug in its own right: `jobCeoService.ts`'s QA-drop path and
   `jobCeoRunRepository.ts`'s `deleteRun` both read the *stored* signature back and
   delete it from `job_ceo_seen_signatures` by that exact string, so if the two
   computations ever disagreed, that release would silently delete nothing and the
   job would be blacklisted forever. It prefers `id:{source}:{external_job_id}` when
   an id is present, namespaced by `raw.source` so two sources' id spaces can never
   collide, and falls back to `title|company` — byte-identical to today's behavior —
   for anything without one. Verified live: a real "all"-group Actalent pre-filter
   run surfaced 5 genuinely distinct requisitions (`JP-006265680`, `JP-006255081`,
   `JP-006282189`, `JP-006282204`, `JP-006282184`) sharing only two titles between
   them (*Telecommunications Designer* ×3, *Telecommunications Project Manager* ×2) —
   exactly the collision this fix exists for, confirmed with real data rather than a
   hypothetical. 13 unit/integration tests cover this
   (`src/test/repositories/jobCeoDedupSignature.test.ts`,
   `src/test/api/jobCeoIngest.dedup.test.ts`).

2. **Actalent scope — US only, confirmed.** Both adapters check
   `jobLocation.address.addressCountry` from JSON-LD and reject anything not
   confirmed US. Confirmed live that the two sites spell it differently — Actalent
   uses `"USA"`, Broadstaff uses `"US"` — both are accepted; anything else, or a
   missing value, is excluded. This directly satisfies the "USA locations only" MVP
   requirement, enforced per-job from real structured data, not inferred from which
   site or URL a job came from.

3. **Daily crawl mode — changed from the original recommendation, for the better.**
   §3.2 proposed "search mode daily + weekly sitemap reconciliation" as the default,
   to keep the daily Actalent crawl cheap. Implementation found a better option:
   every sitemap-listed job URL's slug is a faithful, hyphens-for-spaces rendering of
   its real title (confirmed live against 4 real postings — one lost a `/` to a
   space; word content was identical in all four). That makes it possible to run the
   local keyword matcher against the slug *before* fetching anything, turning
   "fetch all 3,822 listed jobs" into "fetch only the ones that already look
   relevant" — 422 candidates for the full "all"-group set, confirmed live. This is
   strictly better than the original proposal: complete, authoritative coverage
   (the full sitemap, not reliance on Actalent's confirmed-fuzzy search ranking)
   at a cost cheaper than what the search-mode default would have needed for
   equivalent recall, and no separate weekly reconciliation job is needed since every
   run already covers the complete inventory. `sitemap` mode is therefore the
   default in `actalent_ingest.py`; `search` mode is retained as an explicit,
   non-default `--mode search` option for a fast, narrow, human-driven lookup.

4. **Delisting — report only, as recommended.** No `jobs.is_active` flip.

5. **Non-US filtering — see #2. Remote-only filtering was not added** — a posting
   with a real US office address but described as remote-eligible (observed live on
   a real Broadstaff posting) still carries a real US address in
   `jobLocation.address`, so it passes the country check correctly; no separate
   remote-detection logic was needed or added.

### 9.2 Where the research plan itself was wrong

- **§3.2 attributed the reusable matcher to the wrong module.** It named
  `openjobdata_common.py` as the shared matcher to import. That module is real, but
  it's the dataset-reader used by `openjobdata_export.py`/`EEE_job_search.py`
  against the raw HuggingFace parquet dataset, handling problems specific to that
  dataset (base64 blobs misfiled under text-like keys, ambiguous description field
  names). `openjobdata_ingest.py` — the script this plan is actually extending —
  has never imported it; it has always carried its own separate, self-contained
  `ROLE_GROUPS`/`matches_role`/`build_group_matcher`. That is the code both new
  adapters import (`from openjobdata_ingest import ROLE_GROUPS, matches_role`, with a
  `sys.path` fixup since these are flat scripts, not a package). Confirmed safe to
  import standalone: `openjobdata_ingest.py`'s only top-level imports are stdlib +
  `requests`; `pandas`/`huggingface_hub` are imported lazily inside the functions
  that need them, so importing the module doesn't require those packages and has no
  side effects. `openjobdata_ingest.py` itself is unmodified.
- **§4 item 13 claimed `openjobdata-nightly-ingest.yml` uses a concurrency group.**
  Checked directly: it does not. Only `job-agent-nightly.yml` does. The new
  `agency-sources-ingest.yml` workflow has one anyway (good practice, prevents an
  overrun run overlapping the next day's trigger) — but it does not "mirror"
  something the OpenJobData workflow actually has.

### 9.3 Resolved from §8 ("explicitly not verified")

- **Truthful User-Agent on Broadstaff — confirmed accepted.** Three self-identifying
  strings, including the one now shipped
  (`TalentOS-JobIngest/1.0 (+https://talent.skarion.com)`), all returned 200 against
  the sitemap. Broadstaff's block is specifically the `curl/*` UA family, not
  non-browser clients generally. Both adapters use this UA against both sites (also
  confirmed 200 on Actalent, which was never UA-sensitive to begin with).

### 9.4 What was built

| File | Purpose |
|---|---|
| `src/app/api/job-ceo/effective-keywords/route.ts` | New. Bearer-authed (same `JOB_CEO_INGEST_SECRET` as ingest) read of static role groups + DB custom keyword groups — the machine-readable path that didn't exist before (§2.7's gap). Degrades to static-only with a surfaced error if the DB is unreachable; never hard-fails. |
| `src/server/repositories/jobCeoStagingRepository.ts` | Added `computeJobDedupSignature()`, used by both `insertStaged` and the ingest route. |
| `src/app/api/job-ceo/ingest/route.ts` | Uses the shared signature function instead of its own inline `title|company` computation. |
| `scripts/agency_sources_common.py` | New. Shared HTTP client (retry/backoff, truthful UA, startup self-test), JSON-LD extraction, US-country check, keyword resolution (imports `openjobdata_ingest.py` + calls the new endpoint), and the batched-POST-to-Job-CEO function (byte-identical batching/retry contract to `openjobdata_ingest.py`'s). |
| `scripts/broadstaff_ingest.py` | New adapter. Enumerates the full ~39-job sitemap every run. |
| `scripts/actalent_ingest.py` | New adapter. `sitemap` mode (default) walks the full sitemap index with the slug pre-filter described in 9.1.3; `search` mode is the narrower, non-default alternative. |
| `scripts/requirements-agency-sources.txt` | New, minimal (`requests` only) — these scripts need none of `openjobdata_ingest.py`'s heavier deps. |
| `.github/workflows/agency-sources-ingest.yml` | New. Daily at 21:00 UTC (one hour after the 20:00 UTC OpenJobData run), `workflow_dispatch` inputs for source/role_group/mode/dry_run, then the same bounded `/api/job-ceo/dispatch` drive-to-completion loop `openjobdata-nightly-ingest.yml` uses. Reuses the existing `JOB_CEO_INGEST_SECRET`/`CRON_SECRET`/`TALENTOS_BASE_URL` secrets and vars — nothing new to configure in GitHub. |
| `src/test/repositories/jobCeoDedupSignature.test.ts`, `src/test/api/jobCeoIngest.dedup.test.ts`, `src/test/api/jobCeoEffectiveKeywords.test.ts` | New. 24 tests total for the two TS changes above. |

Full test suite: 515 passed, 6 skipped, 0 failed. `tsc --noEmit`: clean.

Both adapters were dry-run against the live sites during implementation (not just
unit-tested): Broadstaff matched 27 of 39 real postings; Actalent's sitemap prefilter
found 422 real candidates out of 3,822 sitemap-listed jobs for the full "all"-group
set, and a handful of role-group-A candidates were fetched, parsed, and confirmed to
produce valid, JSON-serializable ingest payloads with real titles, locations,
descriptions, and requisition ids.

### 9.5 What is NOT yet done

- **Not committed or pushed.** All files above exist locally only as of this writing.
- **The new `/api/job-ceo/effective-keywords` endpoint has not been deployed** — every
  live dry-run above hit it and correctly fell back to static-only matching with a
  logged warning (proving the fallback path works), but custom keyword groups will
  not actually be picked up until this ships to production.
- **No end-to-end run has been done against a real (non-dry-run) TalentOS instance** —
  everything above was `--dry-run`; no job has actually reached the `job_ceo_staging`
  table or the `jobs` table yet.
- **§7 question 3's "which is safer, a role-group-A-only first run or straight to
  'all'" was not decided** — recommend running the workflow's first live invocation
  with `role_group=A` (or another single, well-understood group) before the first
  `all`-group run, to see one narrow, verifiable batch of real jobs land in Job CEO's
  review queue before trusting the full daily volume unattended.

### 9.6 "Does this re-scrape the same jobs every day?" — added 2026-09-13

The user asked directly whether the daily run fetches genuinely new postings or
re-processes ones already captured. The honest answer required distinguishing two
different things this could mean, and one of them was a real, fixable inefficiency:

**Did already-captured jobs get re-staged, re-QA'd, or duplicated in the `jobs`
table?** No — the §9.1.1 dedup fix already prevents this. Neither site publishes a
"what's new since date X" feed, so both scripts always re-derive the *complete
current listing* on every run (Broadstaff's full ~39-job sitemap; Actalent's full
sitemap walk). A job already recorded under a prior run's signature is rejected by
`job-ceo/ingest`'s permanent dedup regardless of how many times it's POSTed again —
this was true before today's change too.

**Did the scripts re-*fetch* (an HTTP request to the target site) a job's detail page
every day even when nothing about it could possibly be new?** Yes, and this was a
real gap, now closed. Before today, every currently-listed, keyword-matching job's
detail page was fetched fresh every single run, even for postings identical to
yesterday's — wasted time, wasted requests against someone else's server, for a
result (rejected as a duplicate) that was already predictable before the request was
made.

**Fix:** a new endpoint, `GET /api/job-ceo/seen-external-ids?source={name}`
(`src/app/api/job-ceo/seen-external-ids/route.ts`), returns every external_job_id
already recorded for a given source — a `LIKE 'id:{source}:%'` scan against
`job_ceo_seen_signatures`'s primary key, satisfied from that column's own b-tree
index. Both adapters call it once per run (`fetch_seen_external_ids` in
`agency_sources_common.py`) and skip a candidate's detail-page fetch entirely when
its id is already known — for Actalent this happens before the title pre-filter even
runs, for Broadstaff before any request is made at all. Same fallback discipline as
`effective-keywords`: unreachable means every candidate gets (re-)fetched, exactly
today's prior behavior, never a hard failure. The §4 zero-yield hard floor was also
corrected alongside this: it used to treat "found 0 matches" as suspicious whenever
the listing was nonzero; now it only does so when there were actually not-already-seen
candidates to examine, since "everything today was already seen yesterday" is the
*expected*, correct outcome once a source's backlog is caught up, not a sign
extraction broke.

Confirmed live: a controlled test against real Broadstaff job ids (two real ids
marked as pre-"seen", the rest not) correctly excluded exactly those two and no
others from the fetch list.

### 9.7 Source naming — corrected 2026-09-13

The `raw.source` value (and therefore `jobs.source`) is now named after each site's
own domain rather than the staffing agency's brand name: `actalentservices` (from
careers.**actalentservices**.com) and `broadstaffglobal` (from jobs.**broadstaffglobal**.com).
`company` is unaffected and still correctly holds the real employer name shown to
candidates ("Actalent" / "Broadstaff") — these are two different fields answering two
different questions (which site did this come from vs. who is the employer), and only
the first one changed. Updated: `SOURCE_NAME` in both adapters, all dedup-signature
test fixtures and their expected `id:{source}:...` strings, and this document's own
field-mapping table in §3.4 and §9.1.1's requisition-id examples above use the new
names in prose (the DB values in the literal signature strings — `id:actalentservices:...`
— reflect the new naming as of this section; §3.4's table above was written before this
rename and still shows the original `"actalent"`/`"broadstaff"` literals for the historical
record of what was originally proposed).

### 9.8 Description quality — two real bugs found and fixed, 2026-09-13

The user reported that descriptions on some logged jobs, checked after a local test run,
weren't fully/correctly captured. Investigation against real live pages found two
independent, confirmed bugs — one structural (content present but unreadable), one
character-level (content actually corrupted) — plus one source where richer content was
available and wasn't being used.

**Bug 1 — structure lost, Actalent.** `clean_ld_description`'s original implementation
converted every HTML tag to a single space before stripping it. Actalent's JSON-LD
`description` field retains real markup (`<p>`, `<ul>`, `<li>`, `<strong>`, just
double-escaped) — converting `<li>Item one</li><li>Item two</li>` to a single space per
tag produced "Item one Item two" with no indication these were ever two separate list
items, and a whole posting's paragraphs/headings/six-item lists collapsed into one
run-on sentence. Confirmed live on a real posting: "Responsibilities" followed
immediately by six requirements and then "Essential Skills" with zero separation
anywhere.

A second, sharper case of the same class of bug: the source uses **unclosed `<p>` tags**
as section separators (valid loose HTML5 — a new `<p>` implicitly closes the previous one
in a real browser DOM parser) with no matching `</p>` at all. A naive "convert `</p>` to a
break" rule never fires without a closing tag to match, so the very first line of every
description read as `"Job Title: GIS AnalystJob DescriptionJoin our team..."` — three
distinct pieces of content fused together with literally zero characters between them.

**Fix:** `html_to_text()` (renamed from, and now the real logic behind,
`clean_ld_description`) converts BOTH the open and close of block-level tags
(`p`, `div`, `h1`-`h6`, `tr`, `blockquote`) to a newline — so an unclosed `<p>` still
produces a break from its own opening tag, with no dependency on a closing tag ever
appearing. `<li>` additionally gets a leading `"- "` bullet on open. Verified against
the real posting above: the output now reads as normal, fully separated paragraphs and
properly bulleted lists, end to end — sections a prior look at this description hadn't
even reached (Work Environment, Pay and Benefits, the full EEO/compliance boilerplate)
are now visibly present and correctly formatted.

**Bug 2 — content actually corrupted, Broadstaff.** This is the sharper of the two: not
a readability problem, an actual data-corruption bug, and it explains "unnecessary info
text" literally, not just structurally. Broadstaff's server sends
`Content-Type: text/html` with **no charset parameter**. Per RFC 2616, when a server
doesn't declare a charset, `requests` defaults `resp.encoding` to `ISO-8859-1` for any
`text/*` response — but the real page content is genuine UTF-8 (confirmed directly from
the raw response bytes: a curly apostrophe is the correct 3-byte UTF-8 sequence
`e2 80 99`). Decoding those 3 real UTF-8 bytes one at a time as Latin-1 turns ONE
apostrophe into THREE garbage characters. A real posting's "the company's history"
was actually being captured, byte-for-byte, as `"the company\xe2\x80\x99s history"` —
not a display artifact, confirmed by inspecting the Python string's actual Unicode
codepoints (`0xe2`, `0x80`, `0x99` — three separate codepoints — instead of the single
correct `0x2019`). Any curly quote, em/en dash, or accented character anywhere in any
Broadstaff description was affected the same way; typographically-styled text is common
in professionally-written job ads, so this was not a rare edge case.

**Fix:** `_fix_response_encoding()`, applied inside the shared `http_get()` so both
adapters get it automatically and no other page-fetching code path can bypass it. It
overrides `resp.encoding` to `resp.apparent_encoding` (`requests`' own independent,
content-based encoding detection via chardet) **only** when the response's `Content-Type`
header has no explicit `charset=` parameter — a server that DOES declare a real charset is
always trusted over a heuristic guess and left untouched. Confirmed live: Actalent
explicitly declares `charset=UTF-8` and was never affected by this bug at all (the guard
correctly leaves it alone); Broadstaff declares no charset and was corrupting every
non-ASCII character before this fix, confirmed clean after it (re-fetched the same real
posting: `resp.encoding` now reports `utf-8`, and "company's history" decodes to the
single correct codepoint `0x2019`). This is `requests`' own documented gotcha for exactly
this situation, not something specific to how these two sites were being handled.

**Bonus finding while investigating Bug 1 — Broadstaff has a richer source available.**
Broadstaff's JSON-LD `description` field is not just tag-free, it's *incomplete*: the
site separately server-renders the full description into a
`<div class="hmg-jb-v4-prose">` container elsewhere on the same page (a Haley Marketing
job-board template convention, confirmed present and consistently named across multiple
real postings), and that div's content is measurably longer than the JSON-LD field for
the same job — confirmed live, twice: 230 and 270 characters longer, respectively, for
two different real postings, once both were converted to comparable plain text. Added
`extract_div_by_class()` (a generic, depth-aware `<div>` finder — tracks nested
`<div>`/`</div>` pairs so it returns the container's true content rather than truncating
at the first nested div's close) to `agency_sources_common.py`, and a
Broadstaff-specific `extract_description()` in `broadstaff_ingest.py` that tries the
prose div first and falls back to the flattened JSON-LD field only if the div isn't
found on a given page (template change, A/B test, etc. — never a hard assumption that
either source exists).

**Scope of the fix:** all three changes live entirely inside
`scripts/agency_sources_common.py` and `scripts/broadstaff_ingest.py`. No TypeScript
file, API route, or database schema was touched — confirmed via `git status` (Python-only
diff) and a full test-suite run (522 passed, unchanged) after these changes.
