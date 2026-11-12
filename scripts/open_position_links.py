"""Find conservative same-host job candidates on unstructured career pages.

This parser makes no network requests and makes no completeness claim. It is
only a fallback for pages with a visible openings heading and job-title links.
The caller must fetch candidate details through its robots-aware request path.
"""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
import unicodedata
from urllib.parse import urljoin, urlparse, urlunparse


_OPENINGS_HEADING = re.compile(
    r"\b(?:open positions?|current openings?|job openings?|current employment opportunities|available positions?)\b",
    re.I,
)
_GENERIC_ANCHOR = re.compile(
    r"^(?:apply(?: now| here)?|learn more|read more|view (?:jobs|openings|positions)|"
    r"search jobs|open positions|submit (?:your )?(?:resume|application)|join (?:us|our team))$",
    re.I,
)
_APPLY_CUE = re.compile(r"\bapply\b|\bsubmit (?:your )?(?:application|resume)\b", re.I)


@dataclass(frozen=True)
class CandidateLink:
    url: str
    title: str


def _title_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[^a-z0-9]+", " ", normalized).strip()


class _CareerLinkParser(HTMLParser):
    def __init__(self, page_url: str, max_links: int) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.host = urlparse(page_url).hostname
        self.max_links = max_links
        self.heading_level: int | None = None
        self.heading_text: list[str] = []
        self.openings_level: int | None = None
        self.anchor_href: str | None = None
        self.anchor_text: list[str] = []
        self.links: list[CandidateLink] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden_depth += 1
            return
        if self.hidden_depth:
            return
        if re.fullmatch(r"h[1-6]", tag):
            self.heading_level = int(tag[1])
            self.heading_text = []
        if tag == "a" and self.openings_level is not None and len(self.links) < self.max_links:
            self.anchor_href = dict(attrs).get("href")
            self.anchor_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.hidden_depth:
            self.hidden_depth -= 1
            return
        if self.hidden_depth:
            return
        if tag == "a" and self.anchor_href is not None:
            title = re.sub(r"\s+", " ", " ".join(self.anchor_text)).strip()
            href = self.anchor_href
            self.anchor_href = None
            if 6 <= len(title) <= 160 and len(title.split()) >= 2 and not _GENERIC_ANCHOR.fullmatch(title):
                target = urlparse(urljoin(self.page_url, href))
                if target.scheme == "https" and target.hostname == self.host:
                    url = urlunparse((target.scheme, target.netloc, target.path, target.params, target.query, ""))
                    if url != self.page_url and all(existing.url != url for existing in self.links):
                        self.links.append(CandidateLink(url, title))
        if self.heading_level is not None and tag == f"h{self.heading_level}":
            title = re.sub(r"\s+", " ", " ".join(self.heading_text)).strip()
            if _OPENINGS_HEADING.search(title):
                self.openings_level = self.heading_level
            elif self.openings_level is not None and self.heading_level <= self.openings_level:
                self.openings_level = None
            self.heading_level = None
            self.heading_text = []

    def handle_data(self, data: str) -> None:
        if self.hidden_depth:
            return
        if self.heading_level is not None:
            self.heading_text.append(data)
        if self.anchor_href is not None:
            self.anchor_text.append(data)


def discover_open_position_links(html: str, page_url: str, *, max_links: int = 40) -> tuple[CandidateLink, ...]:
    """Return bounded candidates from an explicit openings section only."""
    parsed = urlparse(page_url)
    if parsed.scheme != "https" or not parsed.hostname or max_links < 1:
        return ()
    parser = _CareerLinkParser(page_url, max_links)
    parser.feed(html)
    return tuple(parser.links)


class _DetailEvidenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.heading_level: int | None = None
        self.heading_start = 0
        self.heading_text: list[str] = []
        self.headings: list[tuple[str, int]] = []
        self.visible: list[str] = []
        self.hidden_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.hidden_depth += 1
        elif not self.hidden_depth and re.fullmatch(r"h[1-6]", tag):
            self.heading_level = int(tag[1])
            self.heading_start = len(self.visible)
            self.heading_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.hidden_depth:
            self.hidden_depth -= 1
        elif not self.hidden_depth and self.heading_level is not None and tag == f"h{self.heading_level}":
            self.headings.append((" ".join(self.heading_text), self.heading_start))
            self.heading_level = None

    def handle_data(self, data: str) -> None:
        if not self.hidden_depth and data.strip():
            text = re.sub(r"\s+", " ", data).strip()
            self.visible.append(text)
            if self.heading_level is not None:
                self.heading_text.append(text)


def detail_matches_open_position(html: str, anchor_title: str, *, min_description_chars: int = 300) -> bool:
    """Require a matching heading, substantial visible content, and apply cue."""
    expected = _title_key(anchor_title)
    if not expected:
        return False
    parser = _DetailEvidenceParser()
    parser.feed(html)
    for title, start in parser.headings:
        if _title_key(title) != expected:
            continue
        after_heading = " ".join(parser.visible[start:])
        if len(after_heading) >= min_description_chars and _APPLY_CUE.search(after_heading):
            return True
    return False
