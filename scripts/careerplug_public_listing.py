"""Parse CareerPlug's public listing HTML without opening application routes.

CareerPlug job links observed in this cohort redirect into ``/apps/new``.
The listing's first page can contain full JobPosting JSON-LD, but the current
Job CEO deep-fetch path would follow those links. Keep parsed jobs out of the
integration-ready set until that downstream behavior is reviewed.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import json
import re
from urllib.parse import parse_qs, urljoin, urlparse


_JSON_LD = re.compile(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.I | re.S)
_JOB_PATH = re.compile(r"^/jobs/(\d+)/?$", re.I)


@dataclass(frozen=True)
class CareerPlugListing:
    board_url: str
    posting_nodes: tuple[dict, ...]
    listing_complete: bool
    integration_complete: bool
    page_count: int
    reason: str


def board_url_for(source_url: str) -> str:
    """Canonical public listing for a verified CareerPlug tenant."""
    parsed = urlparse(source_url)
    host = (parsed.hostname or "").lower()
    if (
        parsed.scheme.lower() != "https"
        or not host.endswith(".careerplug.com")
        or host == "careerplug.com"
        or parsed.username
        or parsed.password
        or parsed.port
    ):
        raise ValueError("CareerPlug source must be an HTTPS tenant on careerplug.com")
    return f"https://{host}/jobs?locale=en-US"


class _ListingLinks(HTMLParser):
    def __init__(self, board_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.board_host = urlparse(board_url).hostname
        self.board_url = board_url
        self.job_ids: list[str] = []
        self.pages: set[int] = {1}
        self.has_next = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        attr = dict(attrs)
        href = attr.get("href") or ""
        target = urlparse(urljoin(self.board_url, href))
        if target.scheme != "https" or target.hostname != self.board_host:
            return
        match = _JOB_PATH.fullmatch(target.path)
        if match:
            self.job_ids.append(match.group(1))
        if target.path.rstrip("/") == "/jobs":
            for value in parse_qs(target.query).get("page", []):
                if value.isdecimal():
                    self.pages.add(int(value))
            rel = (attr.get("rel") or "").lower().split()
            self.has_next = self.has_next or "next" in rel or "next_page" in (attr.get("class") or "").lower().split()


def parse_board_listing(html: str, board_url: str, *, max_postings: int = 5000) -> CareerPlugListing:
    """Validate first-page JobPosting objects against visible job-card IDs."""
    if urlparse(board_url).path.rstrip("/") != "/jobs":
        raise ValueError("CareerPlug listing parser requires the public /jobs page")
    canonical = board_url_for(board_url)
    if max_postings < 1:
        raise ValueError("max_postings must be positive")
    links = _ListingLinks(canonical)
    try:
        links.feed(html)
        links.close()
    except Exception:
        return CareerPlugListing(canonical, (), False, False, 1, "listing HTML could not be parsed")

    lists: list[dict] = []
    for block in _JSON_LD.findall(html):
        try:
            node = json.loads(unescape(block.strip()))
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(node, dict) and node.get("@type") == "ItemList":
            lists.append(node)
    page_count = max(links.pages)
    if len(lists) != 1:
        return CareerPlugListing(canonical, (), False, False, page_count, "expected one structured ItemList on the first listing page")
    item_list = lists[0]
    elements = item_list.get("itemListElement")
    count = item_list.get("numberOfItems")
    if not isinstance(elements, list) or type(count) is not int or count != len(elements):
        return CareerPlugListing(canonical, (), False, False, page_count, "ItemList count did not match its entries")
    if count > max_postings:
        return CareerPlugListing(canonical, (), False, False, page_count, "first listing page exceeded posting cap")

    postings: list[dict] = []
    ids: list[str] = []
    for index, element in enumerate(elements, start=1):
        if not isinstance(element, dict) or element.get("@type") != "ListItem" or element.get("position") != index:
            return CareerPlugListing(canonical, tuple(postings), False, False, page_count, "ItemList positions were invalid")
        job = element.get("item")
        if not isinstance(job, dict) or job.get("@type") != "JobPosting":
            return CareerPlugListing(canonical, tuple(postings), False, False, page_count, "ItemList entry was not a JobPosting")
        identifier = job.get("identifier")
        job_id = str(identifier.get("value") or "") if isinstance(identifier, dict) else ""
        if not job_id.isdecimal() or not str(job.get("title") or "").strip() or not str(job.get("description") or "").strip():
            return CareerPlugListing(canonical, tuple(postings), False, False, page_count, "JobPosting lacked an ID, title, or description")
        ids.append(job_id)
        postings.append({**job, "url": f"https://{links.board_host}/jobs/{job_id}"})
    if len(ids) != len(set(ids)) or set(ids) != set(links.job_ids) or len(links.job_ids) != len(set(links.job_ids)):
        return CareerPlugListing(canonical, tuple(postings), False, False, page_count, "structured jobs did not match visible job cards")
    if links.has_next or page_count > 1:
        return CareerPlugListing(canonical, tuple(postings), False, False, page_count, "later listing pages lack full JobPosting data")
    return CareerPlugListing(
        canonical, tuple(postings), True, False, 1,
        "listing is complete; job URLs redirect to application forms and require a skip-deep-fetch integration path",
    )
