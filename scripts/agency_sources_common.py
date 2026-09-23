"""
scripts/agency_sources_common.py

Shared core for the daily agency-career-site job ingesters (Actalent,
Broadstaff, and any future one built the same way). Each adapter script
implements only "enumerate listing URLs" + "fetch and parse one job detail
page"; everything else — keyword matching, US-location filtering, JSON-LD
extraction, HTTP with retries, and the batched POST to Job CEO — lives here
so it cannot drift between adapters.

Design decisions, verified live against both target sites on 2026-09-13
(see docs/AGENCY_JOB_SOURCES_ACTALENT_BROADSTAFF_PLAN_2026-09-13.md for the
full research):

1. Keyword matching reuses openjobdata_ingest.py's ROLE_GROUPS/matches_role
   by IMPORTING that module, not by copying its data. That module's heavy
   dependencies (pandas, huggingface_hub) are imported lazily inside
   functions this file never calls, so importing it here has no side
   effects and does not require those packages to be installed. This is
   the literal "same keyword groups already used for OpenJobData scraping"
   the ingest scripts are meant to reuse — not a fresh reimplementation
   that could silently diverge from it.

2. Custom keyword groups (the ones a staff member adds via the Job Agent /
   Job CEO pages, stored in job_agent_keyword_groups) are fetched from
   GET /api/job-ceo/effective-keywords. Before that endpoint existed,
   openjobdata_ingest.py could not see these at all — its ROLE_GROUPS is a
   hand-maintained snapshot fixed at authoring time. If the endpoint is
   unreachable, matching still proceeds on ROLE_GROUPS alone with a loud
   warning — a keyword-service outage should degrade coverage, not silently
   ingest nothing.

3. US-only is enforced structurally, not assumed from which URL/site
   section a job came from. Both sites' JSON-LD carries
   jobLocation.address.addressCountry, confirmed live as "USA" (Actalent)
   and "US" (Broadstaff) — both accepted; anything else, or a missing
   value, is rejected. This is deliberately conservative: a job whose
   country cannot be confirmed as US is excluded, not included.

4. User-Agent is a truthful, self-identifying string
   ("TalentOS-JobIngest/1.0 (+https://talent.skarion.com)"), not a
   browser-impersonating one. Confirmed live to work against both sites —
   Broadstaff's block on bare "curl/*" User-Agents is specifically that,
   not a block on non-browser clients generally (python-requests,
   Googlebot, and this string were all separately confirmed to pass; only
   curl's own default/explicit UA family 404s).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from html import unescape
from typing import Any, Dict, List, Optional

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from openjobdata_ingest import (  # noqa: E402  (see module docstring — import must follow sys.path fixup)
    ROLE_GROUPS,
    matches_role,
    sanitize_payload,
)

USER_AGENT = "TalentOS-JobIngest/1.0 (+https://talent.skarion.com)"

# schema.org allows either a bare string country code/name or an object
# (rare, but seen for some multi-jurisdiction postings) — normalized
# upper-case comparison against every spelling actually observed in the
# wild for "the United States", not just the two confirmed live here.
_US_COUNTRY_VALUES = {"US", "USA", "U.S.", "U.S.A.", "UNITED STATES", "UNITED STATES OF AMERICA"}

_LOGIN_WALL_RE = re.compile(r"sign\s*(in|up|on)|log\s*in|create\s*(an\s*)?account", re.IGNORECASE)


# ─── HTTP ────────────────────────────────────────────────────────────────────


class FetchError(RuntimeError):
    """Raised when a URL could not be fetched after all retries."""


def _fix_response_encoding(resp: requests.Response) -> None:
    """
    Confirmed live on both sites: `Content-Type: text/html` with no charset
    parameter. Per RFC 2616, `requests` then defaults resp.encoding to
    ISO-8859-1 for any text/* response - but the actual page content is
    real UTF-8 (confirmed by inspecting the raw response bytes directly:
    the bytes for a curly apostrophe are the correct 3-byte UTF-8 sequence
    e2 80 99). Decoding real 3-byte UTF-8 sequences one byte at a time as
    Latin-1 corrupts every non-ASCII character a job description contains -
    curly quotes, em/en dashes, accented names - into 2-3 garbage
    characters apiece (a real posting's "company's history" was captured as
    "company\xe2\x80\x99s history", not a display artifact but actual
    corruption in the extracted text). This is `requests`' own documented
    gotcha for servers that omit an explicit charset, not something specific
    to these two sites.

    Only overridden when the server did NOT declare a charset explicitly -
    an explicit, real declaration (of any encoding) is left alone and
    trusted over a heuristic guess. `apparent_encoding` (chardet's
    content-based detection, independent of the header) is used instead of
    hardcoding "assume UTF-8", so a genuinely non-UTF-8 undeclared response
    would still be decoded as whatever it actually is.
    """
    content_type = resp.headers.get("Content-Type", "")
    if "charset=" not in content_type.lower() and resp.encoding and resp.encoding.lower() == "iso-8859-1":
        resp.encoding = resp.apparent_encoding


def http_get(
    url: str,
    *,
    timeout: int = 45,
    max_retries: int = 3,
    backoff_secs: Optional[List[int]] = None,
    allow_statuses: Optional[set] = None,
) -> requests.Response:
    """
    GET with a truthful UA, bounded retries, and exponential backoff.

    Broadstaff's detail pages were observed taking 7-17 seconds live —
    timeout defaults high enough to not flake on that. allow_statuses lets a
    caller treat e.g. 410 as a valid (non-retried, non-raising) response,
    since that is Actalent's confirmed signal for a delisted requisition.
    """
    backoff_secs = backoff_secs or [2, 4, 8]
    allow_statuses = allow_statuses or set()
    last_err: Optional[Exception] = None

    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout)
            _fix_response_encoding(resp)
            if resp.status_code in allow_statuses:
                return resp
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last_err = exc
            if attempt < max_retries:
                wait = backoff_secs[min(attempt - 1, len(backoff_secs) - 1)]
                print(f"  [retry] {url[:100]} attempt {attempt}/{max_retries} failed ({exc}); retrying in {wait}s")
                time.sleep(wait)
    raise FetchError(f"GET failed after {max_retries} attempts: {url} ({last_err})")


def assert_reachable(url: str, *, label: str) -> None:
    """
    Startup self-test. A source that has always returned 200 suddenly 404ing
    (Broadstaff's confirmed curl-UA block being an example of exactly this
    class of failure) must fail the run loudly, not silently yield zero jobs.
    """
    resp = http_get(url, max_retries=1)
    if resp.status_code != 200:
        raise FetchError(f"{label} self-test failed: GET {url} returned {resp.status_code}, expected 200")


# ─── JSON-LD extraction ──────────────────────────────────────────────────────

_LD_JSON_RE = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)


def extract_json_ld_jobposting(html: str) -> Optional[Dict[str, Any]]:
    """
    Returns the first schema.org JobPosting object found in the page's
    JSON-LD blocks, or None. Handles a block being a single object, a list
    of objects, or a list of one object wrapped under a mismatched @type
    (defensive; not observed on either site but cheap to allow for).
    """
    for raw in _LD_JSON_RE.findall(html):
        try:
            parsed = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError):
            continue
        candidates = parsed if isinstance(parsed, list) else [parsed]
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            type_value = candidate.get("@type")
            types = type_value if isinstance(type_value, list) else [type_value]
            if "JobPosting" in types:
                return candidate
    return None


# Tags whose open AND close (or, for the void <br>/<hr>, whose only
# occurrence) mark a real line break in the source document - a paragraph,
# a list item, an explicit break, a section rule, a heading, a table row.
# Converting these to "\n" instead of a bare space is what separates
# "Responsibilities: item one item two item three Essential Skills: ..."
# (unreadable, and exactly what a plain "strip every tag to a space" pass
# produces) from the same content readable as one line per item.
#
# BOTH open and close matter here, not just close: real postings (confirmed
# live on Actalent) use unclosed "<p>" tags as section separators with no
# matching "</p>" at all — valid loose HTML5 (a new <p> implicitly closes
# the previous one in a real DOM parser), but invisible to a close-tag-only
# rule, which left "Job Title: GIS AnalystJob DescriptionJoin our team..."
# run together with zero separation. Matching both ends means an unclosed
# <p> still gets its break from its own opening tag.
#
# <li> is handled separately below: its OPEN gets a bullet marker, not just
# a break, so list items are visually marked, not merely separated; its
# CLOSE still falls through to this same plain-break rule.
_BLOCK_BREAK_RE = re.compile(r"</?\s*(p|div|h[1-6]|tr|blockquote)(?:\s[^>]*)?>|</\s*li\s*>", re.IGNORECASE)
_VOID_BREAK_RE = re.compile(r"<\s*(br|hr)(?:\s[^>]*)?/?\s*>", re.IGNORECASE)
_LIST_ITEM_OPEN_RE = re.compile(r"<\s*li(?:\s[^>]*)?>", re.IGNORECASE)
_ANY_TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(html_fragment: str) -> str:
    """
    HTML -> plain text that preserves the source's paragraph/list structure
    as real newlines, rather than collapsing every tag to a single space (a
    posting with a "Responsibilities" heading followed by a six-item list
    read, before this, as one unbroken run-on sentence - every word was
    present, but the structure that makes it a list rather than a sentence
    was gone). Confirmed live against real Actalent and Broadstaff postings.

    Entities are unescaped first (handles Actalent's confirmed
    double-escaping: "&lt;p&gt;..." must become "<p>..." before any tag
    substitution can see it as a tag at all), block boundaries become
    newlines, list items get a leading "- ", every remaining tag (inline
    ones: <strong>, <em>, <span>, and stray unmatched opens) is dropped
    with no replacement text, entities are unescaped again for anything
    that survived inside an attribute, and runs of blank lines are
    collapsed. Raises if escaped HTML markers survive cleaning, rather than
    silently keeping visibly broken text.
    """
    if not html_fragment:
        return ""
    text = html_fragment
    for _ in range(3):
        unescaped = unescape(text)
        if unescaped == text:
            break
        text = unescaped

    text = _LIST_ITEM_OPEN_RE.sub("\n- ", text)
    text = _BLOCK_BREAK_RE.sub("\n", text)
    text = _VOID_BREAK_RE.sub("\n", text)
    text = _ANY_TAG_RE.sub("", text)
    text = unescape(text)

    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    if "&lt;" in text or "&gt;" in text:
        raise ValueError("description still contains escaped HTML after cleaning — extraction is unreliable")
    return text


def clean_ld_description(raw_description: Optional[str]) -> str:
    """JobPosting.description specifically - see html_to_text for the real logic."""
    return html_to_text(raw_description or "")


def extract_div_by_class(html: str, class_name: str) -> Optional[str]:
    """
    Returns the inner HTML of the first <div> whose class attribute contains
    class_name as a whole class (word-bounded within the attribute, so
    "prose" doesn't match "hmg-jb-v4-prose-wrapper"), or None if not found.

    Depth-aware: tracks nested <div>...</div> pairs to find the TRUE closing
    tag rather than the first "</div>" encountered, which would truncate the
    content at the first nested div's close instead of the container's own.
    """
    open_tag_re = re.compile(
        r'<div\b[^>]*\bclass\s*=\s*"[^"]*\b' + re.escape(class_name) + r'\b[^"]*"[^>]*>',
        re.IGNORECASE,
    )
    match = open_tag_re.search(html)
    if not match:
        return None

    depth = 1
    tag_re = re.compile(r"<(/?)div\b[^>]*>", re.IGNORECASE)
    for tag_match in tag_re.finditer(html, match.end()):
        depth += -1 if tag_match.group(1) == "/" else 1
        if depth == 0:
            return html[match.end() : tag_match.start()]
    return None


def looks_like_login_wall(text: str) -> bool:
    """A description that's actually a login/paywall page, not job content."""
    return bool(_LOGIN_WALL_RE.search(text[:500])) and len(text) < 1500


# ─── US-location filtering ──────────────────────────────────────────────────


def is_us_country(country_value: Any) -> bool:
    """
    Conservative by design: a job whose country cannot be confirmed as the
    US is excluded, not included. country_value may be a bare string, or
    (rarely, schema.org allows it) an object with a "name" field.
    """
    if isinstance(country_value, dict):
        country_value = country_value.get("name")
    if not isinstance(country_value, str) or not country_value.strip():
        return False
    return country_value.strip().upper() in _US_COUNTRY_VALUES


def extract_country_from_jobposting(job_posting: Dict[str, Any]) -> Optional[str]:
    location = job_posting.get("jobLocation")
    locations = location if isinstance(location, list) else [location]
    for loc in locations:
        if not isinstance(loc, dict):
            continue
        address = loc.get("address")
        if isinstance(address, dict):
            country = address.get("addressCountry")
            if country:
                return country if isinstance(country, str) else json.dumps(country)
    return None


# ─── Keyword resolution + matching ──────────────────────────────────────────


@dataclass
class EffectiveKeywords:
    """
    Merged keyword set for a run: openjobdata_ingest.py's ROLE_GROUPS
    (reused, not reimplemented — see module docstring) plus custom keyword
    groups fetched from the DB via /api/job-ceo/effective-keywords. The
    custom list is checked as plain lowercase substrings, the same "safe
    root" style ROLE_GROUPS already uses for its longer phrases — every
    entry here is a multi-word phrase a staff member typed, not a bare
    short acronym, so it carries no word-boundary false-positive risk the
    way "osp"/"gis"/"cad" alone would.
    """

    role_group: str
    custom_keywords: List[str] = field(default_factory=list)
    custom_groups_fetched: bool = False
    fetch_warning: Optional[str] = None


def fetch_effective_keywords(
    base_url: str,
    ingest_secret: str,
    role_group: str = "all",
    *,
    timeout: int = 20,
) -> EffectiveKeywords:
    """
    Calls GET /api/job-ceo/effective-keywords for the custom (DB-backed)
    keyword groups. Never raises — a keyword-service outage must degrade
    matching to ROLE_GROUPS alone, loudly, not abort the whole run.
    """
    result = EffectiveKeywords(role_group=role_group)
    url = f"{base_url}/api/job-ceo/effective-keywords?role_group={role_group}"
    try:
        resp = requests.get(url, headers={"Authorization": f"Bearer {ingest_secret}"}, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        for group in data.get("custom", []):
            keywords = group.get("keywords") or []
            result.custom_keywords.extend(str(k).strip().lower() for k in keywords if str(k).strip())
        result.custom_groups_fetched = True
        if data.get("custom_groups_error"):
            result.fetch_warning = f"server reported a DB error loading custom groups: {data['custom_groups_error']}"
    except Exception as exc:  # noqa: BLE001 — this path must never raise
        result.fetch_warning = f"could not reach {url}: {exc}"

    if result.fetch_warning:
        print(f"::warning::[agency-sources] {result.fetch_warning} — continuing with static ROLE_GROUPS keywords only")

    return result


def fetch_seen_external_ids(base_url: str, ingest_secret: str, source: str, *, timeout: int = 20) -> set:
    """
    Returns the set of external_job_ids already recorded for this source, so
    a candidate already known from a prior run can be skipped before paying
    for its detail-page fetch, instead of discovering it's a duplicate only
    after fetching it — see GET /api/job-ceo/seen-external-ids's docstring
    for why this exists (neither site publishes a "what's new since date X"
    feed, so without this every run re-fetches every currently-matching
    posting regardless of whether it's already been captured).

    This is a pure optimization — never raises, and an empty/unreachable
    result only means every candidate gets (re-)fetched this run, exactly
    the behavior before this function existed. Correctness never depends on
    it: job-ceo/ingest's dedup is authoritative and permanent regardless.
    """
    url = f"{base_url}/api/job-ceo/seen-external-ids?source={source}"
    try:
        resp = requests.get(url, headers={"Authorization": f"Bearer {ingest_secret}"}, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
        ids = {str(x).strip().lower() for x in data.get("external_job_ids", []) if str(x).strip()}
        print(f"[agency-sources] {len(ids)} already-seen id(s) known for source={source}; will skip re-fetching those.")
        return ids
    except Exception as exc:  # noqa: BLE001 — this path must never raise
        print(f"::warning::[agency-sources] could not reach {url}: {exc} — every candidate will be (re-)fetched this run")
        return set()


def job_title_matches(title: str, keywords: EffectiveKeywords) -> bool:
    """
    True if the title matches ROLE_GROUPS for the requested group (the
    exact same word-boundary-safe check openjobdata_ingest.py applies) OR
    any custom keyword phrase as a plain substring.
    """
    if matches_role(title, keywords.role_group):
        return True
    if not title:
        return False
    title_lower = title.lower()
    return any(kw in title_lower for kw in keywords.custom_keywords)


def get_role_group_ids() -> List[str]:
    return list(ROLE_GROUPS.keys())


# ─── Posting to Job CEO ──────────────────────────────────────────────────────

BATCH_SIZE = 100
MAX_RETRIES = 3
BACKOFF_SECS = [2, 4, 8]


def post_jobs_in_batches(
    jobs: List[Dict[str, Any]],
    *,
    base_url: str,
    ingest_secret: str,
    dry_run: bool,
) -> Dict[str, Any]:
    """
    Mirrors openjobdata_ingest.py's batching/retry contract exactly (same
    BATCH_SIZE, same backoff schedule, same runId-carry-forward-across-
    batches behavior) so this source behaves identically to the existing
    one operationally — same failure modes, same recovery, same log shape.
    """
    if dry_run:
        print(f"\n[DRY RUN] Would POST {len(jobs)} jobs to {base_url}/api/job-ceo/ingest")
        for j in jobs[:5]:
            print(f"  • {j['title']} @ {j['company']} ({j.get('location')})")
        return {"staged": 0, "skipped": 0, "failed_batches": [], "dry_run": True}

    total_staged = 0
    total_skipped = 0
    failed_batches: List[int] = []
    current_run_id: Optional[str] = None
    url = f"{base_url}/api/job-ceo/ingest"

    for batch_num, i in enumerate(range(0, len(jobs), BATCH_SIZE), 1):
        batch = [sanitize_payload(j) for j in jobs[i : i + BATCH_SIZE]]
        batch_ok = False
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                payload: Dict[str, Any] = {"jobs": batch}
                if current_run_id:
                    payload["runId"] = current_run_id
                resp = requests.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {ingest_secret}", "Content-Type": "application/json"},
                    timeout=90,
                )
                resp.raise_for_status()
                data = resp.json()
                staged = data.get("staged", len(batch))
                skipped = data.get("skipped", 0)
                if not current_run_id and data.get("runId"):
                    current_run_id = data["runId"]
                total_staged += staged
                total_skipped += skipped
                print(f"  Batch {batch_num}: sent {len(batch)}, staged={staged}, skipped_dup={skipped}")
                batch_ok = True
                break
            except requests.RequestException as exc:
                body = ""
                if hasattr(exc, "response") and exc.response is not None:
                    body = exc.response.text[:500]
                if attempt < MAX_RETRIES:
                    wait = BACKOFF_SECS[attempt - 1]
                    print(f"  Batch {batch_num}: attempt {attempt}/{MAX_RETRIES} FAILED — {exc} (retrying in {wait}s)")
                    if body:
                        print(f"    Response: {body}")
                    time.sleep(wait)
                else:
                    print(f"  Batch {batch_num}: ALL {MAX_RETRIES} attempts FAILED — {exc} (skipping batch)")
                    if body:
                        print(f"    Response: {body}")
                    failed_batches.append(batch_num)
        if not batch_ok:
            continue

    return {"staged": total_staged, "skipped": total_skipped, "failed_batches": failed_batches, "run_id": current_run_id}


def resolve_base_url() -> str:
    return (
        os.environ.get("BASE_URL")
        or os.environ.get("TALENTOS_INGEST_URL")
        or "https://talent.skarion.com"
    )
