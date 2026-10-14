#!/usr/bin/env python3
"""Discover recent US Adzuna jobs and send quality-checked postings to Job CEO.

This is a source adapter only. It reads Job CEO's live keyword configuration,
uses Adzuna's standard search API, resolves an employer/ATS job page, and posts
the source record to the existing /api/job-ceo/ingest endpoint. Job CEO remains
responsible for full-page extraction, QA, candidate matching, and job creation.

The Adzuna API excerpt is deliberately stored only as `snippet`, never as
`description_text`. Job CEO therefore fetches the employer page in Deep Fetch.
An Adzuna posting is allowed past that stage only when the fetched description
meets the source-specific 1,500-character quality floor in jobCeoService.ts.

Credentials are read from ADZUNA_APP_ID / ADZUNA_APP_KEY and are never logged.
For local runs this script loads the repository .env/.env.local with dotenv;
CI should inject the same values as repository secrets.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import urlparse

from dotenv import load_dotenv
import requests
from ddgs import DDGS

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)
load_dotenv(os.path.join(REPO_ROOT, ".env.local"), override=False)
load_dotenv(os.path.join(REPO_ROOT, ".env"), override=False)

from agency_sources_common import (  # noqa: E402
    fetch_seen_external_ids,
    post_jobs_in_batches,
    resolve_base_url,
)

SOURCE_NAME = "adzuna"
ADZUNA_SEARCH_URL = "https://api.adzuna.com/v1/api/jobs/us/search"
RESULTS_PER_PAGE = 50
DEFAULT_DAYS = 2
# 35 calls per run stays comfortably under Adzuna's published monthly cap for
# the configured once-daily schedule, assuming the key is dedicated to
# TalentOS. Each keyword/page request consumes one API call.
DEFAULT_CALL_BUDGET = 35
MAX_CALL_BUDGET = 35
DEFAULT_MAX_JOBS = 40
DEFAULT_RUNS_PER_DAY = 1
REQUESTS_PER_MINUTE = 25
REQUEST_TIMEOUT_SECONDS = 25

US_COUNTRY_NAMES = {
    "us", "usa", "u s", "u s a", "united states", "united states of america",
}

ATS_HOSTS = (
    "greenhouse.io", "lever.co", "myworkdayjobs.com", "workday.com",
    "ashbyhq.com", "smartrecruiters.com", "workable.com", "recruitee.com",
    "bamboohr.com", "icims.com", "jobvite.com", "taleo.net",
    "paylocity.com", "successfactors.com", "applytojob.com", "breezy.hr",
    "teamtailor.com", "oraclecloud.com", "silkroad.com", "clearcompany.com",
)
BLOCKED_HOSTS = (
    "adzuna.com", "linkedin.com", "indeed.com", "glassdoor.com", "monster.com",
    "ziprecruiter.com", "careerbuilder.com", "talent.com", "jooble.org",
    "careerjet.com", "snagajob.com", "simplyhired.com", "youtube.com",
    "facebook.com", "twitter.com", "x.com",
)
COMPANY_SUFFIXES = {
    "inc", "llc", "corp", "corporation", "co", "ltd", "company", "group",
    "holdings", "plc", "llp", "the",
}


class AdzunaRequestError(RuntimeError):
    """An API error whose message is safe to print (no request URL or secrets)."""


def normalize_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def fetch_effective_terms(base_url: str, ingest_secret: str, role_group: str) -> List[str]:
    """Read current Job CEO static and custom search terms; do not mirror them."""
    url = f"{base_url.rstrip('/')}/api/job-ceo/effective-keywords"
    params = {"role_group": role_group}
    try:
        response = requests.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {ingest_secret}"},
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        # Requests' exception strings can include the URL. Keep this message
        # generic so authorization material never reaches logs.
        raise RuntimeError("Could not load current Job CEO keywords; no jobs were searched.") from exc

    if data.get("custom_groups_error"):
        raise RuntimeError("TalentOS could not load its custom keyword groups; refusing a partial keyword run.")

    terms: List[str] = []
    seen: set[str] = set()

    def add(value: Any) -> None:
        term = str(value or "").strip()
        normalized = normalize_text(term)
        if len(normalized) < 2 or normalized in seen:
            return
        seen.add(normalized)
        terms.append(term)

    groups = data.get("groups")
    if not isinstance(groups, dict):
        raise RuntimeError("TalentOS returned an invalid Job CEO keyword response.")
    for group_id in sorted(groups):
        group = groups[group_id]
        if not isinstance(group, dict):
            continue
        for term in group.get("titles", []) or []:
            add(term)

    for group in data.get("custom", []) or []:
        if not isinstance(group, dict):
            continue
        for term in group.get("keywords", []) or []:
            add(term)

    if not terms:
        raise RuntimeError("TalentOS returned no search terms; no Adzuna calls were made.")
    return terms


def choose_rotating_terms(
    terms: Sequence[str],
    call_budget: int,
    runs_per_day: int,
    now: Optional[datetime] = None,
) -> List[str]:
    """Rotate across the complete live keyword set without storing a cursor in DB."""
    if not terms:
        return []
    if runs_per_day not in (1, 2):
        raise ValueError("runs_per_day must be 1 or 2")
    count = min(len(terms), call_budget)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    utc_now = now.astimezone(timezone.utc)
    slot = min(runs_per_day - 1, utc_now.hour * runs_per_day // 24)
    rotation_index = utc_now.date().toordinal() * runs_per_day + slot
    start = (rotation_index * count) % len(terms)
    return [terms[(start + offset) % len(terms)] for offset in range(count)]


def adzuna_result_is_us(result: Dict[str, Any]) -> bool:
    location = result.get("location") or {}
    area = location.get("area") or []
    if isinstance(area, str):
        area = [area]
    candidates = [*area, location.get("display_name", "")]
    return any(normalize_text(item) in US_COUNTRY_NAMES for item in candidates)


def parse_created(value: Any) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def title_matches_terms(title: str, terms: Iterable[str]) -> List[str]:
    normalized_title = f" {normalize_text(title)} "
    matched: List[str] = []
    for term in terms:
        normalized_term = normalize_text(term)
        if normalized_term and f" {normalized_term} " in normalized_title:
            matched.append(term)
    return matched


def _company_host_terms(company: str) -> List[str]:
    return [
        token for token in normalize_text(company).split()
        if len(token) >= 4 and token not in COMPANY_SUFFIXES
    ]


def _source_url_rank(url: str, company: str) -> int:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if parsed.scheme not in ("http", "https") or not host:
        return 99
    if any(blocked in host for blocked in BLOCKED_HOSTS):
        return 99
    if any(host == domain or host.endswith("." + domain) for domain in ATS_HOSTS):
        return 0
    if any(term in host for term in _company_host_terms(company)):
        return 1
    return 2


_last_web_search_at = 0.0


def find_employer_job_url(title: str, company: str) -> Optional[str]:
    """Find a readable employer/ATS page; Adzuna redirect URLs are not used."""
    global _last_web_search_at
    query = f'"{title}" "{company}" careers job'

    for attempt in range(3):
        elapsed = time.monotonic() - _last_web_search_at
        if elapsed < 0.8:
            time.sleep(0.8 - elapsed)
        _last_web_search_at = time.monotonic()
        try:
            with DDGS() as search:
                results = list(search.text(query, max_results=8))
            candidates: List[Tuple[int, str]] = []
            for result in results:
                url = str(result.get("href") or result.get("url") or "").strip()
                rank = _source_url_rank(url, company)
                if rank >= 99:
                    continue

                # Require evidence of both the title and employer in the result
                # itself or its host; this avoids sending an unrelated search hit
                # into the Job CEO fetcher merely because its domain ranked well.
                evidence = normalize_text(" ".join([
                    str(result.get("title") or ""),
                    str(result.get("body") or ""),
                    urlparse(url).hostname or "",
                ]))
                title_tokens = [t for t in normalize_text(title).split() if len(t) >= 3]
                company_tokens = _company_host_terms(company)
                if title_tokens and not any(token in evidence.split() for token in title_tokens):
                    continue
                if company_tokens and not any(token in evidence.split() for token in company_tokens):
                    # ATS domains commonly omit the employer name; allow the
                    # explicit job-title result from those trusted hosts.
                    if rank != 0:
                        continue
                candidates.append((rank, url))

            if candidates:
                candidates.sort(key=lambda item: item[0])
                return candidates[0][1]
            return None
        except Exception:
            if attempt == 2:
                return None
            time.sleep(1 + attempt)
    return None


class AdzunaClient:
    def __init__(self, app_id: str, app_key: str, call_budget: int) -> None:
        self.app_id = app_id
        self.app_key = app_key
        self.call_budget = call_budget
        self.calls_used = 0
        self.last_request_at = 0.0
        self.session = requests.Session()

    def search(self, term: str, page: int, days: int) -> List[Dict[str, Any]]:
        if self.calls_used >= self.call_budget:
            return []

        minimum_interval = 60.0 / REQUESTS_PER_MINUTE
        elapsed = time.monotonic() - self.last_request_at
        if self.last_request_at and elapsed < minimum_interval:
            time.sleep(minimum_interval - elapsed)

        # Count every attempted request, including errors, against this run's cap.
        self.calls_used += 1
        self.last_request_at = time.monotonic()
        params = {
            "app_id": self.app_id,
            "app_key": self.app_key,
            "results_per_page": RESULTS_PER_PAGE,
            "sort_by": "date",
            "max_days_old": days,
            "what": term,
            "content-type": "application/json",
        }
        try:
            response = self.session.get(
                f"{ADZUNA_SEARCH_URL}/{page}", params=params, timeout=REQUEST_TIMEOUT_SECONDS
            )
        except requests.RequestException as exc:
            raise AdzunaRequestError("Adzuna request failed; the URL and credentials were redacted.") from exc

        if response.status_code in (403, 429):
            raise AdzunaRequestError(
                f"Adzuna returned HTTP {response.status_code}; stopped without rotating credentials."
            )
        if response.status_code < 200 or response.status_code >= 300:
            raise AdzunaRequestError(f"Adzuna returned HTTP {response.status_code}.")
        try:
            body = response.json()
        except ValueError as exc:
            raise AdzunaRequestError("Adzuna returned invalid JSON.") from exc
        results = body.get("results") if isinstance(body, dict) else None
        if not isinstance(results, list):
            raise AdzunaRequestError("Adzuna response did not contain a results list.")
        return [item for item in results if isinstance(item, dict)]


def _number(value: Any) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def build_job_payload(result: Dict[str, Any], source_url: str, matched_terms: List[str]) -> Dict[str, Any]:
    company_obj = result.get("company") or {}
    location_obj = result.get("location") or {}
    category_obj = result.get("category") or {}
    company = str(company_obj.get("display_name") or "").strip()
    title = str(result.get("title") or "").strip()
    job_id = str(result.get("id") or "").strip()
    location = str(location_obj.get("display_name") or "United States").strip()
    excerpt = str(result.get("description") or "").strip()
    salary_min = _number(result.get("salary_min"))
    salary_max = _number(result.get("salary_max"))
    salary_range = None
    if salary_min is not None and salary_max is not None:
        salary_range = f"${salary_min:,.0f}–${salary_max:,.0f}"
    elif salary_min is not None or salary_max is not None:
        salary_range = f"${(salary_min or salary_max):,.0f}+"

    posted_at = str(result.get("created") or "").strip() or None
    redirect_url = str(result.get("redirect_url") or "").strip() or None
    salary_predicted = result.get("salary_is_predicted")
    salary_is_predicted = salary_predicted is True or str(salary_predicted).strip().lower() in {
        "1", "true", "yes",
    }
    return {
        "title": title,
        "company": company,
        "location": location,
        "source_url": source_url,
        "external_job_id": job_id,
        # Excerpts stay separate so they cannot trigger Deep Fetch's existing
        # "description already looks complete" fast path.
        "snippet": excerpt[:1200] or None,
        "description_text": None,
        "raw": {
            "source": SOURCE_NAME,
            "adzuna_redirect_url": redirect_url,
            "adzuna_excerpt": excerpt[:1200] or None,
            "posted_at": posted_at,
            "salary_min": salary_min,
            "salary_max": salary_max,
            "salary_range": salary_range,
            "salary_is_predicted": salary_is_predicted,
            "employment_type": result.get("contract_type"),
            "contract_time": result.get("contract_time"),
            "category": category_obj.get("label"),
            "category_tag": category_obj.get("tag"),
            "latitude": result.get("latitude"),
            "longitude": result.get("longitude"),
            "matched_keywords": matched_terms,
            # `apply_url` is the readable employer/ATS page found above. The
            # Adzuna tracking redirect is retained only for provenance.
            "apply_url": source_url,
        },
    }


def run(args: argparse.Namespace) -> int:
    app_id = os.environ.get("ADZUNA_APP_ID", "").strip()
    app_key = os.environ.get("ADZUNA_APP_KEY", "").strip()
    ingest_secret = (os.environ.get("INGEST_SECRET") or os.environ.get("JOB_CEO_INGEST_SECRET") or "").strip()
    base_url = resolve_base_url().rstrip("/")

    if not app_id or not app_key:
        raise RuntimeError("ADZUNA_APP_ID and ADZUNA_APP_KEY must be set in the environment.")
    if not ingest_secret:
        raise RuntimeError("JOB_CEO_INGEST_SECRET (or INGEST_SECRET) is required to read TalentOS keywords and ingest jobs.")

    terms = fetch_effective_terms(base_url, ingest_secret, args.role_group)
    selected_terms = choose_rotating_terms(terms, args.call_budget, args.runs_per_day)
    print(
        f"Adzuna -> Job CEO: {len(terms)} live terms available; "
        f"searching {len(selected_terms)} this run; freshness={args.days} day(s); "
        f"budget={args.call_budget} API calls; dry_run={args.dry_run}"
    )

    seen_ids = fetch_seen_external_ids(base_url, ingest_secret, SOURCE_NAME)
    client = AdzunaClient(app_id, app_key, args.call_budget)
    terms_for_match = terms
    jobs_by_id: Dict[str, Tuple[Dict[str, Any], List[str]]] = {}
    skipped_non_us = 0
    skipped_stale_or_undated = 0
    skipped_bad_record = 0

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=args.days)
    for term in selected_terms:
        results = client.search(term, page=1, days=args.days)
        for result in results:
            job_id = str(result.get("id") or "").strip()
            title = str(result.get("title") or "").strip()
            company_obj = result.get("company") or {}
            company = str(company_obj.get("display_name") or "").strip()
            matched_terms = title_matches_terms(title, terms_for_match)
            if not job_id or not title or not company or not matched_terms:
                skipped_bad_record += 1
                continue
            if job_id.lower() in seen_ids:
                continue
            if not adzuna_result_is_us(result):
                skipped_non_us += 1
                continue
            created = parse_created(result.get("created"))
            if created is None or created < cutoff:
                skipped_stale_or_undated += 1
                continue
            previous = jobs_by_id.get(job_id)
            if previous:
                previous[1][:] = sorted(set(previous[1] + matched_terms))
            else:
                jobs_by_id[job_id] = (result, matched_terms)

    print(
        f"Adzuna search complete: calls={client.calls_used}, unique relevant new jobs={len(jobs_by_id)}, "
        f"non-US={skipped_non_us}, stale/undated={skipped_stale_or_undated}, "
        f"invalid/off-keyword={skipped_bad_record}"
    )

    if not jobs_by_id:
        print("No new relevant US postings were found.")
        return 0

    # The Adzuna API's redirect is not treated as a job page. Resolve a direct
    # employer/ATS page before staging so Job CEO Deep Fetch has a real source.
    resolved: List[Dict[str, Any]] = []
    unresolved_links = 0
    link_lookups = 0
    for result, matched_terms in jobs_by_id.values():
        if len(resolved) >= args.max_jobs or link_lookups >= args.max_link_lookups:
            break
        title = str(result.get("title") or "").strip()
        company = str((result.get("company") or {}).get("display_name") or "").strip()
        link_lookups += 1
        source_url = find_employer_job_url(title, company)
        if not source_url:
            unresolved_links += 1
            continue
        resolved.append(build_job_payload(result, source_url, matched_terms))

    print(
        f"Employer link recovery: checked={link_lookups}, resolved={len(resolved)}, "
        f"unresolved={unresolved_links}; max_jobs={args.max_jobs}"
    )

    if not resolved:
        print("No direct employer/ATS job pages were found; nothing was sent to Job CEO.")
        return 0

    result = post_jobs_in_batches(
        resolved,
        base_url=base_url,
        ingest_secret=ingest_secret,
        dry_run=args.dry_run,
    )
    if result.get("dry_run"):
        return 0
    if result.get("failed_batches"):
        print(f"ERROR: Job CEO ingest failed for batch(es): {result['failed_batches']}")
        return 1
    print(
        f"Done: source=adzuna staged={result.get('staged', 0)} "
        f"duplicates_skipped={result.get('skipped', 0)} api_calls={client.calls_used}"
    )
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--role-group", default="all", help="TalentOS role group id or 'all'.")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS, help="Maximum posting age in days (default: 2).")
    parser.add_argument(
        "--call-budget", type=int, default=DEFAULT_CALL_BUDGET,
        help=f"Adzuna requests for this run; hard capped at {MAX_CALL_BUDGET}.",
    )
    parser.add_argument(
        "--runs-per-day", type=int, choices=(1, 2), default=DEFAULT_RUNS_PER_DAY,
        help="Used only to rotate fairly through the live keyword list (1 or 2).",
    )
    parser.add_argument("--max-jobs", type=int, default=DEFAULT_MAX_JOBS, help="Maximum postings resolved and staged per run.")
    parser.add_argument("--max-link-lookups", type=int, default=80, help="Maximum direct-source searches per run.")
    parser.add_argument("--dry-run", action="store_true", help="Search and resolve links, but do not POST to TalentOS.")
    args = parser.parse_args()
    if not 1 <= args.days <= 31:
        parser.error("--days must be between 1 and 31")
    if not 1 <= args.call_budget <= MAX_CALL_BUDGET:
        parser.error(f"--call-budget must be between 1 and {MAX_CALL_BUDGET}")
    if not 1 <= args.max_jobs <= 100:
        parser.error("--max-jobs must be between 1 and 100")
    if not 1 <= args.max_link_lookups <= 200:
        parser.error("--max-link-lookups must be between 1 and 200")
    if not re.fullmatch(r"all|[A-Z]", args.role_group, re.IGNORECASE):
        parser.error("--role-group must be 'all' or a single letter group id")
    args.role_group = args.role_group.upper() if args.role_group.lower() != "all" else "all"
    return args


if __name__ == "__main__":
    try:
        raise SystemExit(run(parse_args()))
    except KeyboardInterrupt:
        print("Interrupted; no further Adzuna requests will be made.")
        raise SystemExit(130)
    except Exception as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
