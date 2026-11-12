#!/usr/bin/env python3
"""Discover and ingest jobs from the verified TalentOS employer career-page tracker.

The runner reuses the Job CEO staging API used by Actalent and Broadstaff. It
supports public Greenhouse, Lever, Ashby, Workday, and other ATS feeds, plus
robots-aware HTML pagination for SmartRecruiters and Rippling boards. Generic
sources use sitemap traversal and schema.org JobPosting JSON-LD or microdata. Each unique
source URL is checkpointed so a large run can resume without losing completed
employer sources.

This is intentionally a discovery runner, not a claim that every ATS is
supported. Unsupported, blocked, failed, and zero-posting pages are written to
the results file for adapter follow-up. No page is sent to TalentOS unless
--ingest is explicitly supplied.
"""
from __future__ import annotations

import argparse
from collections import deque
import csv
import hashlib
from html.parser import HTMLParser
import json
import os
import re
import socket
import sys
import threading
import time
from datetime import datetime, timezone
import urllib.parse
import urllib.robotparser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any, Iterable

import requests
from jazzhr_public_board import board_url_for, parse_board_listing

UA = "TalentOS-JobIngest/1.0 (+https://talent.skarion.com)"
SOURCE = "talentos_employer_career"
ADAPTER_VERSION = "employer-career-ingest-v14"
DEFAULT_TRACKER = Path(__file__).resolve().parents[1] / "data" / "talentos-employer-careers" / "career_page_tracker.csv"
JSON_LD_RE = re.compile(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
JOB_PATH_RE = re.compile(r"(?:^|/)(?:job|jobs|career|careers|position|positions|opening|openings|vacancy|vacancies)(?:/|$)", re.I)
MAX_SITEMAPS = 100
MAX_JOB_URLS = 5000
TEAMTAILOR_PAGE_SIZE = 100
MAX_BODY_BYTES = 8_000_000
_robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}
_robots_lock = threading.Lock()
_host_locks: dict[str, threading.Lock] = {}
_host_lock_guard = threading.Lock()
_last_host_request: dict[str, float] = {}
_request_session_local = threading.local()


class ScrapeFailure(RuntimeError):
    pass


def _public_https_url(url: str) -> urllib.parse.ParseResult:
    p = urllib.parse.urlparse(url)
    if p.scheme.lower() != "https" or not p.hostname or p.username or p.password:
        raise ScrapeFailure("career source must be an HTTPS URL without embedded credentials")
    addresses: set[str] = set()
    dns_error: OSError | None = None
    for attempt in range(3):
        try:
            addresses = {x[4][0] for x in socket.getaddrinfo(p.hostname, p.port or 443, type=socket.SOCK_STREAM)}
            dns_error = None
            break
        except OSError as exc:
            dns_error = exc
            if attempt < 2:
                time.sleep(0.25 * (2 ** attempt))
    if dns_error is not None:
        raise ScrapeFailure(f"DNS lookup failed: {dns_error}") from dns_error
    import ipaddress
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ScrapeFailure("host resolves to a non-public address")
    return p


def _host_lock(host: str) -> threading.Lock:
    with _host_lock_guard:
        return _host_locks.setdefault(host, threading.Lock())


def _thread_session() -> requests.Session:
    """Reuse HTTP connections within a worker without sharing sessions across threads."""
    session = getattr(_request_session_local, "session", None)
    if session is None:
        session = requests.Session()
        _request_session_local.session = session
    return session


def _robots_parser(root: str) -> urllib.robotparser.RobotFileParser | None:
    with _robots_lock:
        if root in _robots:
            return _robots[root]
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(root + "/robots.txt")
    try:
        response = _request(root + "/robots.txt", check_robots=False, timeout=10)
        if response.status_code == 200:
            parser.parse(response.text.splitlines())
        elif response.status_code in (404, 410):
            # Robots Exclusion Protocol: an unavailable file has no rules.
            # This is an explicit policy choice; 401/403 and server errors
            # remain fail-closed below.
            parser.parse([])
        elif response.status_code in (401, 403):
            raise ScrapeFailure(f"robots.txt returned HTTP {response.status_code}; source held")
        else:
            raise ScrapeFailure(f"robots.txt returned HTTP {response.status_code}; policy is unknown")
    except Exception:
        parser = None
    with _robots_lock:
        _robots[root] = parser
    return parser


def _minimum_host_gap(rules: urllib.robotparser.RobotFileParser | None) -> float:
    """Honor a robots Crawl-delay directive, with a one-second default."""
    try:
        delay = float(rules.crawl_delay(UA) or 0) if rules else 0.0
    except (AttributeError, TypeError, ValueError):
        delay = 0.0
    return max(1.0, delay)


def _request(url: str, *, check_robots: bool = True, timeout: int = 10, session: requests.Session | None = None) -> requests.Response:
    current = url
    for _ in range(6):
        parsed = _public_https_url(current)
        root = f"https://{parsed.netloc}"
        rules = None
        if check_robots:
            rp = _robots_parser(root)
            if rp is None:
                raise ScrapeFailure("robots policy could not be checked; source held for review")
            if not rp.can_fetch(UA, current):
                raise ScrapeFailure("robots.txt disallows this URL")
            rules = rp
        lock = _host_lock(parsed.hostname or "")
        for attempt in range(3):
            try:
                with lock:
                    gap = _minimum_host_gap(rules) - (time.monotonic() - _last_host_request.get(parsed.hostname or "", 0.0))
                    if gap > 0:
                        time.sleep(gap)
                    requester = session if session is not None else _thread_session()
                    response = requester.get(current, headers={"User-Agent": UA, "Accept": "text/html,application/json,application/xml,text/xml,*/*;q=0.5"}, timeout=timeout, allow_redirects=False, stream=True)
                    _last_host_request[parsed.hostname or ""] = time.monotonic()
            except requests.RequestException:
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt)
                continue
            if (response.status_code == 429 or 500 <= response.status_code <= 599) and attempt < 2:
                retry_after = response.headers.get("Retry-After", "")
                response.close()
                try:
                    delay = min(20.0, max(1.0, float(retry_after)))
                except ValueError:
                    delay = float(2 ** attempt)
                time.sleep(delay)
                continue
            break
        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise ScrapeFailure("redirect response has no Location")
            current = urllib.parse.urljoin(current, location)
            continue
        body = response.raw.read(MAX_BODY_BYTES + 1, decode_content=True)
        response.close()
        if len(body) > MAX_BODY_BYTES:
            raise ScrapeFailure(f"response exceeds {MAX_BODY_BYTES} byte limit")
        response._content = body
        response._content_consumed = True
        return response
    raise ScrapeFailure("too many redirects")


def _text(value: Any) -> str | None:
    if isinstance(value, dict):
        value = value.get("name") or value.get("value")
    if value is None:
        return None
    clean = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", str(value)))).strip()
    return clean or None


def _clean_description(value: Any) -> str | None:
    if value is None: return None
    text = str(value)
    for _ in range(3):
        decoded = unescape(text)
        if decoded == text: break
        text = decoded
    text = re.sub(r"<\s*li\b[^>]*>", "\n- ", text, flags=re.I)
    text = re.sub(r"</\s*(p|div|h[1-6]|section|article|tr|blockquote)\s*>|<\s*br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    result = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return result or None


def _nodes(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, list):
        for item in value:
            yield from _nodes(item)
    elif isinstance(value, dict):
        if "@graph" in value:
            yield from _nodes(value["@graph"])
        else:
            yield value


class _JobPostingMicrodataParser(HTMLParser):
    """Collect schema.org JobPosting microdata properties from HTML."""

    _VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.frames: list[dict[str, Any]] = []
        self.current: dict[str, Any] | None = None
        self.jobs: list[dict[str, list[str]]] = []

    @staticmethod
    def _itemtype(attrs: dict[str, str | None]) -> bool:
        return "jobposting" in (attrs.get("itemtype") or "").lower()

    @staticmethod
    def _value(tag: str, attrs: dict[str, str | None]) -> str | None:
        for name in ("content", "datetime", "href", "src", "value"):
            value = attrs.get(name)
            if value:
                return value.strip()
        return None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        starts_job = self._itemtype(attrs)
        if starts_job:
            self.current = {}
        path = next((frame["path"] for frame in reversed(self.frames) if frame.get("path")), "")
        itemprop = (attrs.get("itemprop") or "").strip().split()
        prop = itemprop[0] if itemprop else None
        if prop and self.current is not None:
            path = f"{path}.{prop}" if path else prop
            value = self._value(tag, attrs)
            if value:
                self.current.setdefault(path, []).append(value)
        frame = {"tag": tag.lower(), "path": path if prop else None, "text": [], "job_root": starts_job}
        if tag.lower() not in self._VOID_TAGS:
            self.frames.append(frame)
        if starts_job and tag.lower() in self._VOID_TAGS:
            self.jobs.append(self.current or {})
            self.current = None

    def handle_data(self, data: str) -> None:
        if self.current is None or not data.strip():
            return
        for frame in self.frames:
            if frame.get("path"):
                frame["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        match_index = next((i for i in range(len(self.frames) - 1, -1, -1) if self.frames[i]["tag"] == tag), None)
        if match_index is None:
            return
        popped = self.frames[match_index:]
        del self.frames[match_index:]
        for frame in reversed(popped):
            if frame.get("path") and self.current is not None:
                value = re.sub(r"\s+", " ", " ".join(frame["text"])).strip()
                if value:
                    self.current.setdefault(frame["path"], []).append(value)
            if frame.get("job_root") and self.current is not None:
                self.jobs.append(self.current)
                self.current = None


def _microdata_postings(html: str, fallback_url: str, employer: str, seen: set[str]) -> list[dict[str, Any]]:
    parser = _JobPostingMicrodataParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return []
    found: list[dict[str, Any]] = []
    for props in parser.jobs:
        title = _text((props.get("title") or [None])[0])
        if not title:
            continue
        source_url = urllib.parse.urljoin(fallback_url, (props.get("url") or [fallback_url])[0])
        key = source_url.split("#", 1)[0]
        if key in seen:
            continue
        seen.add(key)
        loc_names = []
        for key_name in ("jobLocation.address.addressLocality", "jobLocation.address.addressRegion", "jobLocation.address.addressCountry", "jobLocation.name"):
            loc_names.extend(props.get(key_name) or [])
        location = ", ".join(dict.fromkeys(_text(value) for value in loc_names if _text(value))) or None
        employment_types = list(dict.fromkeys(_text(value) for value in props.get("employmentType", []) if _text(value)))
        external = (props.get("identifier.value") or props.get("identifier") or [""])[0].strip()
        description = _clean_description("\n".join(props.get("description") or []))
        found.append({
            "title": title,
            "company": _text((props.get("hiringOrganization.name") or [employer])[0]) or employer,
            "location": location,
            "source_url": key,
            "external_job_id": external or hashlib.sha256(key.lower().encode()).hexdigest()[:32],
            "description_text": description,
            "snippet": (description or "")[:300] or None,
            "raw": {
                "source": SOURCE,
                "structured_data_format": "microdata",
                "posted_at": (props.get("datePosted") or [None])[0],
                "valid_through": (props.get("validThrough") or [None])[0],
                "employment_type": ", ".join(employment_types) or None,
            },
        })
    return found


def extract_postings(html: str, fallback_url: str, employer: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    for block in JSON_LD_RE.findall(html):
        try:
            root = json.loads(unescape(block.strip()))
        except (json.JSONDecodeError, ValueError):
            continue
        for node in _nodes(root):
            typ = node.get("@type", [])
            types = typ if isinstance(typ, list) else [typ]
            if "JobPosting" not in types:
                continue
            title = _text(node.get("title"))
            if not title:
                continue
            url = urllib.parse.urljoin(fallback_url, str(node.get("url") or fallback_url))
            key = url.split("#", 1)[0]
            if key in seen:
                continue
            seen.add(key)
            org = node.get("hiringOrganization") if isinstance(node.get("hiringOrganization"), dict) else {}
            locs = node.get("jobLocation") or []
            locs = locs if isinstance(locs, list) else [locs]
            loc_names = []
            for loc in locs:
                address = loc.get("address", {}) if isinstance(loc, dict) else {}
                if isinstance(address, dict):
                    rendered = ", ".join(str(address.get(k)) for k in ("addressLocality", "addressRegion", "addressCountry") if address.get(k))
                    if rendered: loc_names.append(rendered)
            emp_type = node.get("employmentType")
            if isinstance(emp_type, list): emp_type = ", ".join(map(str, emp_type))
            external = str(node.get("identifier", {}).get("value") if isinstance(node.get("identifier"), dict) else "")
            external = external.strip() or hashlib.sha256(key.lower().encode()).hexdigest()[:32]
            description = _clean_description(node.get("description"))
            found.append({
                "title": title,
                "company": _text(org.get("name")) or employer,
                "location": "; ".join(dict.fromkeys(loc_names)) or None,
                "source_url": url,
                "external_job_id": external,
                "description_text": description,
                "snippet": (description or "")[:300] or None,
                "raw": {"source": SOURCE, "structured_data_format": "json-ld", "posted_at": node.get("datePosted"), "valid_through": node.get("validThrough"), "employment_type": emp_type, "occupational_category": node.get("occupationalCategory")},
            })
    found.extend(_microdata_postings(html, fallback_url, employer, seen))
    return found


def normalize_source_url(url: str) -> str:
    """Dedup routing only: lower host, drop fragment/trailing slash, keep query."""
    p = urllib.parse.urlparse(url.strip())
    path = p.path.rstrip("/") or "/"
    return urllib.parse.urlunparse((p.scheme.lower(), p.netloc.lower(), path, p.params, p.query, ""))


def namespace_job_id(job: dict[str, Any]) -> dict[str, Any]:
    """Prevent vendor-local requisition IDs colliding across employer boards."""
    external_id = str(job.get("external_job_id") or "").strip()
    if not external_id or external_id.startswith("career:"):
        return job
    raw = job.get("raw") if isinstance(job.get("raw"), dict) else {}
    source_url = str(job.get("source_url") or raw.get("career_source_url") or "")
    career_source_url = str(raw.get("career_source_url") or "")
    board_key = str(raw.get("career_source_board") or "")
    if not board_key:
        platform = _platform(source_url) or _platform(career_source_url)
        if platform:
            board_key = f"{platform[0]}:{platform[1]}"
        else:
            parsed = urllib.parse.urlparse(source_url)
            board_key = urllib.parse.urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/") or "/", parsed.params, "", ""))
    board_namespace = hashlib.sha256(board_key.encode()).hexdigest()[:16]
    job["external_job_id"] = f"career:{board_namespace}:{external_id}"
    return job


def _job_dedupe_key(job: dict[str, Any]) -> str:
    raw = job.get("raw") if isinstance(job.get("raw"), dict) else {}
    version = str(raw.get("adapter_version") or "legacy")
    key = "|".join((version, str(job.get("external_job_id") or ""), str(job.get("source_url") or ""))).lower()
    return hashlib.sha256(key.encode()).hexdigest()


def _platform(url: str) -> tuple[str, str] | None:
    p = urllib.parse.urlparse(url)
    host = (p.hostname or "").lower()
    parts = [urllib.parse.unquote(x) for x in p.path.split("/") if x]
    if host.endswith("greenhouse.io") and parts:
        return "greenhouse", parts[0]
    if host.endswith("lever.co") and parts:
        return "lever", parts[0]
    if host.endswith("ashbyhq.com") and parts:
        return "ashby", parts[0]
    if host.endswith("smartrecruiters.com") and parts:
        # The jobs domain may have /Company/job/ID, so ignore its detail path.
        # Public career sites can have a distinct second-segment sub-site slug;
        # preserve that in the board namespace to avoid ID collisions.
        board_key = parts[0]
        if host == "careers.smartrecruiters.com" and len(parts) > 1:
            board_key += "|" + parts[1]
        return "smartrecruiters", board_key
    if host == "apply.workable.com" and parts:
        return "workable", parts[0]
    if host.endswith(".workable.com") and host != "www.workable.com":
        return "workable", host.split(".")[0]
    if host.endswith(".recruitee.com"):
        return "recruitee", host.split(".")[0]
    if host.endswith(".pinpointhq.com"):
        tenant = host[: -len(".pinpointhq.com")]
        if tenant and "." not in tenant:
            return "pinpoint", tenant
    if host.endswith(".breezy.hr"):
        return "breezy", host[: -len(".breezy.hr")]
    if host.endswith(".teamtailor.com"):
        return "teamtailor", host
    personio_suffix = next((suffix for suffix in (".jobs.personio.de", ".jobs.personio.com") if host.endswith(suffix)), None)
    if personio_suffix:
        return "personio", host[: -len(personio_suffix)]
    if host.endswith(".bamboohr.com") and host != "www.bamboohr.com" and re.match(r"^/(?:careers|jobs)(?:/|$)", p.path, re.I):
        return "bamboohr", host[: -len(".bamboohr.com")]
    if host.endswith(".icims.com") and re.match(r"^/jobs(?:/|$)", p.path, re.I):
        return "icims", host[: -len(".icims.com")]
    if host.endswith(".applicantstack.com") and host != "www.applicantstack.com":
        return "applicantstack", host[: -len(".applicantstack.com")]
    if host.endswith(".applicantpro.com") and host != "www.applicantpro.com":
        return "applicantpro", host[: -len(".applicantpro.com")]
    if host.endswith(".applytojob.com"):
        return "jazzhr", host[: -len(".applytojob.com")]
    if host == "recruiting.paylocity.com":
        match = re.search(r"/(?:Recruiting/)?Jobs/All/([0-9a-f-]{36})(?:/|$)", p.path, re.I)
        if match:
            return "paylocity", match.group(1)
    if host == "ats.rippling.com":
        jobs_index = next((i for i, part in enumerate(parts) if part.lower() == "jobs"), -1)
        if jobs_index > 0:
            return "rippling", "/".join(parts[: jobs_index + 1])
    if host.endswith("myworkdayjobs.com") and parts:
        tenant = host.split(".")[0].split("-")[0]
        site_index = 1 if re.fullmatch(r"[a-z]{2}-[A-Z]{2}", parts[0]) and len(parts) > 1 else 0
        return "workday", f"{tenant}|{parts[site_index]}"
    if host.endswith(".taleo.net") and any(part.lower() == "careersection" for part in parts):
        section_index = next(i for i, part in enumerate(parts) if part.lower() == "careersection") + 1
        while section_index < len(parts) and parts[section_index].lower() == "careersection":
            section_index += 1
        if section_index < len(parts):
            section = parts[section_index]
            # University of Colorado's /cu_mob_sys/ route is the MOB portal.
            portal = "MOB" if section.lower() == "cu_mob_sys" else section
            return "taleo", portal
    return None


def _rippling_page_data(html: str, board_path: str) -> dict[str, Any]:
    match = re.search(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', html, re.I | re.S)
    if not match:
        raise ScrapeFailure("Rippling board page omitted its Next.js data")
    try:
        root = json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        raise ScrapeFailure(f"Rippling board page has invalid Next.js data: {exc}") from exc
    page_props = ((root.get("props") or {}).get("pageProps") or {}) if isinstance(root, dict) else {}
    state = page_props.get("dehydratedState") or {}
    queries = state.get("queries", []) if isinstance(state, dict) else []
    slug = board_path.rstrip("/").split("/")[-2]
    for query in queries if isinstance(queries, list) else []:
        if not isinstance(query, dict):
            continue
        query_key = query.get("queryKey")
        data = ((query.get("state") or {}).get("data") or {})
        if (
            isinstance(query_key, list)
            and len(query_key) >= 3
            and query_key[0] == "board"
            and query_key[1] == slug
            and query_key[2] == "job-posts"
            and isinstance(data, dict)
            and all(key in data for key in ("items", "page", "pageSize", "totalItems", "totalPages"))
        ):
            return data
    raise ScrapeFailure("Rippling Next.js data omitted the paginated job-posts result")


def _rippling_jobs(url: str, board_path: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read the public Rippling board pages and job-detail Next.js payloads."""
    root = f"https://ats.rippling.com/{board_path.strip('/')}"

    def fetch_page(page: int) -> dict[str, Any]:
        response = _request(root + "?" + urllib.parse.urlencode({"page": page}))
        if response.status_code != 200:
            raise ScrapeFailure(f"Rippling board page returned HTTP {response.status_code} (page {page})")
        return _rippling_page_data(response.text, board_path)

    first = fetch_page(0)
    try:
        total = int(first["totalItems"])
        page_size = int(first["pageSize"])
        total_pages = int(first["totalPages"])
        page = int(first["page"])
    except (TypeError, ValueError) as exc:
        raise ScrapeFailure("Rippling board omitted valid pagination totals") from exc
    if total < 0 or page_size <= 0 or total_pages < 0 or page != 0:
        raise ScrapeFailure("Rippling board returned invalid first-page pagination metadata")
    expected_pages = (total + page_size - 1) // page_size if total else total_pages
    if (total and total_pages != expected_pages) or (not total and total_pages not in (0, 1)):
        raise ScrapeFailure(f"Rippling totalPages={total_pages} does not match {total} items at pageSize={page_size}")

    listing_rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    notes: list[str] = []
    complete = True
    for page_index in range(total_pages):
        try:
            data = first if page_index == 0 else fetch_page(page_index)
            page_total = int(data.get("totalItems"))
            page_size_now = int(data.get("pageSize"))
            current_page = int(data.get("page"))
            rows = data.get("items")
        except (ScrapeFailure, TypeError, ValueError) as exc:
            complete = False
            notes.append(f"Rippling listing page {page_index} failed validation: {str(exc)[:140]}")
            break
        if page_total != total or page_size_now != page_size or current_page != page_index or not isinstance(rows, list):
            complete = False
            notes.append(f"Rippling pagination metadata changed or was invalid on page {page_index}")
            break
        expected_count = min(page_size, total - page_index * page_size)
        if len(rows) != expected_count:
            complete = False
            notes.append(f"Rippling page {page_index} returned {len(rows)} rows; expected {expected_count}")
            break
        for row in rows:
            if not isinstance(row, dict):
                complete = False
                notes.append(f"Rippling page {page_index} contained a non-object job")
                continue
            ident = str(row.get("id") or "").strip()
            if not ident or ident in seen_ids:
                complete = False
                notes.append(f"Rippling page {page_index} contained a missing or duplicate job ID")
                continue
            seen_ids.add(ident)
            listing_rows.append(row)
    if complete and len(listing_rows) != total:
        complete = False
        notes.append(f"Rippling listed {len(listing_rows)} unique jobs; pagination total was {total}")

    jobs: list[dict[str, Any]] = []
    board_url = root
    for row in listing_rows:
        title = _text(row.get("name"))
        job_url = str(row.get("url") or "").strip()
        if not title or not job_url:
            complete = False
            notes.append("Rippling job listing omitted its title or detail URL")
            continue
        parsed_job_url = urllib.parse.urlparse(job_url)
        board_prefix = "/" + board_path.strip("/") + "/"
        if parsed_job_url.scheme != "https" or parsed_job_url.hostname != "ats.rippling.com" or not parsed_job_url.path.startswith(board_prefix):
            complete = False
            notes.append("Rippling listing contained a detail URL outside its public board")
            continue
        details: dict[str, Any] = {}
        try:
            detail_response = _request(job_url)
            if detail_response.status_code != 200:
                raise ScrapeFailure(f"detail page returned HTTP {detail_response.status_code}")
            match = re.search(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', detail_response.text, re.I | re.S)
            if not match:
                raise ScrapeFailure("detail page omitted its Next.js data")
            detail_root = json.loads(match.group(1))
            details = (((detail_root.get("props") or {}).get("pageProps") or {}).get("apiData") or {})
            if not isinstance(details.get("jobPost"), dict):
                raise ScrapeFailure("detail page omitted jobPost data")
        except Exception as exc:
            complete = False
            notes.append(f"Rippling detail page failed: {job_url} ({str(exc)[:120]})")

        post = details.get("jobPost") if isinstance(details.get("jobPost"), dict) else {}
        description = post.get("description")
        if isinstance(description, dict):
            description = "\n\n".join(str(value) for value in description.values() if isinstance(value, str) and value.strip())
        description_text = _clean_description(description)
        locations = post.get("workLocations") or row.get("locations") or []
        if not isinstance(locations, list):
            locations = [locations]
        location = ", ".join(dict.fromkeys(text for value in locations if (text := _text(value)))) or None
        employment_type = post.get("employmentType")
        if isinstance(employment_type, dict):
            employment_type = employment_type.get("label") or employment_type.get("id")
        department = post.get("department") or row.get("department")
        if isinstance(department, dict):
            department = department.get("name") or department.get("base_department")
        company = _text(post.get("companyName")) or _text((details.get("jobBoard") or {}).get("companyName")) or employer
        jobs.append({
            "title": _text(post.get("name")) or title,
            "company": company,
            "location": location,
            "source_url": job_url,
            "external_job_id": str(post.get("uuid") or row.get("id") or ""),
            "description_text": description_text,
            "snippet": (description_text or "")[:300] or None,
            "raw": {
                "source": SOURCE,
                "ats": "rippling",
                "posted_at": post.get("createdOn"),
                "employment_type": employment_type,
                "department": department,
                "work_locations": locations,
                "board_url": board_url,
            },
        })
    return jobs, complete, list(dict.fromkeys(notes))


class _SmartRecruitersBoardParser(HTMLParser):
    """Extract server-rendered job cards and group counts from a public board page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.total_pages: int | None = None
        self.page: int | None = None
        self.more_url: str | None = None
        self.groups: list[dict[str, Any]] = []
        self.group: dict[str, Any] | None = None
        self.job: dict[str, Any] | None = None
        self.capture: str | None = None
        self.capture_text: list[str] = []

    @staticmethod
    def _classes(attrs: dict[str, str | None]) -> set[str]:
        return set((attrs.get("class") or "").split())

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        classes = self._classes(attrs)
        if tag == "div" and "js-openings-load" in classes:
            try:
                self.total_pages = int(attrs.get("data-groups-pages") or "")
                self.page = int(attrs.get("data-page") or "")
            except ValueError:
                self.total_pages = None
                self.page = None
            self.more_url = attrs.get("data-more")
        if tag == "section" and "js-group" in classes:
            try:
                expected = int(attrs.get("data-qty") or "")
            except ValueError:
                expected = None
            self.group = {"expected_count": expected, "location": "", "jobs": []}
            self.groups.append(self.group)
        if self.group and tag == "h3" and "opening-title" in classes:
            self.capture = "location"
            self.capture_text = []
        if self.group and tag == "a" and "js-job-ad-link" in classes:
            self.job = {"url": attrs.get("href") or "", "title": "", "employment_type": ""}
            self.group["jobs"].append(self.job)
        if self.job and tag == "h4" and "job-title" in classes:
            self.capture = "title"
            self.capture_text = []
        elif self.job and tag == "span" and "spl-me-1" in classes:
            self.capture = "employment_type"
            self.capture_text = []

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.capture_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "h3" and self.capture == "location" and self.group:
            self.group["location"] = re.sub(r"\s+", " ", " ".join(self.capture_text)).strip()
            self.capture = None
        elif tag == "h4" and self.capture == "title" and self.job:
            self.job["title"] = re.sub(r"\s+", " ", " ".join(self.capture_text)).strip()
            self.capture = None
        elif tag == "span" and self.capture == "employment_type" and self.job:
            self.job["employment_type"] = re.sub(r"\s+", " ", " ".join(self.capture_text)).strip()
            self.capture = None
        elif tag == "a" and self.job:
            self.job = None
        elif tag == "section" and self.group:
            self.group = None


def _parse_smartrecruiters_board(html: str) -> _SmartRecruitersBoardParser:
    parser = _SmartRecruitersBoardParser()
    try:
        parser.feed(html)
    except Exception as exc:
        raise ScrapeFailure(f"SmartRecruiters board HTML could not be parsed: {exc}") from exc
    return parser


def _smartrecruiters_board_url(url: str, company: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if host in ("jobs.smartrecruiters.com", "www.smartrecruiters.com"):
        path = "/" + urllib.parse.quote(company, safe="")
    else:
        path = parsed.path.rstrip("/") or "/" + urllib.parse.quote(company, safe="")
    return urllib.parse.urlunparse(("https", "careers.smartrecruiters.com", path, "", "", ""))


def _smartrecruiters_jobs(url: str, company: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Enumerate public SmartRecruiters HTML-board groups without the disallowed API host."""
    board_url = _smartrecruiters_board_url(url, company)
    first_response = _request(board_url)
    if first_response.status_code != 200:
        raise ScrapeFailure(f"SmartRecruiters public board returned HTTP {first_response.status_code}")
    first = _parse_smartrecruiters_board(first_response.text)
    if first.total_pages is None or first.page != 0 or first.total_pages < 1 or not first.more_url:
        raise ScrapeFailure("SmartRecruiters public board omitted valid group-page metadata")
    page_groups = [first.groups]
    notes: list[str] = []
    complete = True
    more_url = urllib.parse.urljoin(first_response.url, first.more_url)
    parsed_more_url = urllib.parse.urlparse(more_url)
    if parsed_more_url.scheme != "https" or parsed_more_url.hostname != "careers.smartrecruiters.com":
        raise ScrapeFailure("SmartRecruiters group pagination URL left the public career-board host")
    for page_index in range(1, first.total_pages):
        parsed_more = urllib.parse.urlparse(more_url)
        query = urllib.parse.parse_qsl(parsed_more.query, keep_blank_values=True)
        query = [(key, value) for key, value in query if key.lower() != "page"]
        query.append(("page", str(page_index)))
        page_url = urllib.parse.urlunparse(parsed_more._replace(query=urllib.parse.urlencode(query)))
        try:
            response = _request(page_url)
            if response.status_code != 200:
                raise ScrapeFailure(f"HTTP {response.status_code}")
            parsed = _parse_smartrecruiters_board(response.text)
            if not parsed.groups:
                raise ScrapeFailure("group page returned no job groups")
            page_groups.append(parsed.groups)
        except Exception as exc:
            complete = False
            notes.append(f"SmartRecruiters group page {page_index} failed: {str(exc)[:140]}")
            break

    jobs: list[dict[str, Any]] = []
    seen_urls: set[str] = set()
    for page_index, groups in enumerate(page_groups):
        for group in groups:
            rows = group.get("jobs") or []
            expected = group.get("expected_count")
            if expected is None or expected != len(rows):
                complete = False
                notes.append(f"SmartRecruiters group count mismatch on page {page_index}")
            for row in rows:
                job_url = str(row.get("url") or "").strip()
                title = _text(row.get("title"))
                parsed_job = urllib.parse.urlparse(job_url)
                if parsed_job.scheme != "https" or parsed_job.hostname != "jobs.smartrecruiters.com" or not title:
                    complete = False
                    notes.append(f"SmartRecruiters page {page_index} contained an invalid job card")
                    continue
                normalized_job_url = job_url.split("#", 1)[0]
                if normalized_job_url in seen_urls:
                    complete = False
                    notes.append("SmartRecruiters board repeated a job URL across groups/pages")
                    continue
                seen_urls.add(normalized_job_url)
                segments = [urllib.parse.unquote(part) for part in parsed_job.path.split("/") if part]
                external_id = segments[-1] if segments else hashlib.sha256(job_url.encode()).hexdigest()[:32]
                jobs.append({
                    "title": title,
                    "company": employer,
                    "location": _text(group.get("location")),
                    "source_url": normalized_job_url,
                    "external_job_id": external_id,
                    "description_text": None,
                    "snippet": None,
                    "raw": {"source": SOURCE, "ats": "smartrecruiters", "employment_type": _text(row.get("employment_type")), "board_url": board_url},
                })
    if complete and len(page_groups) != first.total_pages:
        complete = False
        notes.append(f"SmartRecruiters returned {len(page_groups)} of {first.total_pages} group pages")
    return jobs, complete, list(dict.fromkeys(notes))


def _pinpoint_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read Pinpoint's documented public career-site postings.json feed."""
    endpoint = f"https://{tenant}.pinpointhq.com/postings.json"
    response = _request(endpoint)
    if response.status_code != 200:
        raise ScrapeFailure(f"Pinpoint public postings feed returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except (ValueError, requests.RequestException) as exc:
        raise ScrapeFailure(f"Pinpoint public postings feed returned invalid JSON: {exc}") from exc
    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        raise ScrapeFailure("Pinpoint public postings feed omitted its data list")
    complete = len(rows) <= MAX_JOB_URLS
    notes: list[str] = []
    if not complete:
        notes.append(f"Pinpoint feed exceeded the {MAX_JOB_URLS}-posting safety cap")
    jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    for row in rows[:MAX_JOB_URLS]:
        if not isinstance(row, dict):
            complete = False
            notes.append("Pinpoint feed contained a non-object posting")
            continue
        title = _text(row.get("title"))
        job_id = str(row.get("id") or "").strip()
        job_url = str(row.get("url") or "").strip()
        parsed_url = urllib.parse.urlparse(job_url)
        if not title or not job_id or parsed_url.scheme != "https" or not parsed_url.hostname:
            complete = False
            notes.append("Pinpoint feed contained a posting missing its title, ID, or HTTPS URL")
            continue
        normalized_url = urllib.parse.urlunparse(parsed_url._replace(fragment=""))
        if job_id in seen_ids or normalized_url in seen_urls:
            complete = False
            notes.append("Pinpoint feed repeated a posting ID or URL")
            continue
        seen_ids.add(job_id)
        seen_urls.add(normalized_url)
        location = row.get("location")
        description_parts = [row.get("description"), row.get("key_responsibilities"), row.get("skills_knowledge_expertise"), row.get("benefits")]
        description = _clean_description("\n\n".join(str(part) for part in description_parts if isinstance(part, str) and part.strip()))
        department = row.get("department")
        if isinstance(department, dict):
            department = department.get("name")
        jobs.append({
            "title": title,
            "company": employer,
            "location": _text(location),
            "source_url": normalized_url,
            "external_job_id": job_id,
            "description_text": description,
            "snippet": (description or "")[:300] or None,
            "raw": {
                "source": SOURCE,
                "ats": "pinpoint",
                "requisition_id": str(row.get("requisition_id") or "") or None,
                "employment_type": row.get("employment_type_text") or row.get("employment_type"),
                "workplace_type": row.get("workplace_type_text") or row.get("workplace_type"),
                "department": department,
                "compensation": row.get("compensation"),
                "posted_at": row.get("published_at") or row.get("created_at"),
                "board_url": url,
            },
        })
    return jobs, complete, list(dict.fromkeys(notes))


def _breezy_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read Breezy's public career-board JSON and enrich from public job pages."""
    root = f"https://{tenant}.breezy.hr"
    response = _request(root + "/json")
    if response.status_code != 200:
        raise ScrapeFailure(f"Breezy public career feed returned HTTP {response.status_code}")
    try:
        rows = response.json()
    except (ValueError, requests.RequestException) as exc:
        raise ScrapeFailure(f"Breezy public career feed returned invalid JSON: {exc}") from exc
    if not isinstance(rows, list):
        raise ScrapeFailure("Breezy public career feed did not return a list")
    complete = len(rows) <= MAX_JOB_URLS
    notes: list[str] = []
    if not complete:
        notes.append(f"Breezy feed exceeded the {MAX_JOB_URLS}-posting safety cap")
    jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    for row in rows[:MAX_JOB_URLS]:
        if not isinstance(row, dict):
            complete = False
            notes.append("Breezy feed contained a non-object posting")
            continue
        job_id = str(row.get("id") or "").strip()
        title = _text(row.get("name"))
        job_url = str(row.get("url") or "").strip()
        parsed = urllib.parse.urlparse(job_url)
        if not job_id or not title or parsed.scheme != "https" or parsed.hostname != urllib.parse.urlparse(root).hostname:
            complete = False
            notes.append("Breezy feed contained a posting missing its ID, title, or same-board HTTPS URL")
            continue
        job_url = urllib.parse.urlunparse(parsed._replace(fragment=""))
        if job_id in seen_ids or job_url in seen_urls:
            complete = False
            notes.append("Breezy feed repeated a posting ID or URL")
            continue
        seen_ids.add(job_id)
        seen_urls.add(job_url)
        description = None
        try:
            detail = _request(job_url, timeout=15)
            if detail.status_code != 200:
                raise ScrapeFailure(f"detail returned HTTP {detail.status_code}")
            detail_jobs = extract_postings(detail.text, detail.url, employer)
            if detail_jobs:
                description = detail_jobs[0].get("description_text")
            else:
                html_job = extract_html_job(detail.text, detail.url, employer)
                if html_job:
                    description = html_job.get("description_text")
        except Exception as exc:
            complete = False
            notes.append(f"Breezy detail failed for {job_id}: {str(exc)[:120]}")
        location = row.get("location") if isinstance(row.get("location"), dict) else {}
        location_name = _text(location.get("name"))
        if not location_name:
            location_name = ", ".join(dict.fromkeys(
                part for value in (location.get("city"), location.get("state", {}).get("name") if isinstance(location.get("state"), dict) else None, location.get("country", {}).get("name") if isinstance(location.get("country"), dict) else None)
                if (part := _text(value))
            )) or None
        company = row.get("company") if isinstance(row.get("company"), dict) else {}
        jobs.append({
            "title": title,
            "company": _text(company.get("name")) or employer,
            "location": location_name,
            "source_url": job_url,
            "external_job_id": job_id,
            "description_text": description,
            "snippet": (description or "")[:300] or None,
            "raw": {
                "source": SOURCE,
                "ats": "breezy",
                "posted_at": row.get("published_date"),
                "department": row.get("department"),
                "employment_type": _text(row.get("type")),
                "salary": row.get("salary"),
                "workplace_type": location.get("remote_details", {}).get("label") if isinstance(location.get("remote_details"), dict) else None,
                "board_url": url,
            },
        })
    return jobs, complete, list(dict.fromkeys(notes))


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _xml_text(element: ET.Element, path: str) -> str | None:
    child = element.find(path)
    if child is None:
        return None
    return _text("".join(child.itertext()))


def _personio_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read Personio's documented public career-site XML positions feed."""
    host = urllib.parse.urlparse(url).hostname or f"{tenant}.jobs.personio.de"
    endpoint = f"https://{host}/xml?language=en"
    response = _request(endpoint)
    if response.status_code != 200:
        raise ScrapeFailure(f"Personio XML career feed returned HTTP {response.status_code}")
    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as exc:
        raise ScrapeFailure(f"Personio XML career feed was invalid: {exc}") from exc
    positions = [element for element in root.iter() if _local_name(element.tag) == "position"]
    if len(positions) > MAX_JOB_URLS:
        return [], False, [f"Personio feed exceeded the {MAX_JOB_URLS}-posting safety cap"]
    jobs: list[dict[str, Any]] = []
    complete = True
    notes: list[str] = []
    seen_ids: set[str] = set()
    for position in positions:
        job_id = _xml_text(position, "id")
        title = _xml_text(position, "name")
        if not job_id or not title or job_id in seen_ids:
            complete = False
            notes.append("Personio feed contained a missing title/ID or duplicate ID")
            continue
        seen_ids.add(job_id)
        description_values = []
        for element in position.iter():
            if _local_name(element.tag) == "value":
                value = _text("".join(element.itertext()))
                if value:
                    description_values.append(value)
        description = _clean_description("\n\n".join(description_values))
        job_url = f"https://{host}/job/{urllib.parse.quote(job_id, safe='')}"
        jobs.append({
            "title": title,
            "company": _xml_text(position, "subcompany") or employer,
            "location": _xml_text(position, "office"),
            "source_url": job_url,
            "external_job_id": job_id,
            "description_text": description,
            "snippet": (description or "")[:300] or None,
            "raw": {
                "source": SOURCE,
                "ats": "personio",
                "posted_at": _xml_text(position, "createdAt"),
                "department": _xml_text(position, "department"),
                "recruiting_category": _xml_text(position, "recruitingCategory"),
                "employment_type": _xml_text(position, "employmentType"),
                "schedule": _xml_text(position, "schedule"),
                "seniority": _xml_text(position, "seniority"),
                "board_url": url,
            },
        })
    return jobs, complete, list(dict.fromkeys(notes))


def _rss_child(element: ET.Element, name: str) -> str | None:
    for child in list(element):
        if _local_name(child.tag) == name.lower():
            return _text("".join(child.itertext()))
    return None


def _teamtailor_jobs(url: str, board_host: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read Teamtailor's documented public RSS feed with offset pagination."""
    host = board_host.lower()
    if not host.endswith(".teamtailor.com"):
        raise ScrapeFailure("Teamtailor public RSS adapter requires a hosted Teamtailor board")
    root = f"https://{host}"
    page_size = TEAMTAILOR_PAGE_SIZE
    offset = 0
    jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    notes: list[str] = []
    complete = True
    while offset <= MAX_JOB_URLS:
        feed_url = root + "/jobs.rss?" + urllib.parse.urlencode({"offset": offset, "per_page": page_size})
        response = _request(feed_url)
        if response.status_code != 200:
            raise ScrapeFailure(f"Teamtailor public RSS feed returned HTTP {response.status_code}")
        try:
            xml_root = ET.fromstring(response.content)
        except ET.ParseError as exc:
            raise ScrapeFailure(f"Teamtailor RSS feed was invalid: {exc}") from exc
        channel = next((node for node in xml_root.iter() if _local_name(node.tag) == "channel"), None)
        items = [child for child in (list(channel) if channel is not None else []) if _local_name(child.tag) == "item"]
        if len(items) > page_size:
            complete = False
            notes.append("Teamtailor RSS page exceeded its requested page size")
        for item in items:
            title = _rss_child(item, "title")
            job_url = _rss_child(item, "link")
            external_id = _rss_child(item, "guid")
            parsed = urllib.parse.urlparse(job_url or "")
            if not title or parsed.scheme != "https" or parsed.hostname != host:
                complete = False
                notes.append("Teamtailor feed contained a posting missing its title or same-board HTTPS URL")
                continue
            normalized_url = urllib.parse.urlunparse(parsed._replace(fragment=""))
            external_id = (external_id or normalized_url).strip()
            if external_id in seen_ids or normalized_url in seen_urls:
                complete = False
                notes.append("Teamtailor feed repeated a posting ID or URL across pages")
                continue
            seen_ids.add(external_id)
            seen_urls.add(normalized_url)
            description = _clean_description(_rss_child(item, "description"))
            jobs.append({
                "title": title,
                "company": employer,
                "location": _rss_child(item, "locations"),
                "source_url": normalized_url,
                "external_job_id": external_id,
                "description_text": description,
                "snippet": (description or "")[:300] or None,
                "raw": {
                    "source": SOURCE,
                    "ats": "teamtailor",
                    "posted_at": _rss_child(item, "pubDate"),
                    "workplace_type": _rss_child(item, "remoteStatus"),
                    "department": _rss_child(item, "department"),
                    "role": _rss_child(item, "role"),
                    "division": _rss_child(item, "division"),
                    "board_url": url,
                },
            })
        if len(items) < page_size:
            return jobs, complete, list(dict.fromkeys(notes))
        offset += len(items)
    return jobs, False, [*notes, f"Teamtailor feed exceeded the {MAX_JOB_URLS}-posting safety cap"]


def _bamboohr_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read public BambooHR career-board JSON and its same-host job details."""
    root = f"https://{tenant}.bamboohr.com"
    response = _request(root + "/careers/list")
    if response.status_code != 200:
        raise ScrapeFailure(f"BambooHR public career list returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except (ValueError, requests.RequestException) as exc:
        raise ScrapeFailure(f"BambooHR public career list returned invalid JSON: {exc}") from exc
    rows = payload.get("result") if isinstance(payload, dict) else None
    meta = payload.get("meta") if isinstance(payload, dict) else None
    total = meta.get("totalCount") if isinstance(meta, dict) else None
    if not isinstance(rows, list) or not isinstance(total, int):
        raise ScrapeFailure("BambooHR public career list omitted its result list or totalCount")
    complete = len(rows) == total and total <= MAX_JOB_URLS
    notes: list[str] = []
    if len(rows) != total:
        notes.append(f"BambooHR returned {len(rows)} of {total} listed jobs")
    if total > MAX_JOB_URLS:
        notes.append(f"BambooHR list exceeded the {MAX_JOB_URLS}-posting safety cap")
    jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for row in rows[:MAX_JOB_URLS]:
        if not isinstance(row, dict):
            complete = False
            notes.append("BambooHR career list contained a non-object job")
            continue
        job_id = str(row.get("id") or "").strip()
        if not job_id or job_id in seen_ids:
            complete = False
            notes.append("BambooHR career list contained a missing or duplicate job ID")
            continue
        seen_ids.add(job_id)
        title = _text(row.get("jobOpeningName"))
        if not title:
            complete = False
            notes.append(f"BambooHR listing {job_id} omitted its title")
            continue
        detail_url = f"{root}/careers/{urllib.parse.quote(job_id, safe='')}/detail"
        try:
            detail_response = _request(detail_url, timeout=15)
            if detail_response.status_code != 200:
                raise ScrapeFailure(f"detail returned HTTP {detail_response.status_code}")
            detail_payload = detail_response.json()
            detail_result = detail_payload.get("result") if isinstance(detail_payload, dict) else None
            posting = detail_result.get("jobOpening") if isinstance(detail_result, dict) else None
            if not isinstance(posting, dict):
                raise ScrapeFailure("detail omitted jobOpening")
            posting_status = str(posting.get("jobOpeningStatus") or "").strip().lower()
            if posting_status and posting_status != "open":
                complete = False
                notes.append(f"BambooHR listing {job_id} was no longer open at detail fetch")
                continue
        except Exception as exc:
            complete = False
            notes.append(f"BambooHR detail failed for {job_id}: {str(exc)[:120]}")
            posting = {}
        location_obj = posting.get("location") or row.get("location") or {}
        if not isinstance(location_obj, dict):
            location_obj = {}
        location = ", ".join(dict.fromkeys(
            part for value in (location_obj.get("city"), location_obj.get("state"), location_obj.get("addressCountry"))
            if (part := _text(value))
        )) or None
        share_url = str(posting.get("jobOpeningShareUrl") or f"{root}/careers/{job_id}").strip()
        parsed_share = urllib.parse.urlparse(share_url)
        if parsed_share.scheme != "https" or parsed_share.hostname != urllib.parse.urlparse(root).hostname:
            complete = False
            notes.append(f"BambooHR detail for {job_id} contained a non-board job URL")
            share_url = f"{root}/careers/{urllib.parse.quote(job_id, safe='')}"
        description = _clean_description(posting.get("description"))
        department = posting.get("departmentLabel") or row.get("departmentLabel")
        employment_type = posting.get("employmentStatusLabel") or row.get("employmentStatusLabel") or posting.get("employmentType")
        jobs.append({
            "title": _text(posting.get("jobOpeningName")) or title,
            "company": employer,
            "location": location,
            "source_url": share_url,
            "external_job_id": job_id,
            "description_text": description,
            "snippet": (description or "")[:300] or None,
            "raw": {
                "source": SOURCE,
                "ats": "bamboohr",
                "posted_at": posting.get("datePosted"),
                "department": department,
                "employment_type": employment_type,
                "minimum_experience": posting.get("minimumExperience"),
                "compensation": posting.get("compensation"),
                "board_url": url,
            },
        })
    return jobs, complete, list(dict.fromkeys(notes))


class _ICIMSListingParser(HTMLParser):
    """Read job-card anchors from a server-rendered public iCIMS result page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self.current: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attrs = dict(attrs_list)
        href = attrs.get("href") or ""
        if re.search(r"/jobs/\d+/.+/job(?:/|$)", urllib.parse.urlparse(href).path, re.I):
            self.current = {"url": href, "text": []}

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.current is not None:
            title = re.sub(r"\s+", " ", " ".join(self.current["text"])).strip()
            self.links.append((str(self.current["url"]), title))
            self.current = None


def _parse_icims_page(html: str) -> tuple[int | None, int | None, list[tuple[str, str]]]:
    match = re.search(r"\bPage\s+(\d+)\s+of\s+(\d+)\b", html, re.I)
    current_page = total_pages = None
    if match:
        current_page, total_pages = int(match.group(1)), int(match.group(2))
    parser = _ICIMSListingParser()
    parser.feed(html)
    return current_page, total_pages, parser.links


def _icims_page_explicitly_empty(html: str) -> bool:
    visible = re.sub(r"<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>", " ", html, flags=re.I | re.S)
    text = re.sub(r"<[^>]+>", " ", visible)
    text = re.sub(r"\s+", " ", unescape(text)).strip().lower()
    return any(phrase in text for phrase in (
        "sorry, no jobs were found that match your search criteria",
        "no jobs were found",
        "no job openings are available",
        "no positions are currently available",
    ))


def _icims_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Enumerate public iCIMS HTML search pages and fetch each listed job page."""
    host = f"careers-{tenant}.icims.com" if not tenant.startswith("careers-") else f"{tenant}.icims.com"
    # Some customer portals use a nonstandard subdomain. The detected source
    # host is authoritative; tenant is only used as a fallback for explicit
    # iCIMS links.
    source_host = urllib.parse.urlparse(url).hostname or host
    root = f"https://{source_host}"
    search_url = root + "/jobs/search?ss=1&in_iframe=1"
    first = _request(search_url, timeout=20)
    if first.status_code != 200:
        raise ScrapeFailure(f"iCIMS public search page returned HTTP {first.status_code}")
    current_page, total_pages, first_links = _parse_icims_page(first.text)
    if total_pages is None and not first_links and _icims_page_explicitly_empty(first.text):
        return [], True, []
    if total_pages is None or current_page != 1 or total_pages < 1:
        raise ScrapeFailure("iCIMS search page omitted a valid page-count indicator")
    if total_pages > MAX_JOB_URLS:
        raise ScrapeFailure(f"iCIMS search page count exceeded the {MAX_JOB_URLS}-page safety cap")
    page_links = [first_links]
    notes: list[str] = []
    complete = True
    for page_index in range(1, total_pages):
        page_url = root + "/jobs/search?ss=1&in_iframe=1&pr=" + str(page_index)
        try:
            response = _request(page_url, timeout=20)
            if response.status_code != 200:
                raise ScrapeFailure(f"HTTP {response.status_code}")
            seen_page, seen_total, links = _parse_icims_page(response.text)
            if seen_page != page_index + 1 or seen_total != total_pages or not links:
                raise ScrapeFailure("page indicator or job-card list did not match the board pagination")
            page_links.append(links)
        except Exception as exc:
            complete = False
            notes.append(f"iCIMS result page {page_index + 1} failed: {str(exc)[:130]}")
            break
    card_rows: list[tuple[str, str]] = []
    seen_job_urls: set[str] = set()
    seen_ids: set[str] = set()
    for links in page_links:
        for href, card_title in links:
            job_url = urllib.parse.urljoin(search_url, href)
            parsed = urllib.parse.urlparse(job_url)
            id_match = re.search(r"/jobs/(\d+)/", parsed.path, re.I)
            if parsed.scheme != "https" or parsed.hostname != source_host or not id_match or not card_title:
                complete = False
                notes.append("iCIMS search page contained an invalid job card")
                continue
            job_id = id_match.group(1)
            normalized = urllib.parse.urlunparse(parsed._replace(fragment=""))
            if normalized in seen_job_urls or job_id in seen_ids:
                complete = False
                notes.append("iCIMS search pages repeated a job ID or URL")
                continue
            seen_job_urls.add(normalized)
            seen_ids.add(job_id)
            card_rows.append((normalized, card_title))
    if not card_rows and total_pages > 0:
        raise ScrapeFailure("iCIMS search reported pages but no job cards were found")
    if len(card_rows) > MAX_JOB_URLS:
        return [], False, [f"iCIMS job count exceeded the {MAX_JOB_URLS}-posting safety cap"]
    jobs: list[dict[str, Any]] = []
    for job_url, card_title in card_rows:
        try:
            detail = _request(job_url, timeout=20)
            if detail.status_code != 200:
                raise ScrapeFailure(f"detail returned HTTP {detail.status_code}")
            postings = extract_postings(detail.text, detail.url, employer)
            if postings:
                job = postings[0]
                detail_host = urllib.parse.urlparse(job.get("source_url") or "").hostname
                if detail_host != source_host:
                    complete = False
                    notes.append(f"iCIMS posting {job_url} had an external JSON-LD URL")
                    job["source_url"] = job_url
                job["title"] = _text(job.get("title")) or card_title
                jobs.append(job)
            else:
                complete = False
                notes.append(f"iCIMS detail omitted JobPosting JSON-LD: {job_url}")
        except Exception as exc:
            complete = False
            notes.append(f"iCIMS detail failed: {job_url} ({str(exc)[:130]})")
    return jobs, complete, list(dict.fromkeys(notes))


def _api_jobs(url: str, platform: tuple[str, str], employer: str) -> list[dict[str, Any]]:
    kind, token = platform
    if kind == "greenhouse":
        endpoint = f"https://boards-api.greenhouse.io/v1/boards/{urllib.parse.quote(token, safe='')}/jobs?content=true"
        resp = _request(endpoint)
        data = resp.json()
        rows = data.get("jobs", []) if isinstance(data, dict) else []
        total = data.get("meta", {}).get("total") if isinstance(data, dict) and isinstance(data.get("meta"), dict) else None
        if not isinstance(total, int):
            raise ScrapeFailure("Greenhouse API omitted its total-count metadata; completeness cannot be verified")
        if len(rows) != total:
            raise ScrapeFailure(f"Greenhouse API returned {len(rows)} of {total} jobs")
        output = []
        for j in rows:
            title = _text(j.get("title"))
            if title:
                description = _clean_description(j.get("content"))
                output.append({"title": title, "company": employer, "location": _text((j.get("location") or {}).get("name")), "source_url": j.get("absolute_url") or url, "external_job_id": str(j.get("id") or ""), "description_text": description, "snippet": (description or "")[:300] or None, "raw": {"source": SOURCE, "ats": kind, "posted_at": j.get("updated_at")}})
        return output
    if kind == "lever":
        output: list[dict[str, Any]] = []
        limit = 100
        offset = 0
        while offset < 100000:
            resp = _request(f"https://api.lever.co/v0/postings/{urllib.parse.quote(token, safe='')}?mode=json&limit={limit}&skip={offset}")
            rows = resp.json()
            if not isinstance(rows, list):
                raise ScrapeFailure("Lever API returned a non-list postings response")
            output.extend({"title": _text(j.get("text")), "company": employer, "location": _text((j.get("categories") or {}).get("location")), "source_url": j.get("hostedUrl") or url, "external_job_id": str(j.get("id") or ""), "description_text": _clean_description(j.get("descriptionPlain") or j.get("description")), "raw": {"source": SOURCE, "ats": kind, "posted_at": j.get("createdAt"), "employment_type": (j.get("categories") or {}).get("commitment")}} for j in rows if _text(j.get("text")))
            offset += len(rows)
            if len(rows) < limit:
                return output
        raise ScrapeFailure("Lever API exceeded the 100000-posting safety cap; completeness cannot be verified")
    if kind == "ashby":
        resp = _request(f"https://api.ashbyhq.com/posting-api/job-board/{urllib.parse.quote(token, safe='')}?includeCompensation=true")
        data = resp.json(); rows = data.get("jobs", []) if isinstance(data, dict) else []
        return [{"title": _text(j.get("title")), "company": employer, "location": _text(j.get("location")), "source_url": j.get("jobUrl") or url, "external_job_id": str(j.get("jobId") or j.get("id") or ""), "description_text": _clean_description(j.get("descriptionHtml") or j.get("descriptionPlain")), "raw": {"source": SOURCE, "ats": kind, "posted_at": j.get("publishedDate"), "employment_type": j.get("employmentType")}} for j in rows if _text(j.get("title"))]
    if kind == "smartrecruiters":
        raise ScrapeFailure("SmartRecruiters API host is robots-disallowed; use its public career-board pagination adapter")
    if kind == "workable":
        endpoint = f"https://www.workable.com/api/accounts/{urllib.parse.quote(token, safe='')}?details=true"
        response = _request(endpoint)
        data = response.json()
        rows = data.get("jobs", []) if isinstance(data, dict) else []
        return [{"title": _text(j.get("title")), "company": _text(data.get("name")) or employer, "location": ", ".join(str(x) for x in (j.get("city"), j.get("state"), j.get("country")) if x) or None, "source_url": j.get("application_url") or j.get("url") or url, "external_job_id": str(j.get("shortcode") or j.get("code") or j.get("id") or ""), "description_text": _clean_description(j.get("description")), "raw": {"source": SOURCE, "ats": kind, "posted_at": j.get("published_on"), "employment_type": j.get("employment_type"), "workplace_type": j.get("workplace_type")}} for j in rows if _text(j.get("title"))]
    if kind == "recruitee":
        endpoint = f"https://{urllib.parse.quote(token, safe='')}.recruitee.com/api/offers"
        response = _request(endpoint)
        data = response.json()
        rows = data.get("offers", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
        return [{"title": _text(j.get("title")), "company": employer, "location": _text(j.get("location")), "source_url": j.get("careers_url") or j.get("url") or url, "external_job_id": str(j.get("id") or j.get("slug") or ""), "description_text": _clean_description(j.get("description")), "raw": {"source": SOURCE, "ats": kind, "posted_at": j.get("created_at"), "employment_type": j.get("employment_type")}} for j in rows if _text(j.get("title"))]
    if kind == "paylocity":
        response = _request(f"https://recruiting.paylocity.com/recruiting/v2/api/feed/jobs/{urllib.parse.quote(token, safe='')}")
        data = response.json()
        rows = data.get("jobs", []) if isinstance(data, dict) else []
        return [{
            "title": _text(j.get("title")), "company": _text(j.get("companyName")) or _text(data.get("displayName")) or employer,
            "location": _text(j.get("jobLocation")),
            "source_url": j.get("displayUrl") or j.get("applyUrl") or url, "external_job_id": str(j.get("jobId") or ""),
            "description_text": _clean_description(j.get("description")),
            "raw": {"source": SOURCE, "ats": kind, "posted_at": j.get("publishedDate") or j.get("createdUtc"), "employment_type": j.get("jobTypes") or j.get("jobTypesArray"), "salary_description": j.get("salaryDescription"), "requirements": _text(j.get("requirements"))},
        } for j in rows if _text(j.get("title"))]
    if kind == "workday":
        tenant, site = token.split("|", 1)
        host = urllib.parse.urlparse(url).hostname or ""
        api_root = f"https://{host}/wday/cxs/{urllib.parse.quote(tenant, safe='')}/{urllib.parse.quote(site, safe='')}"
        output: list[dict[str, Any]] = []
        offset = 0
        expected_total: int | None = None
        fetched_count = 0
        while offset < 100000:
            request = requests.Request("POST", api_root + "/jobs", json={"limit": 20, "offset": offset, "searchText": "", "appliedFacets": {}}).prepare()
            response = _request_post(request.url or "", request.body or "{}")
            data = response.json()
            rows = data.get("jobPostings", []) if isinstance(data, dict) else []
            for job in rows:
                title = _text(job.get("title")); external = str(job.get("bulletFields", [""])[0] if job.get("bulletFields") else "")
                if title:
                    detail_url = urllib.parse.urljoin(url, str(job.get("externalPath") or ""))
                    output.append({"title": title, "company": employer, "location": _text(job.get("locationsText")), "source_url": detail_url or url, "external_job_id": external or hashlib.sha256((detail_url or title).lower().encode()).hexdigest()[:32], "description_text": _clean_description(job.get("jobDescription")), "raw": {"source": SOURCE, "ats": kind, "posted_at": job.get("postedOn"), "employment_type": job.get("timeType")}})
            total = data.get("total") if isinstance(data, dict) else None
            try:
                total = int(total)
            except (TypeError, ValueError):
                raise ScrapeFailure("Workday API omitted its total-count metadata; completeness cannot be verified")
            if expected_total is None:
                expected_total = total
            elif total > 0 and expected_total != total:
                raise ScrapeFailure(f"Workday total changed during pagination ({expected_total} to {total})")
            if total < 0:
                raise ScrapeFailure("Workday returned a negative job total")
            if not rows:
                if fetched_count != expected_total:
                    raise ScrapeFailure(f"Workday ended at {fetched_count} of {expected_total} postings")
                return output
            fetched_count += len(rows)
            if fetched_count > expected_total:
                raise ScrapeFailure(f"Workday returned more than its initial total of {expected_total} postings")
            offset += len(rows)
            if fetched_count == expected_total:
                return output
        raise ScrapeFailure("Workday exceeded the 100000-posting safety cap; completeness cannot be verified")
    raise ScrapeFailure("ATS adapter not implemented")


def _request_post(url: str, body: str, *, timeout: int = 15) -> requests.Response:
    """POST a read-only Workday search request after the same host/robots checks."""
    parsed = _public_https_url(url)
    root = f"https://{parsed.netloc}"
    rp = _robots_parser(root)
    if rp is None or not rp.can_fetch(UA, url):
        raise ScrapeFailure("robots policy blocks or could not validate the ATS job-search endpoint")
    with _host_lock(parsed.hostname or "") as lock:
        for attempt in range(3):
            try:
                gap = _minimum_host_gap(rp) - (time.monotonic() - _last_host_request.get(parsed.hostname or "", 0.0))
                if gap > 0: time.sleep(gap)
                response = requests.post(url, data=body, headers={"User-Agent": UA, "Accept": "application/json", "Content-Type": "application/json"}, timeout=timeout, allow_redirects=False)
                _last_host_request[parsed.hostname or ""] = time.monotonic()
            except requests.RequestException:
                if attempt == 2: raise
                time.sleep(2 ** attempt)
                continue
            if (response.status_code == 429 or 500 <= response.status_code <= 599) and attempt < 2:
                retry_after = response.headers.get("Retry-After", "")
                response.close()
                try:
                    delay = min(20.0, max(1.0, float(retry_after)))
                except ValueError:
                    delay = float(2 ** attempt)
                time.sleep(delay)
                continue
            break
    if 300 <= response.status_code < 400:
        raise ScrapeFailure("Workday API redirected; adapter needs review")
    response.raise_for_status()
    if len(response.content) > MAX_BODY_BYTES:
        raise ScrapeFailure(f"response exceeds {MAX_BODY_BYTES} byte limit")
    return response


def _xml_locations(body: bytes) -> tuple[list[str], bool]:
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise ScrapeFailure(f"invalid sitemap XML: {exc}") from exc
    ns = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    is_index = root.tag.endswith("sitemapindex")
    tag = "sm:sitemap/sm:loc" if is_index else "sm:url/sm:loc"
    return [x.text.strip() for x in root.findall(tag, ns) if x.text and x.text.strip()], is_index


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in ("script", "style", "noscript"):
            self.skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in ("script", "style", "noscript") and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and data.strip():
            self.parts.append(data.strip())


def _applicantpro_board_count(html: str) -> int | None:
    parser = _VisibleTextParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return None
    visible = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    patterns = (
        r"\b(?:showing|displaying)\s+\d+\s*(?:-|–|to)\s*\d+\s+of\s+(\d+)\b",
        r"\b(?:total|current)\s+(?:open\s+)?(?:jobs?|openings?|positions?)\s*[:=-]?\s*(\d+)\b",
        r"\b(\d+)\s+(?:open\s+)?(?:jobs?|openings?|positions?)\b",
    )
    counts = {int(match) for pattern in patterns for match in re.findall(pattern, visible, re.I)}
    return next(iter(counts)) if len(counts) == 1 else None


def _applicantpro_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read the tenant's public sitemap and reconcile it with the visible board total."""
    root = f"https://{tenant}.applicantpro.com"
    sitemap = _request(root + "/job_site_map.xml")
    if sitemap.status_code != 200:
        raise ScrapeFailure(f"ApplicantPro tenant sitemap returned HTTP {sitemap.status_code}")
    locations, is_index = _xml_locations(sitemap.content)
    if is_index or not locations:
        raise ScrapeFailure("ApplicantPro tenant sitemap was not a non-empty URL set")
    complete = True
    notes: list[str] = []
    posting_urls: dict[str, str] = {}
    for loc in locations:
        parsed = urllib.parse.urlparse(loc)
        match = re.fullmatch(r"/openings/([^/]+)/jobs/([^/]+)/?", parsed.path, re.I)
        if parsed.scheme.lower() != "https" or parsed.hostname != "www.applicantpro.com" or not match:
            # Each verified sitemap also contains one base board URL.
            if parsed.hostname == "www.applicantpro.com" and re.fullmatch(r"/openings/[^/]+/jobs/?", parsed.path, re.I):
                continue
            complete = False
            notes.append("ApplicantPro sitemap contained a URL outside the validated public posting route")
            continue
        if match.group(1).lower() != tenant.lower():
            complete = False
            notes.append("ApplicantPro sitemap posting tenant did not match the source board")
            continue
        job_id = match.group(2)
        if job_id in posting_urls:
            complete = False
            notes.append("ApplicantPro sitemap repeated a posting ID")
            continue
        posting_urls[job_id] = urllib.parse.urlunparse(("https", parsed.netloc, parsed.path, "", parsed.query, ""))
    board = _request(root + "/jobs/")
    if board.status_code != 200:
        complete = False
        notes.append(f"ApplicantPro public board returned HTTP {board.status_code}")
        expected_count = None
    else:
        expected_count = _applicantpro_board_count(board.text)
        if expected_count is None:
            notes.append("ApplicantPro board total was not present in static HTML; completeness relies on the tenant sitemap and fetched detail pages")
        elif expected_count != len(posting_urls):
            complete = False
            notes.append(f"ApplicantPro board count {expected_count} did not match {len(posting_urls)} sitemap postings")
    jobs: list[dict[str, Any]] = []
    for job_id, job_url in posting_urls.items():
        try:
            detail = _request(job_url, timeout=12)
            if detail.status_code != 200:
                raise ScrapeFailure(f"HTTP {detail.status_code}")
            extracted = extract_postings(detail.text, detail.url, employer)
            if not extracted:
                heuristic = extract_html_job(detail.text, detail.url, employer)
                extracted = [heuristic] if heuristic else []
            if not extracted:
                complete = False
                notes.append(f"ApplicantPro detail {job_id} had no extractable job payload")
                continue
            job = extracted[0]
            job["external_job_id"] = str(job.get("external_job_id") or job_id)
            jobs.append(job)
        except Exception as exc:
            complete = False
            notes.append(f"ApplicantPro detail {job_id} failed: {str(exc)[:120]}")
    if len(jobs) != len(posting_urls):
        complete = False
    if expected_count is not None and len(jobs) != expected_count:
        complete = False
        notes.append(f"ApplicantPro extracted {len(jobs)} of {expected_count} board postings")
    return jobs, complete, list(dict.fromkeys(notes))


class _ApplicantStackOpeningsParser(HTMLParser):
    def __init__(self, board_host: str) -> None:
        super().__init__(convert_charrefs=True)
        self.board_host = board_host.lower()
        self.links: list[dict[str, str]] = []
        self.current: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        attrs = dict(attrs_list)
        href = urllib.parse.urljoin(f"https://{self.board_host}/", attrs.get("href") or "")
        parsed = urllib.parse.urlparse(href)
        if parsed.hostname == self.board_host and re.match(r"^/x/detail/[^/]+/?$", parsed.path, re.I):
            self.current = {"url": href, "text": []}

    def handle_data(self, data: str) -> None:
        if self.current is not None and data.strip():
            self.current["text"].append(data.strip())

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self.current is not None:
            title = re.sub(r"\s+", " ", " ".join(self.current["text"])).strip()
            if title:
                self.links.append({"url": self.current["url"], "title": title})
            self.current = None


def _applicantstack_page_window(html: str) -> tuple[int, int, int] | None:
    parser = _VisibleTextParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return None
    visible = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
    match = re.search(r"\bshowing\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)\b", visible, re.I)
    if not match:
        return None
    return tuple(int(value) for value in match.groups())


def _applicantstack_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Fetch one complete public openings table and its same-board details."""
    host = f"{tenant}.applicantstack.com"
    parsed_source = urllib.parse.urlparse(url)
    path = parsed_source.path if parsed_source.path.strip("/") else "/x/openings"
    if path.lower() != "/x/openings":
        path = "/x/openings"
    board_url = urllib.parse.urlunparse(("https", host, path, "", parsed_source.query, ""))
    board = _request(board_url)
    if board.status_code != 200:
        raise ScrapeFailure(f"ApplicantStack openings board returned HTTP {board.status_code}")
    parser = _ApplicantStackOpeningsParser(host)
    try:
        parser.feed(board.text)
        parser.close()
    except Exception as exc:
        raise ScrapeFailure(f"ApplicantStack board HTML could not be parsed: {exc}") from exc
    unique_links: dict[str, dict[str, str]] = {}
    for item in parser.links:
        canonical = urllib.parse.urlunparse(urllib.parse.urlparse(item["url"])._replace(fragment=""))
        unique_links.setdefault(canonical, item)
    links = list(unique_links.values())
    window = _applicantstack_page_window(board.text)
    complete = window is not None
    notes: list[str] = []
    if window is None:
        notes.append("ApplicantStack openings table omitted its Showing start-end-of-total indicator")
    else:
        start, end, total = window
        if start != 1 or end != total or len(links) != total:
            complete = False
            notes.append(f"ApplicantStack board window {start}-{end} of {total} did not match {len(links)} unique listing links")
    jobs: list[dict[str, Any]] = []
    for item in links:
        try:
            detail = _request(item["url"], timeout=12)
            if detail.status_code != 200:
                raise ScrapeFailure(f"HTTP {detail.status_code}")
            extracted = extract_postings(detail.text, detail.url, employer)
            if not extracted:
                heuristic = extract_html_job(detail.text, detail.url, employer)
                extracted = [heuristic] if heuristic else []
            if not extracted:
                complete = False
                notes.append(f"ApplicantStack detail omitted an extractable payload: {item['url']}")
                continue
            job = extracted[0]
            job["title"] = _text(job.get("title")) or item["title"]
            if not job.get("external_job_id"):
                job["external_job_id"] = urllib.parse.urlparse(item["url"]).path.rstrip("/").rsplit("/", 1)[-1]
            jobs.append(job)
        except Exception as exc:
            complete = False
            notes.append(f"ApplicantStack detail failed: {item['url']} ({str(exc)[:120]})")
    if len(jobs) != len(links):
        complete = False
    return jobs, complete, list(dict.fromkeys(notes))


def _discover_sitemaps(start_url: str) -> tuple[list[str], bool, list[str]]:
    parsed = urllib.parse.urlparse(start_url)
    root = f"https://{parsed.netloc}"
    robots = _robots_parser(root)
    robots_maps = list(robots.site_maps() or []) if robots else []
    candidates = list(robots_maps)
    # Do not probe three guessed endpoints on every host. Try the robots-listed
    # maps and one conventional sitemap first; index variants are only fallback
    # probes when nothing parseable was found.
    candidates.append(root + "/sitemap.xml")
    queue = list(dict.fromkeys(candidates))
    visited: set[str] = set()
    job_urls: list[str] = []
    base_host = parsed.hostname
    complete = True
    notes: list[str] = []
    valid_sitemaps = 0
    while queue and len(visited) < MAX_SITEMAPS and len(job_urls) < MAX_JOB_URLS:
        sitemap = queue.pop(0)
        if sitemap in visited: continue
        visited.add(sitemap)
        try:
            response = _request(sitemap)
            if response.status_code in (404, 410): continue
            if response.status_code in (401, 403):
                raise ScrapeFailure(f"sitemap access denied (HTTP {response.status_code}): {sitemap}")
            if response.status_code != 200:
                complete = False; notes.append(f"sitemap HTTP {response.status_code}: {sitemap}"); continue
            locs, is_index = _xml_locations(response.content)
            valid_sitemaps += 1
        except ScrapeFailure as exc:
            complete = False; notes.append(str(exc)[:180])
            if sitemap in robots_maps and any(term in str(exc).lower() for term in ("robots", "disallows", "access denied")):
                raise
            continue
        except Exception as exc:
            complete = False; notes.append(f"sitemap unavailable or invalid: {sitemap} ({str(exc)[:100]})")
            continue
        if is_index:
            local = [loc for loc in locs if urllib.parse.urlparse(loc).hostname == base_host]
            if len(local) < len(locs):
                complete = False; notes.append("sitemap index included external hosts that were not followed")
            queue.extend(local)
        else:
            job_sitemap = bool(re.search(r"job|career|opening|position|vacanc", urllib.parse.urlparse(sitemap).path, re.I))
            for loc in locs:
                locp = urllib.parse.urlparse(loc)
                if locp.hostname != base_host: continue
                if job_sitemap or JOB_PATH_RE.search(locp.path) or re.search(r"job|requisition|posting", locp.query, re.I):
                    job_urls.append(loc)
                else:
                    complete = False
    if queue:
        complete = False; notes.append("sitemap index cap reached")
    if len(job_urls) >= MAX_JOB_URLS:
        complete = False; notes.append(f"job URL cap reached ({MAX_JOB_URLS})")
    if not valid_sitemaps:
        for fallback in (root + "/sitemap_index.xml", root + "/sitemap-index.xml"):
            try:
                response = _request(fallback, timeout=6)
                if response.status_code != 200: continue
                locs, is_index = _xml_locations(response.content)
                valid_sitemaps += 1
                if is_index:
                    queue = [loc for loc in locs if urllib.parse.urlparse(loc).hostname == base_host]
                else:
                    queue = [fallback]
                if len(queue) > MAX_SITEMAPS:
                    queue = queue[:MAX_SITEMAPS]
                    complete = False; notes.append("fallback sitemap index cap reached")
                for sitemap in queue:
                    response = _request(sitemap, timeout=6)
                    if response.status_code != 200: continue
                    locs, is_index = _xml_locations(response.content)
                    if is_index:
                        continue
                    job_sitemap = bool(re.search(r"job|career|opening|position|vacanc", urllib.parse.urlparse(sitemap).path, re.I))
                    for loc in locs:
                        locp = urllib.parse.urlparse(loc)
                        if locp.hostname == base_host and (job_sitemap or JOB_PATH_RE.search(locp.path) or re.search(r"job|requisition|posting", locp.query, re.I)):
                            job_urls.append(loc)
                        elif locp.hostname == base_host:
                            complete = False
                if job_urls: break
            except Exception as exc:
                complete = False; notes.append(f"fallback sitemap unavailable: {fallback} ({str(exc)[:100]})")
    if not job_urls and valid_sitemaps:
        notes.append("no sitemap URL matched the job-page locator")
    return list(dict.fromkeys(job_urls))[:MAX_JOB_URLS], complete, notes


class _CareerLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() not in ("a", "link"):
            return
        href = dict(attrs).get("href")
        if href:
            self.hrefs.append(href)


class _JobPageFields(HTMLParser):
    """Small no-JS fallback: collect page headings and description regions."""
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.headings: list[str] = []
        self.description: list[str] = []
        self._heading_depth = 0
        self._description_depth = 0
        self._skip_depth = 0
        self._current_heading: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attr = {k.lower(): (v or "") for k, v in attrs}
        if tag in ("script", "style", "nav", "header", "footer"):
            self._skip_depth += 1
        if tag in ("h1", "h2") and self._heading_depth == 0:
            self._heading_depth = 1
            self._current_heading = []
        if tag in ("main", "article"):
            self._description_depth += 1

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("script", "style", "nav", "header", "footer") and self._skip_depth:
            self._skip_depth -= 1
        if tag in ("h1", "h2") and self._heading_depth:
            value = re.sub(r"\s+", " ", " ".join(self._current_heading)).strip()
            if value: self.headings.append(value)
            self._heading_depth = 0
        if tag in ("main", "article") and self._description_depth:
            self._description_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._skip_depth: return
        text = re.sub(r"\s+", " ", data).strip()
        if not text: return
        if self._heading_depth: self._current_heading.append(text)
        if self._description_depth: self.description.append(text)


def is_job_detail_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    segments = [x.lower() for x in parsed.path.split("/") if x]
    markers = {"job", "jobs", "career", "careers", "position", "positions", "opening", "openings", "vacancy", "vacancies"}
    for index, segment in enumerate(segments[:-1]):
        if segment in markers and segments[index + 1] not in {"search", "all", "list", "listing", "apply", "categories"}:
            return True
    return bool(re.search(r"(?:jobid|job_id|reqid|requisition|postingid|posting_id)=", parsed.query, re.I))


def extract_html_job(html: str, source_url: str, employer: str) -> dict[str, Any] | None:
    parser = _JobPageFields()
    try: parser.feed(html)
    except Exception: return None
    title = next((x for x in parser.headings if 2 <= len(x) <= 160), None)
    if not title or re.match(r"^(careers?( at .*)?|job search|search jobs|open positions|job opportunities)$", title, re.I):
        return None
    description = re.sub(r"\s+", " ", " ".join(parser.description)).strip() or None
    key = source_url.split("#", 1)[0]
    external_id = hashlib.sha256(key.lower().encode()).hexdigest()[:32]
    return {
        "title": title, "company": employer, "location": None,
        "source_url": source_url, "external_job_id": external_id,
        "description_text": description, "snippet": description[:300] if description else None,
        "raw": {"source": SOURCE, "extractor": "html_heading_fallback"},
    }


def _listing_links(html: str, current_url: str, host: str) -> list[str]:
    parser = _CareerLinks()
    parser.feed(html)
    found = []
    for href in parser.hrefs:
        target = urllib.parse.urljoin(current_url, href)
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme != "https" or parsed.hostname != host:
            continue
        if parsed.fragment:
            parsed = parsed._replace(fragment="")
        if JOB_PATH_RE.search(parsed.path) or re.search(r"(?:page|offset|start|from)=\d+", parsed.query, re.I):
            found.append(urllib.parse.urlunparse(parsed))
    return list(dict.fromkeys(found))


def _jazzhr_jobs(url: str, tenant: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Enumerate a JazzHR tenant's public HTML listing and validate each detail."""
    board_url = board_url_for(url)
    board_host = urllib.parse.urlparse(board_url).hostname
    if board_host != f"{tenant}.applytojob.com":
        raise ScrapeFailure("JazzHR tenant did not match the tracked board")
    board = _request(board_url, timeout=20)
    if board.status_code != 200 or urllib.parse.urlparse(board.url).hostname != board_host:
        raise ScrapeFailure(f"JazzHR public board returned HTTP {board.status_code} or redirected off tenant")
    listing = parse_board_listing(board.text, url, max_postings=MAX_JOB_URLS)
    complete = listing.complete
    notes: list[str] = [] if complete else [listing.reason]
    jobs: list[dict[str, Any]] = []
    for detail_url in listing.posting_urls:
        try:
            detail = _request(detail_url, timeout=15)
            if detail.status_code != 200 or urllib.parse.urlparse(detail.url).hostname != board_host:
                raise ScrapeFailure(f"HTTP {detail.status_code} or redirect off tenant")
            extracted = extract_postings(detail.text, detail.url, employer)
            matching = [
                job for job in extracted
                if normalize_source_url(str(job.get("source_url") or detail.url)) == normalize_source_url(detail_url)
            ]
            if len(matching) != 1:
                raise ScrapeFailure(f"expected one matching JobPosting, found {len(matching)}")
            job = matching[0]
            path_parts = [part for part in urllib.parse.urlparse(detail_url).path.split("/") if part]
            job["external_job_id"] = path_parts[1]
            jobs.append(job)
        except Exception as exc:
            complete = False
            notes.append(f"JazzHR detail failed: {detail_url} ({str(exc)[:120]})")
    if len(jobs) != len(listing.posting_urls):
        complete = False
    return jobs, complete, list(dict.fromkeys(notes))


def _linked_ats_boards(html: str, current_url: str) -> list[tuple[str, tuple[str, str]]]:
    """Find explicitly linked, supported public ATS boards on an official career page."""
    parser = _CareerLinks()
    try:
        parser.feed(html)
    except Exception:
        return []
    found: dict[tuple[str, str], str] = {}
    for href in parser.hrefs:
        target = urllib.parse.urljoin(current_url, href)
        parsed = urllib.parse.urlparse(target)
        if parsed.scheme.lower() != "https":
            continue
        platform = _platform(target)
        if platform:
            found.setdefault(platform, target.split("#", 1)[0])
    return [(url, platform) for platform, url in found.items()]


def _crawl_generic(start_url: str, employer: str) -> tuple[list[dict[str, Any]], str, bool, list[str]]:
    postings: list[dict[str, Any]] = []
    personio_feed_note: str | None = None
    # Some sources are a job detail page already.
    response = _request(start_url)
    if response.status_code >= 400:
        raise ScrapeFailure(f"career page returned HTTP {response.status_code}")
    postings.extend(extract_postings(response.text, response.url, employer))
    redirected_platform = _platform(response.url)
    if redirected_platform:
        if redirected_platform[0] == "pinpoint":
            jobs, complete, notes = _pinpoint_jobs(response.url, redirected_platform[1], employer)
            return jobs, "redirected_public_json_feed:pinpoint", complete, notes
        if redirected_platform[0] == "bamboohr":
            jobs, complete, notes = _bamboohr_jobs(response.url, redirected_platform[1], employer)
            return jobs, "redirected_public_career_json:bamboohr", complete, notes
        if redirected_platform[0] == "icims":
            jobs, complete, notes = _icims_jobs(response.url, redirected_platform[1], employer)
            return jobs, "public_html_pagination:icims-v1", complete, notes
        if redirected_platform[0] == "applicantstack":
            jobs, complete, notes = _applicantstack_jobs(response.url, redirected_platform[1], employer)
            return jobs, "public_board_count:applicantstack-v1", complete, notes
        if redirected_platform[0] == "applicantpro":
            jobs, complete, notes = _applicantpro_jobs(response.url, redirected_platform[1], employer)
            return jobs, "public_sitemap_postings:applicantpro-v1", complete, notes
        if redirected_platform[0] == "jazzhr":
            jobs, complete, notes = _jazzhr_jobs(response.url, redirected_platform[1], employer)
            return jobs, "redirected_public_board_listing:jazzhr-v1", complete, notes
        if redirected_platform[0] == "breezy":
            jobs, complete, notes = _breezy_jobs(response.url, redirected_platform[1], employer)
            return jobs, "public_json_feed:breezy-v1", complete, notes
        if redirected_platform[0] == "teamtailor":
            jobs, complete, notes = _teamtailor_jobs(response.url, redirected_platform[1], employer)
            return jobs, "public_rss_pagination:teamtailor-v1", complete, notes
        if redirected_platform[0] == "taleo":
            jobs, complete, notes = _taleo_jobs(response.url, redirected_platform[1], employer)
            return jobs, "public_career_section_sitemap:taleo-enterprise-v1", complete, notes
        if redirected_platform[0] == "personio":
            # Direct Personio URLs reach this path only after their XML feed
            # failed in scrape_source. An official page redirect has not yet
            # tried the feed, so use it before falling back to public HTML.
            if _platform(start_url) != redirected_platform:
                try:
                    jobs, complete, notes = _personio_jobs(response.url, redirected_platform[1], employer)
                    return jobs, "redirected_public_xml_feed:personio-v1", complete, notes
                except ScrapeFailure as exc:
                    personio_feed_note = f"redirected Personio XML feed unavailable: {str(exc)[:140]}"
        else:
            jobs = _api_jobs(response.url, redirected_platform, employer)
            return jobs, f"redirected_ats_api:{redirected_platform[0]}", True, []
    if not postings and is_job_detail_url(response.url):
        heuristic = extract_html_job(response.text, response.url, employer)
        if heuristic: postings.append(heuristic)
    linked_boards = _linked_ats_boards(response.text, response.url)
    if linked_boards:
        board_jobs: list[dict[str, Any]] = []
        board_notes: list[str] = []
        all_boards_complete = True
        for board_url, platform in linked_boards[:10]:
            try:
                if platform[0] == "rippling":
                    adapted_jobs, board_complete, adapter_notes = _rippling_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked rippling board: {note}" for note in adapter_notes)
                elif platform[0] == "smartrecruiters":
                    adapted_jobs, board_complete, adapter_notes = _smartrecruiters_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked SmartRecruiters board: {note}" for note in adapter_notes)
                elif platform[0] == "pinpoint":
                    adapted_jobs, board_complete, adapter_notes = _pinpoint_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked Pinpoint board: {note}" for note in adapter_notes)
                elif platform[0] == "bamboohr":
                    adapted_jobs, board_complete, adapter_notes = _bamboohr_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked BambooHR board: {note}" for note in adapter_notes)
                elif platform[0] == "icims":
                    adapted_jobs, board_complete, adapter_notes = _icims_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked iCIMS board: {note}" for note in adapter_notes)
                elif platform[0] == "applicantstack":
                    adapted_jobs, board_complete, adapter_notes = _applicantstack_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked ApplicantStack board: {note}" for note in adapter_notes)
                elif platform[0] == "applicantpro":
                    adapted_jobs, board_complete, adapter_notes = _applicantpro_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked ApplicantPro board: {note}" for note in adapter_notes)
                elif platform[0] == "jazzhr":
                    adapted_jobs, board_complete, adapter_notes = _jazzhr_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked JazzHR board: {note}" for note in adapter_notes)
                elif platform[0] == "breezy":
                    adapted_jobs, board_complete, adapter_notes = _breezy_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked Breezy board: {note}" for note in adapter_notes)
                elif platform[0] == "teamtailor":
                    adapted_jobs, board_complete, adapter_notes = _teamtailor_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked Teamtailor board: {note}" for note in adapter_notes)
                elif platform[0] == "taleo":
                    adapted_jobs, board_complete, adapter_notes = _taleo_jobs(board_url, platform[1], employer)
                    board_jobs.extend(adapted_jobs)
                    all_boards_complete = all_boards_complete and board_complete
                    board_notes.extend(f"linked Taleo board: {note}" for note in adapter_notes)
                elif platform[0] == "personio":
                    try:
                        adapted_jobs, board_complete, adapter_notes = _personio_jobs(board_url, platform[1], employer)
                    except ScrapeFailure as exc:
                        board_notes.append(f"linked Personio XML feed unavailable: {str(exc)[:140]}")
                        all_boards_complete = False
                    else:
                        board_jobs.extend(adapted_jobs)
                        all_boards_complete = all_boards_complete and board_complete
                        board_notes.extend(f"linked Personio board: {note}" for note in adapter_notes)
                else:
                    board_jobs.extend(_api_jobs(board_url, platform, employer))
            except Exception as exc:
                all_boards_complete = False
                board_notes.append(f"linked {platform[0]} board failed: {str(exc)[:140]}")
        combined = postings + board_jobs
        unique: dict[str, dict[str, Any]] = {}
        for job in combined:
            unique.setdefault(str(job.get("source_url") or job.get("external_job_id") or len(unique)), job)
        if personio_feed_note:
            board_notes.insert(0, personio_feed_note)
            all_boards_complete = False
        return list(unique.values()), "linked_ats_api:" + "+".join(dict.fromkeys(p[0] for _, p in linked_boards)), all_boards_complete, board_notes
    seen_posting_urls = {job["source_url"].split("#", 1)[0] for job in postings}
    urls, complete, notes = _discover_sitemaps(response.url)
    if personio_feed_note:
        complete = False
        notes.insert(0, personio_feed_note)
    listing_pages: list[str] = []
    method = "sitemap_structured_data"
    if not urls:
        method = "linked_pages_structured_data"
        complete = False
        notes.append("no usable sitemap; completeness depends on linked-page crawl")
        host = urllib.parse.urlparse(response.url).hostname or ""
        listing_pages = _listing_links(response.text, response.url, host)[:250]
        urls = listing_pages
    for detail_url in urls:
        try:
            detail = _request(detail_url, timeout=12)
            if detail.status_code == 200:
                new = extract_postings(detail.text, detail.url, employer)
                if not new and is_job_detail_url(detail.url):
                    heuristic = extract_html_job(detail.text, detail.url, employer)
                    if heuristic: new = [heuristic]
                if not new:
                    complete = False
                    notes.append(f"detail page had no extractable job posting: {detail_url}")
                for job in new:
                    key = job["source_url"].split("#", 1)[0]
                    if key not in seen_posting_urls:
                        seen_posting_urls.add(key); postings.append(job)
                if listing_pages:
                    nested = _listing_links(detail.text, detail.url, host)
                    for candidate in nested:
                        if candidate not in urls and len(urls) < 250:
                            urls.append(candidate)
            else:
                complete = False
                notes.append(f"detail page returned HTTP {detail.status_code}: {detail_url}")
        except Exception as exc:
            complete = False; notes.append(f"detail page failed: {detail_url} ({str(exc)[:100]})")
            continue
    if postings:
        return postings, method, complete, notes
    complete = False
    notes.append("candidate pages returned no extractable JobPosting JSON-LD or microdata; adapter coverage is unverified")
    return [], "no_job_urls_in_sitemaps" if method == "sitemap_structured_data" else "no_jobposting_structured_data_on_linked_pages", complete, notes


def load_sources(path: Path) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row.get("career_page_status") not in ("verified_official", "verified_official_ats_link"):
                continue
            url = (row.get("career_page_url") or "").strip()
            if not url: continue
            key = normalize_source_url(url)
            entry = grouped.setdefault(key, {"url": url, "normalized_url": key, "source_urls": [], "evidence_urls": [], "employers": [], "employer_keys": []})
            entry["source_urls"].append(url)
            if row.get("evidence_url"):
                entry["evidence_urls"].append(row["evidence_url"].strip())
            entry["employers"].append((row.get("employer_name") or "").strip())
            entry["employer_keys"].append((row.get("employer_key") or "").strip())
    return [{**v, "source_urls": list(dict.fromkeys(v["source_urls"])), "evidence_urls": list(dict.fromkeys(v["evidence_urls"])), "employers": list(dict.fromkeys(x for x in v["employers"] if x)), "employer_keys": list(dict.fromkeys(x for x in v["employer_keys"] if x))} for v in grouped.values()]


def _interleave_sources_by_host(sources: list[dict[str, Any]], workers: int) -> list[dict[str, Any]]:
    """Start different hosts together while giving direct ATS boards half the slots."""
    buckets: dict[str, deque[dict[str, Any]]] = {}
    for source in sorted(sources, key=lambda s: (0 if _platform(s["url"]) else 1, s["normalized_url"])):
        host = urllib.parse.urlparse(source["url"]).hostname or source["normalized_url"]
        buckets.setdefault(host, deque()).append(source)
    direct = deque(sorted(host for host, items in buckets.items() if _platform(items[0]["url"])))
    generic = deque(sorted(host for host, items in buckets.items() if not _platform(items[0]["url"])))
    direct_quota = max(1, workers // 2)
    generic_quota = max(1, workers - direct_quota)
    ordered: list[dict[str, Any]] = []
    while direct or generic:
        requeue_direct: list[str] = []
        requeue_generic: list[str] = []
        for queue, quota in ((direct, direct_quota), (generic, generic_quota)):
            for _ in range(min(quota, len(queue))):
                host = queue.popleft()
                ordered.append(buckets[host].popleft())
                if buckets[host]:
                    target = requeue_direct if _platform(buckets[host][0]["url"]) else requeue_generic
                    target.append(host)
        direct.extend(requeue_direct)
        generic.extend(requeue_generic)
    return ordered


def _read_done(results_path: Path) -> dict[str, dict[str, Any]]:
    done: dict[str, dict[str, Any]] = {}
    if results_path.exists():
        for line in results_path.read_text(encoding="utf-8").splitlines():
            try:
                item = json.loads(line)
                if item.get("status") in ("scraped", "no_jobs") and item.get("complete") is True and item.get("adapter_version") == ADAPTER_VERSION:
                    done[item["url"]] = item
            except (json.JSONDecodeError, KeyError):
                continue
    return done


def _read_attempted(results_path: Path) -> set[str]:
    """Find current-version groups with a recorded outcome, including failures."""
    attempted: set[str] = set()
    if not results_path.exists():
        return attempted
    with results_path.open(encoding="utf-8") as results:
        for line in results:
            try:
                item = json.loads(line)
                if not isinstance(item, dict) or item.get("adapter_version") != ADAPTER_VERSION:
                    continue
                if item.get("status") not in {"scraped", "no_jobs", "partial", "blocked", "error", "held"}:
                    continue
                url = item.get("normalized_url") or item.get("url")
                if not isinstance(url, str):
                    continue
                parsed = urllib.parse.urlparse(url.strip())
                if parsed.scheme not in ("http", "https") or not parsed.hostname:
                    continue
                attempted.add(normalize_source_url(url))
            except (json.JSONDecodeError, ValueError):
                continue
    return attempted


def _pending_sources(sources: list[dict[str, Any]], done: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Resume incomplete URLs and refresh completions for newly added public-board adapters."""
    pending = []
    refresh_methods = {
        "rippling": "public_board_pagination:rippling",
        "smartrecruiters": "public_board_pagination:smartrecruiters-v2",
        "pinpoint": "public_json_feed:pinpoint-v1",
        "bamboohr": "public_career_json:bamboohr-v1",
        "icims": "public_html_pagination:icims-v1",
        "breezy": "public_json_feed:breezy-v1",
        "teamtailor": "public_rss_pagination:teamtailor-v1",
        "personio": "public_xml_feed:personio-v1",
        "applicantstack": "public_board_count:applicantstack-v1",
        "applicantpro": "public_sitemap_postings:applicantpro-v1",
        "jazzhr": "public_board_listing:jazzhr-v1",
    }
    for source in sources:
        previous = done.get(source["url"])
        platform = _platform(source["url"])
        needs_public_refresh = bool(
            previous
            and platform
            and platform[0] in refresh_methods
            and previous.get("method") != refresh_methods[platform[0]]
            and not (platform[0] == "personio" and str(previous.get("method") or "").startswith("personio_page_fallback:"))
        )
        if previous is None or needs_public_refresh:
            pending.append(source)
    return pending


def _taleo_jobs(url: str, portal: str, employer: str) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read one Taleo Enterprise Career Section through its public sitemap."""
    parsed = urllib.parse.urlparse(url)
    root = f"https://{parsed.netloc}"
    language = (urllib.parse.parse_qs(parsed.query).get("lang") or ["en"])[0]
    # Taleo sets a board/session cookie when the employer's career route is
    # opened. Keep that cookie for its sitemap and job-detail requests; direct
    # sitemap-detail fetches can otherwise return an HTTP 200 session-expiry
    # shell with no job content.
    session = requests.Session()
    landing = _request(url, timeout=15, session=session)
    if landing.status_code >= 400:
        raise ScrapeFailure(f"Taleo career route returned HTTP {landing.status_code}")
    sitemap_url = root + "/careersection/sitemap.jss?" + urllib.parse.urlencode({"portalCode": portal, "lang": language})
    response = _request(sitemap_url, timeout=15, session=session)
    if response.status_code != 200:
        raise ScrapeFailure(f"Taleo portal sitemap returned HTTP {response.status_code}")
    locations, is_index = _xml_locations(response.content)
    notes: list[str] = []
    if is_index:
        matches = []
        for child in locations:
            child_parsed = urllib.parse.urlparse(child)
            child_query = urllib.parse.parse_qs(child_parsed.query)
            child_portal = (child_query.get("portalCode") or [""])[0]
            child_parts = [part.lower() for part in child_parsed.path.split("/") if part]
            section_index = next((i for i, part in enumerate(child_parts) if part == "careersection"), -1)
            path_portal = child_parts[section_index + 1] if section_index >= 0 and section_index + 1 < len(child_parts) else ""
            if child_portal.lower() == portal.lower() or path_portal == portal.lower():
                matches.append(child)
        if len(matches) != 1:
            raise ScrapeFailure(f"Taleo sitemap index did not identify exactly one portal {portal!r}")
        response = _request(matches[0], timeout=15, session=session)
        if response.status_code != 200:
            raise ScrapeFailure(f"Taleo child sitemap returned HTTP {response.status_code}")
        locations, is_index = _xml_locations(response.content)
    if is_index:
        raise ScrapeFailure("Taleo portal sitemap resolved to another sitemap index")
    if len(locations) > MAX_JOB_URLS:
        locations = locations[:MAX_JOB_URLS]
        notes.append(f"Taleo sitemap job URL cap reached ({MAX_JOB_URLS})")
        complete = False
    else:
        complete = True
    unique_urls: list[str] = []
    for target in locations:
        target_parsed = urllib.parse.urlparse(target)
        if target_parsed.scheme.lower() != "https" or target_parsed.hostname != parsed.hostname:
            complete = False
            notes.append("Taleo sitemap contained a non-HTTPS or cross-host URL that was skipped")
            continue
        if target not in unique_urls:
            unique_urls.append(target)
    jobs: list[dict[str, Any]] = []
    for detail_url in unique_urls:
        try:
            detail = _request(detail_url, timeout=15, session=session)
            if detail.status_code != 200:
                raise ScrapeFailure(f"HTTP {detail.status_code}")
            extracted = extract_postings(detail.text, detail.url, employer)
            if not extracted:
                fallback = extract_html_job(detail.text, detail.url, employer)
                extracted = [fallback] if fallback else []
            if not extracted:
                complete = False
                notes.append(f"Taleo job detail had no extractable title: {detail_url}")
                continue
            job = extracted[0]
            query = urllib.parse.parse_qs(urllib.parse.urlparse(detail.url).query)
            query_id = next((query[k][0] for k in ("job", "rid", "requisitionId") if query.get(k)), "")
            job["external_job_id"] = query_id or job.get("external_job_id")
            if not job["external_job_id"]:
                job["external_job_id"] = hashlib.sha256(detail.url.lower().encode()).hexdigest()[:32]
            jobs.append(job)
        except Exception as exc:
            complete = False
            notes.append(f"Taleo job detail failed: {detail_url} ({str(exc)[:120]})")
    if len(jobs) != len(unique_urls):
        complete = False
    return jobs, complete, list(dict.fromkeys(notes))


def _source_policy_hold(host: str) -> tuple[str, str] | None:
    """Return a policy reason for sources that must not be crawled anonymously."""
    host = host.lower().rstrip(".")
    if host == "jobvite.com" or host.endswith(".jobvite.com"):
        return "Jobvite terms prohibit automated scraping and commercial reuse of postings", "Jobvite terms prohibit automated scraping; source held for authorized integration"
    if host == "paycom.com" or host.endswith(".paycom.com") or host == "paycomonline.net" or host.endswith(".paycomonline.net"):
        return "Paycom terms prohibit automated extraction without written authorization", "Paycom source held pending written authorization"
    if host == "ultipro.com" or host.endswith(".ultipro.com") or host == "ukg.net" or host.endswith(".ukg.net"):
        return "UKG source held because no documented anonymous public job-feed contract is available", "UKG source held pending an authorized or documented public interface"
    if host == "saashr.com" or host.endswith(".saashr.com"):
        return "UKG Ready robots policy disallows automated access to this source", "UKG Ready source held by robots policy"
    if host == "isolvedhire.com" or host.endswith(".isolvedhire.com"):
        return "iSolved terms reserve copying or exploitation without prior written permission", "iSolved source held pending terms clearance or written permission"
    if host == "adp.com" or host.endswith(".adp.com"):
        return "ADP job access requires an authorized customer or partner integration", "ADP source held pending authorized API access"
    return None


def scrape_source(source: dict[str, Any]) -> dict[str, Any]:
    url = source["url"]
    employer = source["employers"][0] if source["employers"] else "Unknown employer"
    host = (urllib.parse.urlparse(url).hostname or "").lower()
    policy_hold = _source_policy_hold(host)
    if policy_hold:
        error, note = policy_hold
        return {
            "url": url,
            "normalized_url": source["normalized_url"],
            "source_urls": source["source_urls"],
            "evidence_urls": source["evidence_urls"],
            "employers": source["employers"],
            "employer_keys": source["employer_keys"],
            "adapter_version": ADAPTER_VERSION,
            "status": "blocked",
            "method": "policy_hold",
            "complete": False,
            "notes": [note],
            "jobs": [],
            "job_count": 0,
            "error": error,
        }
    try:
        p = _platform(url)
        if p:
            if p[0] == "rippling":
                jobs, complete, notes = _rippling_jobs(url, p[1], employer)
                method = "public_board_pagination:rippling"
            elif p[0] == "smartrecruiters":
                jobs, complete, notes = _smartrecruiters_jobs(url, p[1], employer)
                method = "public_board_pagination:smartrecruiters-v2"
            elif p[0] == "pinpoint":
                jobs, complete, notes = _pinpoint_jobs(url, p[1], employer)
                method = "public_json_feed:pinpoint-v1"
            elif p[0] == "bamboohr":
                jobs, complete, notes = _bamboohr_jobs(url, p[1], employer)
                method = "public_career_json:bamboohr-v1"
            elif p[0] == "icims":
                jobs, complete, notes = _icims_jobs(url, p[1], employer)
                method = "public_html_pagination:icims-v1"
            elif p[0] == "breezy":
                jobs, complete, notes = _breezy_jobs(url, p[1], employer)
                method = "public_json_feed:breezy-v1"
            elif p[0] == "teamtailor":
                jobs, complete, notes = _teamtailor_jobs(url, p[1], employer)
                method = "public_rss_pagination:teamtailor-v1"
            elif p[0] == "personio":
                try:
                    jobs, complete, notes = _personio_jobs(url, p[1], employer)
                    method = "public_xml_feed:personio-v1"
                except ScrapeFailure as feed_error:
                    jobs, fallback_method, complete, notes = _crawl_generic(url, employer)
                    method = "personio_page_fallback:" + fallback_method
                    notes = [f"Personio XML feed unavailable: {str(feed_error)[:140]}", *notes]
            elif p[0] == "applicantstack":
                jobs, complete, notes = _applicantstack_jobs(url, p[1], employer)
                method = "public_board_count:applicantstack-v1"
            elif p[0] == "applicantpro":
                jobs, complete, notes = _applicantpro_jobs(url, p[1], employer)
                method = "public_sitemap_postings:applicantpro-v1"
            elif p[0] == "jazzhr":
                jobs, complete, notes = _jazzhr_jobs(url, p[1], employer)
                method = "public_board_listing:jazzhr-v1"
            elif p[0] == "taleo":
                jobs, complete, notes = _taleo_jobs(url, p[1], employer)
                method = "public_career_section_sitemap:taleo-enterprise-v1"
            else:
                jobs = _api_jobs(url, p, employer)
                method = "ats_api:" + p[0]
                complete = True
                notes = []
        else:
            jobs, method, complete, notes = _crawl_generic(url, employer)
        for job in jobs:
            raw = job.setdefault("raw", {})
            board = _platform(url)
            board_key = f"{board[0]}:{board[1]}" if board else source["normalized_url"].split("?", 1)[0]
            raw.update({"source": SOURCE, "adapter_version": ADAPTER_VERSION, "career_source_url": url, "career_source_url_aliases": source["source_urls"], "career_source_evidence_urls": source["evidence_urls"], "career_source_board": board_key, "employer_keys": source["employer_keys"]})
            if not job.get("external_job_id"):
                job["external_job_id"] = hashlib.sha256(str(job.get("source_url", url)).lower().encode()).hexdigest()[:32]
        status = ("scraped" if jobs else "no_jobs") if complete else "partial"
        return {"url": url, "normalized_url": source["normalized_url"], "source_urls": source["source_urls"], "evidence_urls": source["evidence_urls"], "employers": source["employers"], "employer_keys": source["employer_keys"], "adapter_version": ADAPTER_VERSION, "status": status, "method": method, "complete": complete, "notes": notes, "jobs": jobs, "job_count": len(jobs), "error": None}
    except Exception as exc:
        msg = str(exc)
        status = "held" if "career source must be an https url" in msg.lower() else ("blocked" if any(term in msg.lower() for term in ("robots", "disallows", "access denied", "http 401", "http 403")) else "error")
        return {"url": url, "normalized_url": source["normalized_url"], "source_urls": source["source_urls"], "evidence_urls": source["evidence_urls"], "employers": source["employers"], "employer_keys": source["employer_keys"], "adapter_version": ADAPTER_VERSION, "status": status, "method": "failed", "complete": False, "notes": [], "jobs": [], "job_count": 0, "error": msg[:500]}


def post_batches(jobs_path: Path, base_url: str, secret: str, batch_size: int = 100) -> tuple[int, int]:
    from openjobdata_ingest import sanitize_payload

    staged = skipped = 0
    session = requests.Session()
    url = base_url.rstrip("/") + "/api/job-ceo/ingest"
    batch: list[dict[str, Any]] = []
    batch_number = 0
    current_run_id: str | None = None

    def send_batch(payload_jobs: list[dict[str, Any]]) -> tuple[int, int, str | None]:
        nonlocal current_run_id
        payload: dict[str, Any] = {"jobs": payload_jobs}
        if current_run_id:
            payload["runId"] = current_run_id
        last_error: Exception | None = None
        for attempt, delay in enumerate((2, 4, 8), start=1):
            try:
                response = session.post(
                    url,
                    json=payload,
                    headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
                    timeout=90,
                )
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    raise ValueError("ingest endpoint returned a non-object response")
                return int(data.get("staged", 0)), int(data.get("skipped", 0)), data.get("runId")
            except (requests.RequestException, ValueError, TypeError) as exc:
                last_error = exc
                if attempt < 3:
                    print(f"[ingest] batch retry attempt={attempt}/3 error={str(exc)[:240]} wait={delay}s")
                    time.sleep(delay)
        raise RuntimeError(f"ingest batch failed after 3 attempts: {last_error}") from last_error

    with jobs_path.open(encoding="utf-8") as jobs_file:
      for line in jobs_file:
        if not line.strip(): continue
        batch.append(sanitize_payload(namespace_job_id(json.loads(line))))
        if len(batch) < batch_size: continue
        staged_count, skipped_count, returned_run_id = send_batch(batch)
        staged += staged_count
        skipped += skipped_count
        current_run_id = current_run_id or returned_run_id
        batch_number += 1
        print(f"[ingest] batch={batch_number} staged={staged_count} skipped={skipped_count}")
        batch = []
    if batch:
        staged_count, skipped_count, returned_run_id = send_batch(batch)
        staged += staged_count
        skipped += skipped_count
        current_run_id = current_run_id or returned_run_id
        batch_number += 1
        print(f"[ingest] batch={batch_number} staged={staged_count} skipped={skipped_count}")
    return staged, skipped


def summarize_results(results_path: Path, jobs_path: Path) -> dict[str, Any]:
    """Summarize by normalized URL; an earlier complete result survives retries."""
    by_url: dict[str, dict[str, Any]] = {}
    with results_path.open(encoding="utf-8") as results:
        for line in results:
            try:
                item = json.loads(line)
                key = item.get("normalized_url") or normalize_source_url(item["url"])
                previous = by_url.get(key)
                if (
                    previous
                    and previous.get("complete") is True
                    and previous.get("adapter_version") == ADAPTER_VERSION
                    and previous.get("method") == item.get("method")
                ):
                    continue
                by_url[key] = item
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
    status_counts: dict[str, int] = {}
    method_counts: dict[str, int] = {}
    employer_keys: set[str] = set()
    complete_employer_keys: set[str] = set()
    errors: dict[str, int] = {}
    for item in by_url.values():
        status = str(item.get("status", "unknown"))
        method = str(item.get("method", "unknown"))
        status_counts[status] = status_counts.get(status, 0) + 1
        method_counts[method] = method_counts.get(method, 0) + 1
        employer_keys.update(str(x) for x in item.get("employer_keys", []) if x)
        if item.get("complete") is True and item.get("adapter_version") == ADAPTER_VERSION:
            complete_employer_keys.update(str(x) for x in item.get("employer_keys", []) if x)
        error = str(item.get("error") or "")
        if error:
            errors[error] = errors.get(error, 0) + 1
    job_records: set[tuple[str, str]] = set()
    with jobs_path.open(encoding="utf-8") as jobs:
        for line in jobs:
            try:
                job = json.loads(line)
            except json.JSONDecodeError:
                continue
            raw = job.get("raw") if isinstance(job.get("raw"), dict) else {}
            if raw.get("adapter_version") != ADAPTER_VERSION:
                continue
            job_records.add((str(job.get("external_job_id") or "").lower(), str(job.get("source_url") or "").lower()))
    return {
        "unique_source_groups_with_result": len(by_url),
        "complete_source_groups": sum(1 for x in by_url.values() if x.get("complete") is True and x.get("adapter_version") == ADAPTER_VERSION),
        "complete_employer_keys": len(complete_employer_keys),
        "employer_keys_with_any_result": len(employer_keys),
        "status_counts_by_source_group": status_counts,
        "method_counts_by_source_group": method_counts,
        "top_errors": sorted(errors.items(), key=lambda x: (-x[1], x[0]))[:50],
        "unique_job_payloads": len(job_records),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_TRACKER)
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/employer-career-ingest"))
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--limit", type=int, default=0, help="debug cap on unique career URLs")
    parser.add_argument("--ingest", action="store_true", help="POST scraped jobs to Job CEO after scraping")
    parser.add_argument("--include-completed", action="store_true", help="re-scrape completed URLs")
    parser.add_argument("--skip-attempted", action="store_true", help="finish one inventory pass without retrying current-version partial, blocked, or failed groups; ignored with --include-completed")
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 64:
        parser.error("--workers must be between 1 and 64")
    if args.ingest and args.limit:
        parser.error("--ingest cannot be combined with --limit; complete the full scrape first")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    results_path = args.output_dir / "source_results.jsonl"
    jobs_path = args.output_dir / "jobs.jsonl"
    sources = _interleave_sources_by_host(load_sources(args.input), args.workers)
    tracker_sha256 = hashlib.sha256(args.input.read_bytes()).hexdigest()
    with args.input.open(newline="", encoding="utf-8-sig") as input_file:
        tracker_rows = list(csv.DictReader(input_file))
    verified_records = [r for r in tracker_rows if r.get("career_page_status") in ("verified_official", "verified_official_ats_link") and r.get("career_page_url")]
    raw_unique_urls = {r["career_page_url"].strip() for r in verified_records}
    run_manifest = {
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "adapter_version": ADAPTER_VERSION,
        "tracker_path": str(args.input.resolve()),
        "tracker_sha256": tracker_sha256,
        "tracker_rows": len(tracker_rows),
        "verified_employer_records": len(verified_records),
        "raw_unique_career_urls": len(raw_unique_urls),
        "normalized_unique_career_urls": len(sources),
        "url_dedupe_rule": "lowercase hostname; strip fragment; trim trailing slash (root remains /); preserve scheme, port, path case, parameters, and query",
        "source_url_aliases_preserved": True,
        "workers": args.workers,
        "limit": args.limit,
        "ingest_requested": args.ingest,
        "include_completed": args.include_completed,
        "skip_attempted": bool(args.skip_attempted and not args.include_completed),
    }
    (args.output_dir / "run_manifest.json").write_text(json.dumps(run_manifest, indent=2), encoding="utf-8")
    if args.limit: sources = sources[:args.limit]
    done = {} if args.include_completed else _read_done(results_path)
    pending = sources if args.include_completed else _pending_sources(sources, done)
    already_complete = len(sources) - len(pending)
    attempted_skipped = 0
    if args.skip_attempted and not args.include_completed:
        attempted = _read_attempted(results_path)
        previous_pending = len(pending)
        pending = [source for source in pending if source["normalized_url"] not in attempted]
        attempted_skipped = previous_pending - len(pending)
    print(f"verified employer records={len(verified_records)}; raw URLs={len(raw_unique_urls)}; normalized crawl groups={run_manifest['normalized_unique_career_urls']}; tracker sha256={tracker_sha256}")
    print(f"already complete={already_complete}; previously attempted additionally skipped={attempted_skipped}; queued={len(pending)}")
    mode = "a" if not args.include_completed else "w"
    already_written: set[str] = set()
    if mode == "a" and jobs_path.exists():
        with jobs_path.open(encoding="utf-8") as prior_jobs:
            for line in prior_jobs:
                try:
                    job = json.loads(line)
                    already_written.add(_job_dedupe_key(job))
                except (json.JSONDecodeError, AttributeError):
                    continue
    jobs_written = 0
    with results_path.open(mode, encoding="utf-8") as results, jobs_path.open(mode, encoding="utf-8") as jobs_file:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(scrape_source, s): s for s in pending}
            for future in as_completed(futures):
                result = future.result()
                result_row = {k: v for k, v in result.items() if k != "jobs"}
                results.write(json.dumps(result_row, ensure_ascii=False) + "\n"); results.flush()
                for job in result["jobs"]:
                    job_key = _job_dedupe_key(job)
                    if job_key in already_written: continue
                    already_written.add(job_key)
                    jobs_file.write(json.dumps(job, ensure_ascii=False) + "\n")
                    jobs_written += 1
                jobs_file.flush()
                print(f"[{result['status']}] {result['job_count']} jobs | {result['url']} | {result['method']}" + (f" | {result['error']}" if result.get("error") else ""))
    summary = {**run_manifest, **summarize_results(results_path, jobs_path)}
    (args.output_dir / "run_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("source status counts: " + json.dumps(summary["status_counts_by_source_group"], sort_keys=True))
    print(f"jobs added this run: {jobs_written}; all unique job records: {jobs_path}")
    if args.ingest:
        secret = os.environ.get("INGEST_SECRET")
        if not secret:
            print("ERROR: INGEST_SECRET is required with --ingest", file=sys.stderr)
            return 2
        base = os.environ.get("BASE_URL", "https://talent.skarion.com")
        from report_employer_career_ingest import build_report
        readiness = build_report(args.input, results_path, jobs_path, args.output_dir / "readiness", ADAPTER_VERSION)
        ready_path = Path(readiness["ready_jobs_path"])
        staged, skipped = post_batches(ready_path, base, secret)
        print(f"ingest summary: staged={staged}, skipped={skipped}")
    else:
        print("dry-run only: no data was posted to TalentOS (pass --ingest to stage jobs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
