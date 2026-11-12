"""Parse the public, server-rendered JazzHR career listing.

This module performs no network requests. The caller must check robots and
source-use rights before requesting the tenant's /apply/ listing and each job
detail page. It deliberately does not use undocumented JazzHR feed endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
from urllib.parse import urljoin, urlparse, urlunparse


_POSTING_PATH = re.compile(r"^/apply/[A-Za-z0-9_-]{5,}(?:/|$)", re.I)
_EMPTY_MESSAGE = re.compile(r"there\s+are\s+no\s+open\s+positions\s+at\s+this\s+time", re.I)


@dataclass(frozen=True)
class JazzHrListing:
    board_url: str
    posting_urls: tuple[str, ...]
    complete: bool
    reason: str


def board_url_for(source_url: str) -> str:
    """Use the tenant's public listing, even when the tracker has a detail URL."""
    parsed = urlparse(source_url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme.lower() != "https"
        or not host.endswith(".applytojob.com")
        or host == "applytojob.com"
        or parsed.username
        or parsed.password
        or parsed.port
    ):
        raise ValueError("JazzHR source must be an HTTPS tenant on applytojob.com")
    return f"https://{host}/apply/"


class _ListingParser(HTMLParser):
    def __init__(self, board_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.board_url = board_url
        self.board_host = urlparse(board_url).hostname
        self.jobs_div_depth = 0
        self.item_li_depth = 0
        self.item_count = 0
        self.item_urls: list[str] = []
        self.invalid_items = 0
        self.urls: list[str] = []
        self.pagination = False
        self.seen_jobs_list = False
        self.text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        classes = set((attr.get("class") or "").lower().split())
        if "pagination" in classes or "load-more" in classes or (tag == "a" and (attr.get("rel") or "").lower() == "next"):
            self.pagination = True
        if tag == "a":
            parsed_href = urlparse(attr.get("href") or "")
            if re.search(r"(?:^|[?&])(?:page|offset|start)=\d+", parsed_href.query, re.I) or re.search(r"/page/\d+", parsed_href.path, re.I):
                self.pagination = True
        if tag == "div":
            if self.jobs_div_depth:
                self.jobs_div_depth += 1
            elif "jobs-list" in classes:
                self.jobs_div_depth = 1
                self.seen_jobs_list = True
        if not self.jobs_div_depth:
            return
        if tag == "li":
            if self.item_li_depth:
                self.item_li_depth += 1
            elif "list-group-item" in classes:
                self.item_li_depth = 1
                self.item_count += 1
                self.item_urls = []
        if tag == "a":
            href = attr.get("href") or ""
            if self.item_li_depth:
                resolved = urlparse(urljoin(self.board_url, href))
                if resolved.scheme == "https" and resolved.hostname == self.board_host and _POSTING_PATH.match(resolved.path):
                    self.item_urls.append(urlunparse((resolved.scheme, resolved.netloc, resolved.path, "", "", "")))

    def handle_endtag(self, tag: str) -> None:
        if not self.jobs_div_depth:
            return
        if tag == "li" and self.item_li_depth:
            self.item_li_depth -= 1
            if not self.item_li_depth:
                unique = list(dict.fromkeys(self.item_urls))
                if len(unique) != 1:
                    self.invalid_items += 1
                else:
                    self.urls.append(unique[0])
                self.item_urls = []
        if tag == "div":
            self.jobs_div_depth -= 1

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.text.append(data.strip())


def parse_board_listing(html: str, source_url: str, *, max_postings: int = 5000) -> JazzHrListing:
    """Return complete only for a recognized, unpaginated posting set."""
    board_url = board_url_for(source_url)
    parser = _ListingParser(board_url)
    parser.feed(html)
    text = " ".join(parser.text)
    urls = tuple(dict.fromkeys(parser.urls))
    if "inactive career page" in text.lower():
        return JazzHrListing(board_url, urls, False, "JazzHR career page is inactive")
    if parser.pagination:
        return JazzHrListing(board_url, urls, False, "JazzHR listing has pagination or load-more controls")
    if not parser.seen_jobs_list:
        return JazzHrListing(board_url, urls, False, "JazzHR jobs-list layout was not present")
    if parser.item_li_depth or parser.jobs_div_depth:
        return JazzHrListing(board_url, urls, False, "JazzHR listing markup ended before the jobs list closed")
    if parser.item_count > max_postings:
        return JazzHrListing(board_url, urls, False, "JazzHR listing exceeds the posting cap")
    if parser.invalid_items or len(urls) != parser.item_count:
        return JazzHrListing(board_url, urls, False, "JazzHR listing has missing or duplicate posting links")
    if not urls:
        if _EMPTY_MESSAGE.search(text):
            return JazzHrListing(board_url, (), True, "JazzHR board explicitly reports no open positions")
        return JazzHrListing(board_url, (), False, "JazzHR board has no validated postings or explicit empty state")
    if _EMPTY_MESSAGE.search(text):
        return JazzHrListing(board_url, urls, False, "JazzHR board has contradictory jobs and empty-state text")
    return JazzHrListing(board_url, urls, True, "JazzHR public listing enumerated every visible posting")
