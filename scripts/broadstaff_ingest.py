#!/usr/bin/env python3
"""Broadstaff (jobs.broadstaffglobal.com) daily ingest for the TalentOS Job CEO pipeline.

Broadstaff is a small (39 US postings as of 2026-09-13), almost entirely
OSP/fiber/telecom staffing board (Haley Marketing platform). Its sitemap is
the complete, authoritative job list — small enough that keyword filtering
happens locally on the full set rather than through any site-side search.

Two confirmed site behaviors this script is built around — see
agency_sources_common.py's module docstring and
docs/AGENCY_JOB_SOURCES_ACTALENT_BROADSTAFF_PLAN_2026-09-13.md for the full
verification:

1. A nonexistent/removed job id returns HTTP 200 with a "not found" page, not
   404. Status code is therefore never trusted here — presence of a JSON-LD
   JobPosting block is the only valid "this job exists" test.
2. The site's URL slug is decorative — /jb/{any-slug}/{id} and
   /jb/{correct-slug}/{id} return byte-identical pages. Only the numeric id
   is canonical, so it is what gets used as external_job_id and what the
   canonical source_url is rebuilt from (never trust a slug found elsewhere
   to still be accurate).
3. JobPosting.description in the JSON-LD is already flattened to plain text
   with no paragraph/list structure AND is less complete than the same
   content rendered elsewhere on the page in a
   `<div class="hmg-jb-v4-prose">` container (confirmed live on multiple
   postings: 230-270 characters more content in the div each time). See
   extract_description() below — the div is tried first, JSON-LD is the
   fallback if it's ever not found.

Environment variables:
  INGEST_SECRET  - JOB_CEO_INGEST_SECRET bearer token (required unless --dry-run)
  BASE_URL       - TalentOS base URL (default: production worker URL)

CLI arguments:
  --role-group   - A single role group id (A-R) or 'all' (default: all).
                   NOT comma-separated — matches_role() (reused from
                   openjobdata_ingest.py) only understands a single id or
                   "all"; openjobdata_ingest.py's own CLI has the same
                   constraint for the same reason.
  --dry-run      - Enumerate, fetch, filter and build payloads, but do not POST.
  --limit        - Cap the number of job pages fetched (debugging only).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agency_sources_common import (  # noqa: E402
    FetchError,
    assert_reachable,
    clean_ld_description,
    extract_country_from_jobposting,
    extract_div_by_class,
    extract_json_ld_jobposting,
    fetch_effective_keywords,
    fetch_seen_external_ids,
    get_role_group_ids,
    html_to_text,
    http_get,
    is_us_country,
    job_title_matches,
    looks_like_login_wall,
    post_jobs_in_batches,
    resolve_base_url,
)
from openjobdata_ingest import ROLE_GROUPS, matches_role  # noqa: E402

# The value stored in raw.source (and therefore, downstream, jobs.source) —
# named after the site's own domain (broadstaffglobal.com), not the
# employer name "Broadstaff" it staffs for, which is a separate field
# (company).
SOURCE_NAME = "broadstaffglobal"
SITEMAP_URL = "https://jobs.broadstaffglobal.com/sitemap/102028/sitemap.xml"

# Haley Marketing's own job-board template renders the full description into
# this div, server-side, on every job page (confirmed live across multiple
# real postings — the class name is a template convention, not a per-job
# accident). It preserves real <p>/<br>/<ul>/<li> structure and is measurably
# MORE complete than the same job's JobPosting.description field: confirmed
# live on two real postings, the JSON-LD field had already been flattened to
# plain text with paragraph/list boundaries lost AND was ~230-270 characters
# shorter than this div's content in both cases. This is why description
# extraction below tries this first and only falls back to the flattened
# JSON-LD field if the div isn't found (template change, A/B test, etc.) —
# never a hardcoded assumption that one or the other exists, checked at
# extraction time on every fetch.
_PROSE_DIV_CLASS = "hmg-jb-v4-prose"


def extract_description(raw_html: str, job_posting: Dict[str, Any]) -> str:
    prose_html = extract_div_by_class(raw_html, _PROSE_DIV_CLASS)
    if prose_html:
        text = html_to_text(prose_html)
        if text:
            return text
    # Fallback: the flattened JSON-LD field, present on every posting even
    # though it has already lost structure at the source.
    return clean_ld_description(job_posting.get("description"))

# /jb/{slug}/{numeric id} — the slug is discarded on both enumeration and
# rebuild; only the id is treated as meaningful (confirmed live: three
# different slugs against the same id returned byte-identical pages).
_JOB_URL_RE = re.compile(r"https://jobs\.broadstaffglobal\.com/jb/[^/\"<]+/(\d+)")


def enumerate_job_ids() -> List[str]:
    resp = http_get(SITEMAP_URL)
    ids = _JOB_URL_RE.findall(resp.text)
    # De-dupe while preserving order — a sitemap listing the same id twice
    # would otherwise double-fetch and double-count it.
    seen = set()
    unique_ids = []
    for job_id in ids:
        if job_id not in seen:
            seen.add(job_id)
            unique_ids.append(job_id)
    return unique_ids


def canonical_url(job_id: str) -> str:
    # The slug is decorative (confirmed live) — "x" is as valid as the real
    # one and makes that fact explicit rather than fabricating a plausible-
    # looking slug that could be mistaken for real data.
    return f"https://jobs.broadstaffglobal.com/jb/x/{job_id}"


def build_location(job_posting: Dict[str, Any]) -> str:
    location = job_posting.get("jobLocation")
    address = location.get("address") if isinstance(location, dict) else None
    if not isinstance(address, dict):
        return "United States"
    locality = str(address.get("addressLocality") or "").strip()
    region = str(address.get("addressRegion") or "").strip()
    parts = [p for p in (locality, region) if p]
    return ", ".join(parts) + ", USA" if parts else "United States"


def matched_role_groups(title: str) -> List[str]:
    return [gid for gid in ROLE_GROUPS if matches_role(title, gid)]


def build_payload(job_id: str, job_posting: Dict[str, Any], matched_custom: List[str], raw_html: str) -> Optional[Dict[str, Any]]:
    title = str(job_posting.get("title") or "").strip()
    if not title:
        return None

    try:
        description_text = extract_description(raw_html, job_posting)
    except ValueError as exc:
        print(f"  [skip] {job_id} \"{title}\": {exc}")
        return None

    if description_text and looks_like_login_wall(description_text):
        print(f"  [skip] {job_id} \"{title}\": description looks like a login/paywall page")
        return None

    hiring_org = job_posting.get("hiringOrganization") or {}
    employment_type = job_posting.get("employmentType")
    if isinstance(employment_type, list):
        employment_type = employment_type[0] if employment_type else None

    return {
        "title": title,
        "company": hiring_org.get("name") or "Broadstaff",
        "location": build_location(job_posting),
        "source_url": job_posting.get("url") or canonical_url(job_id),
        "external_job_id": job_id,
        "snippet": description_text[:300] if description_text else None,
        "description_text": description_text or None,
        "raw": {
            "source": SOURCE_NAME,
            "posted_at": job_posting.get("datePosted"),
            "valid_through": job_posting.get("validThrough"),
            "employment_type": employment_type,
            "apply_url": job_posting.get("url"),
            "company_website": hiring_org.get("url"),
            "matched_role_groups": matched_role_groups(title),
            "matched_custom_keywords": matched_custom,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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

    print(f"Broadstaff ingest — role_group={role_group}, dry_run={dry_run}, base_url={base_url}")

    try:
        assert_reachable(SITEMAP_URL, label="Broadstaff sitemap")
    except FetchError as exc:
        print(f"::error::[broadstaff] startup self-test failed — {exc}")
        sys.exit(1)

    job_ids = enumerate_job_ids()
    print(f"[PHASE 1] Sitemap lists {len(job_ids)} job(s).")
    if args.limit:
        job_ids = job_ids[: args.limit]

    keywords = fetch_effective_keywords(base_url, ingest_secret or "unused-in-dry-run", role_group)
    # A job already recorded from a prior run will always be rejected as a
    # duplicate by job-ceo/ingest regardless of what we send — skip its
    # fetch entirely rather than re-requesting a page whose outcome is
    # already known. This is what makes a daily re-walk of the same fixed
    # sitemap not mean "re-scrape the same jobs every day": only genuinely
    # new ids get fetched at all.
    seen_ids = fetch_seen_external_ids(base_url, ingest_secret or "unused-in-dry-run", SOURCE_NAME)

    jobs: List[Dict[str, Any]] = []
    fetch_failures = 0
    skipped_already_seen = 0
    skipped_not_found = 0
    skipped_non_us = 0
    skipped_no_match = 0

    new_job_ids = [jid for jid in job_ids if jid not in seen_ids]
    skipped_already_seen = len(job_ids) - len(new_job_ids)

    print(f"[PHASE 2] Fetching and filtering {len(new_job_ids)} not-yet-seen detail page(s) "
          f"({skipped_already_seen} already known, skipped without fetching)...")
    for job_id in new_job_ids:
        url = canonical_url(job_id)
        try:
            resp = http_get(url)
        except FetchError as exc:
            print(f"  [error] {job_id}: {exc}")
            fetch_failures += 1
            continue

        job_posting = extract_json_ld_jobposting(resp.text)
        if not job_posting:
            # Confirmed live: a removed/nonexistent job returns HTTP 200 with
            # a "not found" page carrying no JobPosting block. This is that
            # case, not a fetch failure.
            skipped_not_found += 1
            continue

        title = str(job_posting.get("title") or "")
        country = extract_country_from_jobposting(job_posting)
        if not is_us_country(country):
            skipped_non_us += 1
            continue

        title_lower = title.lower()
        matched_custom = [kw for kw in keywords.custom_keywords if kw in title_lower]
        if not job_title_matches(title, keywords):
            skipped_no_match += 1
            continue

        payload = build_payload(job_id, job_posting, matched_custom, resp.text)
        if payload:
            jobs.append(payload)

    print(
        f"[PHASE 2] Done. matched={len(jobs)}, skipped_already_seen={skipped_already_seen}, "
        f"skipped_not_found={skipped_not_found}, skipped_non_us={skipped_non_us}, "
        f"skipped_no_keyword_match={skipped_no_match}, fetch_failures={fetch_failures}"
    )

    # Hard floor (plan §4 item 5): Broadstaff's inventory is confirmed almost
    # entirely OSP/fiber/telecom-relevant. Zero matches is only suspicious
    # when there were actually new (not-already-seen) candidates to examine —
    # "everything today was already seen yesterday" is a legitimate, expected
    # outcome on a slow-moving ~39-job board, not a sign extraction broke.
    if role_group == "all" and len(new_job_ids) > 0 and len(jobs) == 0:
        print("::error::[broadstaff] 0 jobs matched out of a nonzero not-already-seen listing on an "
              "'all'-group run — this almost certainly means extraction broke (site markup changed, JSON-LD moved, etc.), "
              "not that zero jobs are genuinely relevant today. Failing loudly per design.")
        sys.exit(1)

    if not jobs:
        print("No jobs to ingest.")
        sys.exit(0)

    result = post_jobs_in_batches(jobs, base_url=base_url, ingest_secret=ingest_secret, dry_run=dry_run)
    if result.get("dry_run"):
        sys.exit(0)

    print(f"\n[DONE] staged={result['staged']}, skipped_dup={result['skipped']}")
    if result["failed_batches"]:
        print(f"::error::[broadstaff] {len(result['failed_batches'])} batch(es) permanently failed: {result['failed_batches']}")
        sys.exit(1)


if __name__ == "__main__":
    main()
