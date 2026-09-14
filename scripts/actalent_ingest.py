#!/usr/bin/env python3
"""Actalent (careers.actalentservices.com, US) daily ingest for the TalentOS Job CEO pipeline.

Enumeration strategy — "sitemap prefilter" (the default, --mode sitemap):

  1. Walk sitemap_index.xml -> ~11 child sitemaps -> ~5,114 US job URLs
     (confirmed live 2026-09-13). This is the complete, authoritative
     inventory — it does not depend on Actalent's own search ranking at all.
  2. Each job URL's slug is a faithful, hyphens-for-spaces rendering of the
     real title — confirmed live against 4 real postings (one lost a "/"
     to a space; word content was identical in all four). Filtering the
     slug-derived title through the SAME local keyword matcher used
     everywhere else in this pipeline turns "fetch all 5,114 pages" into
     "fetch only the few hundred whose title looks relevant" — a
     mechanical filter over the complete list, not a guess at which search
     term is "good enough".
  3. Only candidate URLs get their detail page fetched, for the real title,
     full description, and structured location/country/salary data.

Why not rely on Actalent's own keyword search instead: it is fuzzy across
the whole document, not title-scoped — confirmed live, `keywords=fiber`
surfaced "Hardware Test Engineer" and "Relay Technician",
`keywords="OSP Design"` surfaced "Field Technician". Trusting its ranking
would mean silently missing relevant postings it ranks below its fixed
20-per-page window, or including irrelevant ones it ranks high. --mode
search is kept available for a fast, narrow, human-driven lookup (it needs
far fewer requests for a single keyword), but is not the daily default for
that reason.

A nonexistent/removed requisition returns HTTP 410 (confirmed live) — this
is the sole delisting signal used here.

Environment variables:
  INGEST_SECRET  - JOB_CEO_INGEST_SECRET bearer token (required unless --dry-run)
  BASE_URL       - TalentOS base URL (default: production worker URL)

CLI arguments:
  --mode         - 'sitemap' (default, complete/authoritative) or 'search'
                    (fast, narrow, keyword-scoped; for manual/ad-hoc use).
  --role-group   - A single role group id (A-R) or 'all' (default: all).
                    Not comma-separated — see broadstaff_ingest.py's docstring
                    for why (matches_role()'s own constraint).
  --dry-run      - Enumerate, fetch, filter and build payloads, but do not POST.
  --limit        - Cap the number of DETAIL PAGES fetched after prefiltering
                    (debugging only — the prefilter pass itself always covers
                    every listed job; --limit only trims how many of the
                    already-identified candidates get fully fetched).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agency_sources_common import (  # noqa: E402
    FetchError,
    assert_reachable,
    clean_ld_description,
    extract_country_from_jobposting,
    extract_json_ld_jobposting,
    fetch_effective_keywords,
    fetch_seen_external_ids,
    get_role_group_ids,
    http_get,
    is_us_country,
    job_title_matches,
    looks_like_login_wall,
    post_jobs_in_batches,
    resolve_base_url,
)
from openjobdata_ingest import ROLE_GROUPS, matches_role  # noqa: E402

# The value stored in raw.source (and therefore, downstream, jobs.source) —
# named after the site's own domain (actalentservices.com), not the
# employer name "Actalent" it staffs for, which is a separate field
# (company).
SOURCE_NAME = "actalentservices"
SITE_ROOT = "https://careers.actalentservices.com/us/en"
SITEMAP_INDEX_URL = f"{SITE_ROOT}/sitemap_index.xml"
SEARCH_URL = f"{SITE_ROOT}/search-results"

_SITEMAP_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
# /us/en/job/{JP-xxxxxxxxx}/{Title-Slug} — the requisition id (JP-...) is the
# stable natural key; the slug is human-readable and used only for the
# cheap pre-filter below, never trusted as the stored title.
_JOB_URL_RE = re.compile(r"(https://careers\.actalentservices\.com/us/en/job/(JP-\d+)/([^/\"<]+))")


def enumerate_sitemap_job_urls() -> List[Tuple[str, str, str]]:
    """Returns (full_url, req_id, slug) for every job URL across every child sitemap."""
    index_resp = http_get(SITEMAP_INDEX_URL)
    child_sitemaps = _SITEMAP_LOC_RE.findall(index_resp.text)
    if not child_sitemaps:
        raise FetchError(f"sitemap index at {SITEMAP_INDEX_URL} listed zero child sitemaps")

    seen_ids = set()
    results: List[Tuple[str, str, str]] = []
    for sitemap_url in child_sitemaps:
        resp = http_get(sitemap_url)
        for full_url, req_id, slug in _JOB_URL_RE.findall(resp.text):
            if req_id in seen_ids:
                continue
            seen_ids.add(req_id)
            results.append((full_url, req_id, slug))
    return results


def slug_to_title(slug: str) -> str:
    return slug.replace("-", " ")


def build_location(job_posting: Dict[str, Any]) -> str:
    location = job_posting.get("jobLocation")
    address = location.get("address") if isinstance(location, dict) else None
    if not isinstance(address, dict):
        return "United States"
    locality = str(address.get("addressLocality") or "").strip()
    region = str(address.get("addressRegion") or "").strip()
    parts = [p for p in (locality, region) if p]
    return ", ".join(parts) + ", USA" if parts else "United States"


def extract_salary(job_posting: Dict[str, Any]) -> Dict[str, Any]:
    salary = job_posting.get("baseSalary")
    if not isinstance(salary, dict):
        return {}
    value = salary.get("value")
    if not isinstance(value, dict):
        return {}
    out: Dict[str, Any] = {}
    if value.get("minValue") is not None:
        out["salary_min"] = value.get("minValue")
    if value.get("maxValue") is not None:
        out["salary_max"] = value.get("maxValue")
    currency = salary.get("currency")
    unit = value.get("unitText")
    if out.get("salary_min") or out.get("salary_max"):
        range_bits = [str(v) for v in (out.get("salary_min"), out.get("salary_max")) if v is not None]
        range_str = "-".join(range_bits)
        out["salary_range"] = f"{currency or ''} {range_str}{f'/{unit}' if unit else ''}".strip()
    return out


def matched_role_groups(title: str) -> List[str]:
    return [gid for gid in ROLE_GROUPS if matches_role(title, gid)]


def build_payload(source_url: str, req_id: str, job_posting: Dict[str, Any], matched_custom: List[str]) -> Optional[Dict[str, Any]]:
    title = str(job_posting.get("title") or "").strip()
    if not title:
        return None

    try:
        description_text = clean_ld_description(job_posting.get("description"))
    except ValueError as exc:
        print(f"  [skip] {req_id} \"{title}\": {exc}")
        return None

    if description_text and looks_like_login_wall(description_text):
        print(f"  [skip] {req_id} \"{title}\": description looks like a login/paywall page")
        return None

    hiring_org = job_posting.get("hiringOrganization") or {}
    employment_type = job_posting.get("employmentType")
    if isinstance(employment_type, list):
        employment_type = employment_type[0] if employment_type else None

    raw: Dict[str, Any] = {
        "source": SOURCE_NAME,
        "posted_at": job_posting.get("datePosted"),
        "employment_type": employment_type,
        # hiringOrganization.url on Actalent points back at the job page
        # itself, not a real company site (confirmed live) — omitted rather
        # than propagated as a wrong "company_website".
        "occupational_category": job_posting.get("occupationalCategory"),
        "work_hours": job_posting.get("workHours"),
        "matched_role_groups": matched_role_groups(title),
        "matched_custom_keywords": matched_custom,
    }
    raw.update(extract_salary(job_posting))

    return {
        "title": title,
        "company": hiring_org.get("name") or "Actalent",
        "location": build_location(job_posting),
        "source_url": source_url,
        "external_job_id": req_id,
        "snippet": description_text[:300] if description_text else None,
        "description_text": description_text or None,
        "raw": raw,
    }


def fetch_candidate(url: str, req_id: str, matched_custom: List[str]) -> Optional[Dict[str, Any]]:
    try:
        resp = http_get(url, allow_statuses={410})
    except FetchError as exc:
        print(f"  [error] {req_id}: {exc}")
        return None

    if resp.status_code == 410:
        return {"__delisted__": True}

    job_posting = extract_json_ld_jobposting(resp.text)
    if not job_posting:
        print(f"  [warn] {req_id}: 200 response but no JobPosting JSON-LD found — treating as extraction failure")
        return None

    country = extract_country_from_jobposting(job_posting)
    if not is_us_country(country):
        return {"__non_us__": True}

    return build_payload(url, req_id, job_posting, matched_custom)


def run_sitemap_mode(role_group: str, base_url: str, ingest_secret: str, limit: int) -> List[Dict[str, Any]]:
    print("[PHASE 1] Walking sitemap index...")
    all_urls = enumerate_sitemap_job_urls()
    print(f"[PHASE 1] Sitemap lists {len(all_urls)} job(s) across all child sitemaps.")

    keywords = fetch_effective_keywords(base_url, ingest_secret or "unused-in-dry-run", role_group)
    # See fetch_seen_external_ids's docstring: skip the detail fetch entirely
    # for a requisition id already recorded from a prior run — it would only
    # be rejected as a duplicate at ingest anyway. This is what keeps a daily
    # re-walk of the same sitemap from meaning "re-fetch the same jobs every
    # day": across the full "all"-group set only genuinely new ids get
    # fetched, everything else is skipped before any network request.
    seen_ids = fetch_seen_external_ids(base_url, ingest_secret or "unused-in-dry-run", SOURCE_NAME)

    print("[PHASE 2] Pre-filtering by slug-derived title (no fetch yet)...")
    candidates: List[Tuple[str, str, List[str]]] = []
    skipped_already_seen = 0
    for full_url, req_id, slug in all_urls:
        if req_id.lower() in seen_ids:
            skipped_already_seen += 1
            continue
        title_guess = slug_to_title(slug)
        title_guess_lower = title_guess.lower()
        matched_custom = [kw for kw in keywords.custom_keywords if kw in title_guess_lower]
        if job_title_matches(title_guess, keywords):
            candidates.append((full_url, req_id, matched_custom))
    print(f"[PHASE 2] {len(candidates)} candidate(s) passed the title pre-filter out of "
          f"{len(all_urls)} ({skipped_already_seen} already known, skipped without a title check).")

    if limit:
        candidates = candidates[:limit]
        print(f"[PHASE 2] --limit applied: fetching {len(candidates)} candidate detail page(s).")

    jobs: List[Dict[str, Any]] = []
    delisted = 0
    non_us = 0
    extraction_failures = 0
    print(f"[PHASE 3] Fetching {len(candidates)} candidate detail page(s)...")
    for full_url, req_id, matched_custom in candidates:
        result = fetch_candidate(full_url, req_id, matched_custom)
        if result is None:
            extraction_failures += 1
        elif result.get("__delisted__"):
            delisted += 1
        elif result.get("__non_us__"):
            non_us += 1
        else:
            jobs.append(result)

    print(
        f"[PHASE 3] Done. matched={len(jobs)}, skipped_already_seen={skipped_already_seen}, "
        f"delisted_410={delisted}, skipped_non_us={non_us}, extraction_failures={extraction_failures}"
    )

    # Hard floor — same reasoning as broadstaff_ingest.py's: this detects a
    # BROKEN PARSE, never a legitimate "nothing new is relevant today".
    #
    # The real broken-parse signal here is the sitemap walk yielding zero job
    # URLs: _JOB_URL_RE not matching means the site's URL pattern changed and
    # every downstream stage is working from nothing. That is checked directly
    # and unconditionally, independent of role group or how many were already
    # seen.
    #
    # Deliberately NOT checked: "candidates == 0 after the title pre-filter".
    # Actalent lists thousands of jobs across every discipline it staffs for
    # (labs, clinical, manufacturing, finance), so the overwhelming majority
    # legitimately don't match these role groups — a day where none of the
    # newly-posted ones do is entirely ordinary, and failing the run for it
    # would be a false alarm, exactly the bug this replaced in the Broadstaff
    # adapter.
    if len(all_urls) == 0:
        print(f"::error::[actalent] The sitemap walk produced zero job URLs from {SITEMAP_INDEX_URL}. "
              "The site's job-URL pattern has almost certainly changed, so nothing downstream can work. "
              "Failing loudly per design.")
        sys.exit(1)

    return jobs


def run_search_mode(role_group: str, base_url: str, ingest_secret: str, limit: int) -> List[Dict[str, Any]]:
    """
    Fast, narrow, keyword-scoped lookup — NOT the daily default (see module
    docstring for why Actalent's own search ranking cannot be trusted for
    complete/precise coverage). Intended for a human running a quick,
    specific check, e.g. `--mode search --role-group A`.
    """
    keywords = fetch_effective_keywords(base_url, ingest_secret or "unused-in-dry-run", role_group)
    group_ids = [role_group] if role_group != "all" else get_role_group_ids()

    search_terms: List[str] = []
    for gid in group_ids:
        group = ROLE_GROUPS.get(gid, {})
        search_terms.extend(group.get("bounded", []))
    search_terms.extend(keywords.custom_keywords)
    search_terms = list(dict.fromkeys(search_terms))  # de-dupe, preserve order

    if not search_terms:
        print(f"::error::[actalent] --mode search has no search terms for role_group={role_group}")
        sys.exit(1)

    # Two different "already have this" sets, not to be confused: this one is
    # cross-run (jobs staged from a PRIOR invocation, whether that was search
    # or sitemap mode — the signature namespace is the same regardless of
    # which mode found it), fetched once up front. visited_ids_this_run below
    # is purely in-run, since overlapping search terms can surface the same
    # requisition more than once in a single invocation.
    already_recorded_ids = fetch_seen_external_ids(base_url, ingest_secret or "unused-in-dry-run", SOURCE_NAME)

    print(f"[search mode] Querying {len(search_terms)} term(s): {search_terms}")
    visited_ids_this_run: set = set()
    skipped_already_seen = 0
    jobs: List[Dict[str, Any]] = []
    for term in search_terms:
        from_offset = 0
        while True:
            url = f"{SEARCH_URL}?keywords={requests_quote(term)}&from={from_offset}"
            resp = http_get(url)
            payload = _extract_search_json(resp.text)
            if not payload:
                break
            hits = payload.get("data", {}).get("jobs", [])
            if not hits:
                break
            for hit in hits:
                req_id = hit.get("reqId") or hit.get("jobId")
                if not req_id or req_id in visited_ids_this_run:
                    continue
                visited_ids_this_run.add(req_id)
                if req_id.lower() in already_recorded_ids:
                    skipped_already_seen += 1
                    continue
                title = hit.get("title") or ""
                if not job_title_matches(title, keywords):
                    continue
                slug_from_title = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-")
                detail_url = f"{SITE_ROOT}/job/{req_id}/{slug_from_title}"
                result = fetch_candidate(detail_url, req_id, [])
                if result and not result.get("__delisted__") and not result.get("__non_us__"):
                    jobs.append(result)
                if limit and len(jobs) >= limit:
                    print(f"[search mode] Done (limit reached). matched={len(jobs)}, skipped_already_seen={skipped_already_seen}")
                    return jobs
            from_offset += len(hits)
            if from_offset >= payload.get("totalHits", 0):
                break
    print(f"[search mode] Done. matched={len(jobs)}, skipped_already_seen={skipped_already_seen}")
    return jobs


def requests_quote(value: str) -> str:
    import urllib.parse

    return urllib.parse.quote(value)


_EAGER_KEY = '"eagerLoadRefineSearch"'


def _extract_search_json(html: str) -> Optional[Dict[str, Any]]:
    import json

    idx = html.find(_EAGER_KEY)
    if idx < 0:
        return None
    start = html.index("{", idx + len(_EAGER_KEY) + 1)
    depth = 0
    for i in range(start, len(html)):
        if html[i] == "{":
            depth += 1
        elif html[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--mode", default="sitemap", choices=["sitemap", "search"])
    parser.add_argument("--role-group", default=None, choices=[*get_role_group_ids(), "all"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    role_group = args.role_group or os.environ.get("ROLE_GROUP", "all")
    dry_run = args.dry_run or os.environ.get("DRY_RUN", "").lower() == "true"
    ingest_secret = os.environ.get("INGEST_SECRET", "")
    base_url = resolve_base_url()

    if not dry_run and not ingest_secret:
        print("ERROR: INGEST_SECRET is required unless --dry-run is set.")
        sys.exit(1)

    print(f"Actalent ingest — mode={args.mode}, role_group={role_group}, dry_run={dry_run}, base_url={base_url}")

    try:
        assert_reachable(SITEMAP_INDEX_URL if args.mode == "sitemap" else SEARCH_URL, label="Actalent")
    except FetchError as exc:
        print(f"::error::[actalent] startup self-test failed — {exc}")
        sys.exit(1)

    if args.mode == "sitemap":
        jobs = run_sitemap_mode(role_group, base_url, ingest_secret, args.limit)
    else:
        jobs = run_search_mode(role_group, base_url, ingest_secret, args.limit)

    if not jobs:
        print("No jobs to ingest.")
        sys.exit(0)

    result = post_jobs_in_batches(jobs, base_url=base_url, ingest_secret=ingest_secret, dry_run=dry_run)
    if result.get("dry_run"):
        sys.exit(0)

    print(f"\n[DONE] staged={result['staged']}, skipped_dup={result['skipped']}")
    if result["failed_batches"]:
        print(f"::error::[actalent] {len(result['failed_batches'])} batch(es) permanently failed: {result['failed_batches']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
