"""Validate server-rendered public SuccessFactors All-Jobs pages.

This module performs no I/O. The crawler must fetch each listing and job detail
through its HTTPS, robots, redirect, and per-host rate checks. Other
SuccessFactors layouts remain partial until they have separate validation.
"""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
import unicodedata
from typing import Any, Callable
from urllib.parse import parse_qsl, urljoin, urlsplit, urlunsplit


_GO_PATH = re.compile(r"^/go/All-Jobs/(\d+)(?:/(\d+))?/?$", re.I)
_JOB_PATH = re.compile(r"^/job/[^/]+/(\d+)/?$", re.I)
_TOTAL = re.compile(r"\bPage\s+(\d+)\s+of\s+(\d+)\s*,\s*Results\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\b", re.I)
_PAGE_TITLE = re.compile(r"^Page\s+(\d+)$", re.I)
_MAX_POSTINGS = 5000
_MAX_PAGES = 1000


@dataclass(frozen=True)
class GoPage:
    url: str
    page: int | None
    pages: int | None
    first_result: int | None
    last_result: int | None
    total: int | None
    posting_titles: tuple[tuple[str, str], ...]
    next_url: str | None
    issue: str | None


@dataclass(frozen=True)
class GoEnumeration:
    posting_titles: tuple[tuple[str, str], ...]
    declared_total: int | None
    pages_fetched: int
    complete: bool
    reason: str


@dataclass(frozen=True)
class PublicDetail:
    job: dict[str, Any] | None
    complete: bool
    reason: str | None


def _title(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _public_url(url: str, pattern: re.Pattern[str]) -> tuple[str, re.Match[str], str] | None:
    try:
        parsed = urlsplit(url)
        if (parsed.scheme.lower() != "https" or not parsed.hostname
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.fragment
                or any(key.casefold() in {"apply", "application", "form"} for key, _ in parse_qsl(parsed.query))):
            return None
    except ValueError:
        return None
    match = pattern.fullmatch(parsed.path)
    if not match:
        return None
    return parsed.hostname.casefold(), match, urlunsplit(("https", parsed.netloc.casefold(), parsed.path, parsed.query, ""))


class _ListingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.table_depth = 0
        self.table_aria: list[str] = []
        self.cards: list[tuple[str, str]] = []
        self.page_links: list[tuple[int, str]] = []
        self.anchor_href: str | None = None
        self.anchor_text: list[str] = []
        self.invalid_cards = 0
        self.discovered_go_links: list[str] = []

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        if tag == "table":
            if self.table_depth:
                self.table_depth += 1
            elif attrs.get("id") == "searchresults":
                self.table_depth = 1
                self.table_aria.append(attrs.get("aria-label") or "")
        if tag != "a":
            return
        href = attrs.get("href") or ""
        if _GO_PATH.fullmatch(urlsplit(href).path):
            self.discovered_go_links.append(href)
        title_match = _PAGE_TITLE.fullmatch((attrs.get("title") or "").strip())
        if title_match:
            self.page_links.append((int(title_match.group(1)), href))
        if self.table_depth and "jobTitle-link" in (attrs.get("class") or "").split():
            if self.anchor_href is not None:
                self.invalid_cards += 1
            else:
                self.anchor_href = href
                self.anchor_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.anchor_href is not None:
            self.cards.append((self.anchor_href, " ".join("".join(self.anchor_text).split())))
            self.anchor_href = None
            self.anchor_text = []
        if tag == "table" and self.table_depth:
            self.table_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.anchor_href is not None:
            self.anchor_text.append(data)


class _DetailHTMLParser(HTMLParser):
    """Collect one visible schema.org description and matching page title."""

    _VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[dict[str, Any]] = []
        self.job_roots = 0
        self.description_count = 0
        self.description_depth = 0
        self.description_parts: list[str] = []
        self.title_depth = 0
        self.title_parts: list[str] = []
        self.title_candidates: list[str] = []

    def handle_starttag(self, tag: str, attrs_list: list[tuple[str, str | None]]) -> None:
        attrs = dict(attrs_list)
        itemtype = (attrs.get("itemtype") or "").casefold()
        starts_root = bool("itemscope" in attrs and "jobposting" in itemtype)
        if starts_root:
            self.job_roots += 1
        inside_root = starts_root or any(frame["inside_root"] for frame in self.stack)
        props = set((attrs.get("itemprop") or "").casefold().split())
        starts_description = inside_root and "description" in props
        if starts_description:
            self.description_count += 1
        description_depth = self.description_depth + 1 if self.description_depth or starts_description else 0
        starts_title = inside_root and "title" in props and tag.casefold() not in self._VOID_TAGS
        title_depth = self.title_depth + 1 if self.title_depth or starts_title else 0

        if tag.casefold() == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").casefold()
            value = (attrs.get("content") or "").strip()
            if value and (key in {"og:title", "twitter:title"} or (inside_root and "title" in props)):
                self.title_candidates.append(value)
        if tag.casefold() not in self._VOID_TAGS:
            self.stack.append({
                "tag": tag.casefold(),
                "inside_root": inside_root,
                "description_depth": description_depth,
                "title_depth": title_depth,
            })
            self.description_depth = description_depth
            self.title_depth = title_depth

    def handle_data(self, data: str) -> None:
        if self.description_depth and data.strip():
            self.description_parts.append(data)
        if self.title_depth and data.strip():
            self.title_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        wanted = tag.casefold()
        index = next((i for i in range(len(self.stack) - 1, -1, -1)
                      if self.stack[i]["tag"] == wanted), None)
        if index is None:
            return
        popped = self.stack[index:]
        del self.stack[index:]
        for frame in reversed(popped):
            if frame["description_depth"]:
                self.description_depth -= 1
            if frame["title_depth"]:
                self.title_depth -= 1
        if popped and popped[0]["title_depth"] and not self.title_depth:
            title = " ".join("".join(self.title_parts).split())
            if title:
                self.title_candidates.append(title)
            self.title_parts = []


def validate_detail_html(listed_url: str, response_url: str, response_status: int,
                         expected_title: str, html: str, postings: list[dict[str, Any]],
                         employer: str) -> PublicDetail:
    """Use the public card and detail URL to fill missing microdata title/URL fields."""
    verified = validate_detail(listed_url, response_url, response_status, expected_title, postings)
    if verified.complete or verified.reason != "public detail lacked exactly one matching JobPosting":
        return verified
    listed = _public_url(listed_url, _JOB_PATH)
    returned = _public_url(response_url, _JOB_PATH)
    if (listed is None or returned is None or returned[0] != listed[0]
            or returned[1].group(1) != listed[1].group(1) or response_status != 200):
        return verified
    parser = _DetailHTMLParser()
    try:
        parser.feed(html)
        parser.close()
    except (TypeError, ValueError):
        return PublicDetail(None, False, "public detail HTML could not be parsed")
    if parser.job_roots != 1 or parser.description_count != 1:
        return PublicDetail(None, False, "public detail lacked one JobPosting root and one description")
    matching_titles = [title for title in parser.title_candidates if _title(title) == _title(expected_title)]
    conflicting_titles = [title for title in parser.title_candidates if _title(title) != _title(expected_title)]
    if not matching_titles or conflicting_titles:
        return PublicDetail(None, False, "public detail HTML title did not match its listing card")
    description = " ".join(" ".join(parser.description_parts).split())
    if len(description) <= 200:
        return PublicDetail(None, False, "public detail HTML description was too short")
    job = {
        "title": expected_title,
        "company": employer,
        "location": None,
        "source_url": returned[2],
        "external_job_id": listed[1].group(1),
        "description_text": description,
        "snippet": description[:300],
        "raw": {"ats": "successfactors", "structured_data_format": "microdata-card-validated"},
    }
    return PublicDetail(job, True, None)


def discover_all_jobs_link(html: str, source_url: str) -> str | None:
    """Find one explicitly linked public All-Jobs board on a branded page."""
    if _public_url(source_url, re.compile(r"^/.*$")) is None:
        return None
    if not re.search(r"successfactors|jobs2web|/platform/js/j2w/", html, re.I):
        return None
    parser = _ListingParser()
    parser.feed(html)
    source_host = urlsplit(source_url).hostname
    candidates: dict[str, set[str]] = {}
    for href in parser.discovered_go_links:
        resolved = urljoin(source_url, href)
        parts = _public_url(resolved, _GO_PATH)
        if (parts is None or parts[0] != source_host.casefold()
                or parts[1].group(2) is not None or not _unfiltered_go_query(resolved)):
            continue
        candidates.setdefault(urlsplit(resolved).path, set()).add(resolved)
    if len(candidates) != 1:
        return None
    aliases = next(iter(candidates.values()))
    no_query = [url for url in aliases if not urlsplit(url).query]
    return next(iter(no_query)) if len(no_query) == 1 else next(iter(aliases)) if len(aliases) == 1 else None


def _unfiltered_go_query(url: str) -> bool:
    """A locale can change presentation, but a search query can narrow jobs."""
    query = parse_qsl(urlsplit(url).query, keep_blank_values=True)
    return not query or (len(query) == 1 and query[0][0].casefold() == "locale"
                         and bool(re.fullmatch(r"[a-z]{2}_[A-Z]{2}", query[0][1])))


def is_public_all_jobs_url(url: str) -> bool:
    """Identify only an unfiltered first page of the public All-Jobs layout."""
    parts = _public_url(url, _GO_PATH)
    return parts is not None and parts[1].group(2) is None and _unfiltered_go_query(url)


def parse_go_page(html: str, page_url: str) -> GoPage:
    """Require a declared result range, public job cards, and visible next URL."""
    board = _public_url(page_url, _GO_PATH)
    if board is None:
        raise ValueError("SuccessFactors page is not a public HTTPS All-Jobs URL")
    parser = _ListingParser()
    parser.feed(html)
    issues: list[str] = []
    if len(parser.table_aria) != 1:
        issues.append("expected one search-results table")
    if parser.invalid_cards or parser.anchor_href is not None or parser.table_depth:
        issues.append("job cards or search-results table were not well formed")
    match = _TOTAL.search(parser.table_aria[0]) if len(parser.table_aria) == 1 else None
    if match is None:
        issues.append("search-results table omitted its exact page/range/total")
        page = pages = first = last = total = None
    else:
        page, pages, first, last, total = (int(value) for value in match.groups())
        if page < 1 or pages < page or total < 0 or (total and not (1 <= first <= last <= total)):
            issues.append("invalid page/range/total")
        if not total and (first != 0 or last != 0 or pages != 1):
            issues.append("invalid empty result range")
    job_titles: dict[str, str] = {}
    for href, title in parser.cards:
        resolved = urljoin(page_url, href)
        detail = _public_url(resolved, _JOB_PATH)
        if detail is None or detail[0] != board[0] or not _title(title):
            issues.append("invalid public job card")
            continue
        canonical = urlunsplit(("https", board[0], urlsplit(resolved).path, "", ""))
        previous = job_titles.get(canonical)
        if previous is not None and _title(previous) != _title(title):
            issues.append("duplicate job card has conflicting titles")
        job_titles.setdefault(canonical, title)
    if total is not None and len(job_titles) != (last - first + 1 if total else 0):
        issues.append("job card count did not match the visible result range")
    next_url: str | None = None
    if page is not None and pages is not None and page < pages:
        candidates = {
            resolved for page_number, href in parser.page_links
            if page_number == page + 1
            and (resolved := urljoin(page_url, href))
            and (parts := _public_url(resolved, _GO_PATH)) is not None
            and parts[0] == board[0]
            and parts[1].group(1) == board[1].group(1)
            and parts[1].group(2) == str(last)
        }
        if len(candidates) == 1:
            next_url = next(iter(candidates))
        else:
            issues.append("next page link was missing or left the All-Jobs board")
    return GoPage(page_url, page, pages, first, last, total,
                  tuple(job_titles.items()), next_url, "; ".join(dict.fromkeys(issues)) or None)


def enumerate_go_pages(first_html: str, first_url: str, fetch_page: Callable[[str], tuple[str, str]],
                       *, max_postings: int = _MAX_POSTINGS, max_pages: int = _MAX_PAGES) -> GoEnumeration:
    """Enumerate pages only through their visible same-board pagination links."""
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    total: int | None = None
    pages: int | None = None
    html, url = first_html, first_url
    page_count = 0
    while True:
        if page_count >= max_pages:
            return GoEnumeration(tuple(found), total, page_count, False, "All-Jobs page cap reached")
        try:
            current = parse_go_page(html, url)
        except (TypeError, ValueError) as exc:
            return GoEnumeration(tuple(found), total, page_count, False, f"All-Jobs page invalid: {str(exc)[:160]}")
        page_count += 1
        if current.issue:
            return GoEnumeration(tuple(found), total, page_count, False, current.issue)
        if page_count == 1:
            total, pages = current.total, current.pages
            if total is not None and total > max_postings:
                return GoEnumeration(tuple(found), total, page_count, False, "All-Jobs posting cap reached")
        if current.page != page_count or current.total != total or current.pages != pages:
            return GoEnumeration(tuple(found), total, page_count, False, "All-Jobs total or page order changed")
        for job_url, title in current.posting_titles:
            if job_url in seen:
                return GoEnumeration(tuple(found), total, page_count, False, "All-Jobs repeated a job across pages")
            seen.add(job_url)
            found.append((job_url, title))
        if len(found) > max_postings:
            return GoEnumeration(tuple(found), total, page_count, False, "All-Jobs posting cap reached")
        if current.next_url is None:
            complete = page_count == pages and len(found) == total
            return GoEnumeration(tuple(found), total, page_count, complete,
                                 "All-Jobs enumerated its visible total" if complete else "All-Jobs ended before its visible total")
        try:
            html, url = fetch_page(current.next_url)
        except Exception as exc:
            return GoEnumeration(tuple(found), total, page_count, False, f"All-Jobs next page failed: {str(exc)[:160]}")


def validate_detail(listed_url: str, response_url: str, response_status: int,
                    expected_title: str, postings: list[dict[str, Any]]) -> PublicDetail:
    """Accept exactly one full JobPosting matching the listed host, ID, and title."""
    listed = _public_url(listed_url, _JOB_PATH)
    returned = _public_url(response_url, _JOB_PATH)
    if listed is None or returned is None or returned[0] != listed[0] or returned[1].group(1) != listed[1].group(1):
        return PublicDetail(None, False, "public detail left its listed host or job ID")
    if response_status != 200:
        return PublicDetail(None, False, f"public detail returned HTTP {response_status}")
    matches = [job for job in postings
               if (parts := _public_url(str(job.get("source_url") or ""), _JOB_PATH)) is not None
               and parts[0] == listed[0] and parts[1].group(1) == listed[1].group(1)]
    if len(matches) != 1:
        return PublicDetail(None, False, "public detail lacked exactly one matching JobPosting")
    job = matches[0]
    if _title(str(job.get("title") or "")) != _title(expected_title):
        return PublicDetail(None, False, "public detail title did not match its listing card")
    if len(str(job.get("description_text") or "").strip()) <= 200:
        return PublicDetail(None, False, "public detail description was too short")
    verified = dict(job)
    verified["source_url"] = returned[2]
    verified["external_job_id"] = listed[1].group(1)
    return PublicDetail(verified, True, None)
