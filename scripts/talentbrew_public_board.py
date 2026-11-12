"""Enumerate public TalentBrew search-result HTML without using its feeds.

This module performs no requests. Its caller must fetch the listing and each
detail through the crawler's HTTPS, robots, and host-rate checked ``_request``.
The returned ``complete`` flag covers listing URLs only; job details must be
fetched and validated separately before a source can be called complete.
"""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
from typing import Callable
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse


_RESULT_COUNT = re.compile(r"\b(\d[\d,]*)\s+(?:jobs?\s+found|(?:search\s+)?results?(?:\s+found)?)\b", re.I)
_DISPLAYED_JOBS = re.compile(r"\b(\d[\d,]*)\s+jobs?\s+displayed\b", re.I)
_WE_FOUND = re.compile(r"\bwe\s+found\s+(\d[\d,]*)\s+jobs?\b", re.I)
_BRACKETED_RESULTS = re.compile(r"\b(\d[\d,]*)\s+result\[s\]", re.I)
_JOB_LISTINGS = re.compile(r"\bshowing\s+(\d[\d,]*)\s+job\s+listings\b", re.I)
_JUST_JOBS = re.compile(r"^\s*(\d[\d,]*)\s+jobs?\s*$", re.I)
_JOB_PATH = re.compile(r"(?:^|/)job/[^/]+/[^/]+/\d+/\d+/?$", re.I)
_NEXT_PAGE = re.compile(r"(?:[?&])p=(\d+)(?:[&#]|$)", re.I)
_SEARCH_PATH = re.compile(r"(?:^|/)search-jobs(?:/|$)", re.I)
_VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


@dataclass(frozen=True)
class SearchPage:
    url: str
    recognized: bool
    total: int | None
    current_page: int | None
    page_count: int | None
    posting_urls: tuple[str, ...]
    next_url: str | None
    issue: str | None
    posting_titles: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class BoardEnumeration:
    posting_urls: tuple[str, ...]
    declared_total: int | None
    pages_fetched: int
    complete: bool
    reason: str
    posting_titles: tuple[tuple[str, str], ...] = ()


class _SearchParser(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.netloc = urlparse(page_url).netloc.lower()
        self.container_tag: str | None = None
        self.container_depth = 0
        self.saw_results_list = False
        self.saw_talentbrew_asset = False
        self.posting_urls: list[str] = []
        self.invalid_cards = 0
        self.posting_titles: dict[str, str] = {}
        self.card_url: str | None = None
        self.card_depth = 0
        self.card_direct_parts: list[str] = []
        self.card_title_depth = 0
        self.card_title_parts: list[str] = []
        self.card_titles: list[str] = []
        self.headings: list[str] = []
        self.heading_tag: str | None = None
        self.heading_parts: list[str] = []
        self.page_controls: list[tuple[str | None, str | None]] = []
        self.next_links: list[tuple[str, bool]] = []
        self.result_counts: list[int] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if self.card_url is not None and tag not in _VOID_TAGS:
            self.card_depth += 1
            if self.card_title_depth:
                self.card_title_depth += 1
        classes = set((attr.get("class") or "").lower().split())
        if (self.card_url is not None and not self.card_title_depth
                and (tag in ("h1", "h2", "h3") or (tag == "span" and "job-title" in classes))):
            self.card_title_depth = 1
            self.card_title_parts = []
        asset = ((attr.get("src") or "") + " " + (attr.get("href") or "")).lower()
        if "tbcdn.talentbrew.com" in asset or "cdn.radancy.eu" in asset:
            self.saw_talentbrew_asset = True
        if attr.get("id") == "search-results-jobs":
            count = attr.get("data-results-count") or ""
            if count.replace(",", "").isdigit():
                self.result_counts.append(int(count.replace(",", "")))
        if attr.get("id") == "search-results":
            # Some boards omit a visible count heading. This is the job total
            # on the public result section; data-total-results may also count
            # non-job search hits, so it is intentionally ignored.
            count = attr.get("data-total-job-results") or ""
            if count.replace(",", "").isdigit():
                self.result_counts.append(int(count.replace(",", "")))
        if tag in ("h1", "h2", "h3") and self.heading_tag is None:
            self.heading_tag = tag
            self.heading_parts = []
        if attr.get("id") == "search-results-list" and self.container_tag is None:
            self.container_tag = tag
            self.container_depth = 0
            self.saw_results_list = True
        if self.container_tag == tag:
            self.container_depth += 1
        if tag == "input" and "pagination-current" in classes:
            self.page_controls.append((attr.get("value"), attr.get("max")))
        if tag != "a":
            return
        if "next" in classes:
            self.next_links.append((attr.get("href") or "", "disabled" in classes))
        if self.container_tag is None:
            return
        href = attr.get("href") or ""
        target = urlparse(urljoin(self.page_url, href))
        job_id = str(attr.get("data-job-id") or target.path.rstrip("/").split("/")[-1])
        if (
            target.scheme == "https"
            and target.netloc.lower() == self.netloc
            and not target.username
            and not target.password
            and _JOB_PATH.search(target.path)
            and target.path.rstrip("/").split("/")[-1] == job_id
        ):
            posting_url = urlunparse((target.scheme, target.netloc, target.path.rstrip("/"), "", "", ""))
            self.posting_urls.append(posting_url)
            if self.card_url is None:
                self.card_url = posting_url
                self.card_depth = 0
                self.card_direct_parts = []
                self.card_title_depth = 0
                self.card_title_parts = []
                self.card_titles = []
            else:
                self.invalid_cards += 1
        elif attr.get("data-job-id"):
            self.invalid_cards += 1

    def handle_endtag(self, tag: str) -> None:
        if self.card_title_depth:
            self.card_title_depth -= 1
            if not self.card_title_depth:
                self.card_titles.append(" ".join(self.card_title_parts).strip())
                self.card_title_parts = []
        if self.card_url is not None:
            if tag == "a" and self.card_depth == 0:
                headings = list(dict.fromkeys(" ".join(value.split()) for value in self.card_titles if value.strip()))
                title = headings[0] if len(headings) == 1 else " ".join(" ".join(self.card_direct_parts).split()) if not headings else ""
                if title:
                    self.posting_titles.setdefault(self.card_url, title)
                self.card_url = None
                self.card_direct_parts = []
                self.card_titles = []
            elif self.card_depth:
                self.card_depth -= 1
        if self.heading_tag == tag:
            self.headings.append(" ".join(self.heading_parts).strip())
            self.heading_tag = None
            self.heading_parts = []
        if self.container_tag == tag:
            self.container_depth -= 1
            if self.container_depth == 0:
                self.container_tag = None

    def handle_data(self, data: str) -> None:
        if self.card_url is not None:
            if self.card_title_depth:
                self.card_title_parts.append(data)
            elif self.card_depth == 0 and data.strip():
                self.card_direct_parts.append(data)
        if self.heading_tag and data.strip():
            self.heading_parts.append(data.strip())


class _SearchLinks(HTMLParser):
    def __init__(self, source_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.source_url = source_url
        self.netloc = urlparse(source_url).netloc.lower()
        self.saw_talentbrew_asset = False
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        asset = ((attr.get("src") or "") + " " + (attr.get("href") or "")).lower()
        if "tbcdn.talentbrew.com" in asset or "cdn.radancy.eu" in asset:
            self.saw_talentbrew_asset = True
        if tag != "a" or not attr.get("href"):
            return
        target = urlparse(urljoin(self.source_url, attr["href"] or ""))
        if (
            target.scheme == "https"
            and target.netloc.lower() == self.netloc
            and not target.username
            and not target.password
            and _SEARCH_PATH.search(target.path)
            and not re.search(r"(?:^|/)(?:apply|application|form)(?:/|$)", target.path, re.I)
        ):
            self.links.append(urlunparse((target.scheme, target.netloc, target.path, "", target.query, "")))


def discover_same_host_search_links(html: str, source_url: str, *, max_links: int = 10) -> tuple[str, ...]:
    """Find public search-page links on a TalentBrew employer landing page."""
    parsed = urlparse(source_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return ()
    parser = _SearchLinks(source_url)
    parser.feed(html)
    if not parser.saw_talentbrew_asset:
        return ()
    links = list(dict.fromkeys(parser.links))
    links.sort(key=lambda url: (bool(urlparse(url).query), len(urlparse(url).path), url))
    return tuple(links[:max_links])


def _page_url(listing_url: str, page: int) -> str:
    parsed = urlparse(listing_url)
    query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key.lower() != "p"]
    query.append(("p", str(page)))
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", urlencode(query), ""))


def parse_search_page(html: str, page_url: str, *, expected_page_count: int | None = None) -> SearchPage:
    """Parse one server-rendered result page and validate its visible controls."""
    parsed_url = urlparse(page_url)
    if parsed_url.scheme != "https" or not parsed_url.hostname or parsed_url.username or parsed_url.password:
        raise ValueError("TalentBrew listing must be a public HTTPS URL")
    parser = _SearchParser(page_url)
    parser.feed(html)
    urls = tuple(dict.fromkeys(parser.posting_urls))
    issues: list[str] = []
    recognized = parser.saw_talentbrew_asset and parser.saw_results_list
    if not recognized:
        issues.append("TalentBrew search-results layout was not verified")
    if parser.container_tag is not None:
        issues.append("search-results list did not close")
    if parser.invalid_cards:
        issues.append("result list has invalid job cards")
    if len(parser.posting_urls) != len(urls):
        issues.append("result list has duplicate job card URLs")
    if parser.card_url is not None or any(url not in parser.posting_titles for url in urls):
        issues.append("result list has missing or ambiguous job card titles")
    patterns = (_RESULT_COUNT, _DISPLAYED_JOBS, _WE_FOUND, _BRACKETED_RESULTS, _JOB_LISTINGS, _JUST_JOBS)
    heading_counts = {int(m.group(1).replace(",", "")) for heading in parser.headings for pattern in patterns for m in pattern.finditer(heading)}
    counts = heading_counts | set(parser.result_counts)
    total = next(iter(counts)) if len(counts) == 1 else None
    if total is None:
        issues.append("missing or inconsistent visible result total")
    controls: set[tuple[int, int]] = set()
    for current, maximum in parser.page_controls:
        try:
            controls.add((int(current or ""), int(maximum or "")))
        except ValueError:
            issues.append("invalid pagination control")
    if len(controls) > 1:
        expected_pages = expected_page_count
        if expected_pages is None and total is not None and urls:
            expected_pages = (total + len(urls) - 1) // len(urls)
        if expected_pages is not None:
            controls = {control for control in controls if control[1] == expected_pages}
    if len(controls) > 1:
        issues.append("pagination controls disagree")
    current_page, page_count = next(iter(controls)) if len(controls) == 1 else (None, None)
    if not controls and total is not None and total <= len(urls):
        current_page = page_count = 1
    if current_page is None or page_count is None or current_page < 1 or page_count < current_page:
        issues.append("missing or invalid current/last page")
    if total is not None and ((total == 0 and urls) or (total > 0 and not urls)):
        issues.append("visible total conflicts with job cards")
    active_next = [(href, disabled) for href, disabled in parser.next_links if not disabled]
    next_url: str | None = None
    if current_page is not None and page_count is not None:
        if current_page < page_count:
            targets: set[int] = set()
            for href, _ in active_next:
                target = urlparse(urljoin(page_url, href))
                match = _NEXT_PAGE.search(href)
                if (
                    target.scheme == "https"
                    and target.netloc.lower() == parsed_url.netloc.lower()
                    and "search-jobs" in target.path.lower()
                    and match
                ):
                    targets.add(int(match.group(1)))
            if targets == {current_page + 1}:
                # Some TalentBrew templates expose /search-jobs&p=N, which
                # redirects to the homepage. Preserve the current listing
                # path and use the visible page number as a query parameter.
                next_url = _page_url(page_url, current_page + 1)
            else:
                issues.append("Next link does not identify the next same-host result page")
        elif active_next:
            issues.append("last page still has an active Next link")
    titles = tuple((url, parser.posting_titles[url]) for url in urls if url in parser.posting_titles)
    return SearchPage(page_url, recognized, total, current_page, page_count, urls, next_url, "; ".join(dict.fromkeys(issues)) or None, titles)


def enumerate_search_pages(
    first_html: str,
    first_url: str,
    fetch_page: Callable[[str], tuple[str, str]],
    *,
    max_postings: int = 5000,
    max_pages: int = 1000,
) -> BoardEnumeration:
    """Enumerate visible job URLs; fetch_page must enforce robots and host rate."""
    pages_fetched = 0
    found: list[str] = []
    found_titles: list[tuple[str, str]] = []
    seen: set[str] = set()
    expected_total: int | None = None
    expected_pages: int | None = None
    html, url = first_html, first_url
    origin = urlparse(first_url)

    def finish(complete: bool, reason: str) -> BoardEnumeration:
        return BoardEnumeration(tuple(found), expected_total, pages_fetched, complete, reason, tuple(found_titles))

    while True:
        if pages_fetched >= max_pages:
            return finish(False, "TalentBrew page cap reached")
        current = urlparse(url)
        if current.scheme != "https" or current.netloc.lower() != origin.netloc.lower() or current.path != origin.path:
            return finish(False, "TalentBrew listing left the original HTTPS path")
        try:
            page = parse_search_page(html, url, expected_page_count=expected_pages)
        except (TypeError, ValueError) as exc:
            return finish(False, f"TalentBrew page could not be parsed: {str(exc)[:180]}")
        pages_fetched += 1
        page_titles = dict(page.posting_titles)
        for posting_url in page.posting_urls:
            if posting_url in seen:
                return finish(False, "TalentBrew repeated a job across pages")
            seen.add(posting_url)
            found.append(posting_url)
            if posting_url in page_titles:
                found_titles.append((posting_url, page_titles[posting_url]))
        if expected_total is None:
            expected_total, expected_pages = page.total, page.page_count
            if expected_total is not None and expected_total > max_postings:
                return finish(False, "TalentBrew result total exceeds posting cap")
        if page.issue:
            return finish(False, page.issue)
        if page.total != expected_total or page.page_count != expected_pages or page.current_page != pages_fetched:
            return finish(False, "TalentBrew total or pagination changed during enumeration")
        if len(found) > max_postings:
            return finish(False, "TalentBrew posting cap reached")
        if page.next_url is None:
            complete = len(found) == expected_total and pages_fetched == expected_pages
            reason = "TalentBrew enumerated the visible total" if complete else "TalentBrew card count did not match the visible total"
            return finish(complete, reason)
        try:
            html, url = fetch_page(page.next_url)
        except Exception as exc:
            return finish(False, f"TalentBrew next page failed: {str(exc)[:180]}")
