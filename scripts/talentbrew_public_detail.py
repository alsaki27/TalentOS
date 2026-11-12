"""Parse a public TalentBrew job detail without making network requests.

The caller must fetch the listed detail URL through the crawler's robots,
HTTPS, redirect, and host-rate checks. This parser independently checks that
the returned page still describes the exact listed job and has one bounded,
substantial ATS description. It never follows links or reads application data.
"""

from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import re
import unicodedata
from urllib.parse import urlsplit, urlunsplit


_JOB_PATH = re.compile(r"(?:^|/)job/[^/]+/[^/]+/(\d+)/(\d+)/?$", re.I)
_APPLICATION_SEGMENTS = {"apply", "application", "applications", "form", "forms"}
_BLOCK_TAGS = {"br", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "section", "table", "td", "th", "tr", "ul"}
_SKIP_TAGS = {"script", "style", "template", "noscript"}
_MAX_HTML_CHARS = 8_000_000
_MAX_DESCRIPTION_CHARS = 100_000


@dataclass(frozen=True)
class TalentBrewDetail:
    title: str | None
    source_url: str | None
    description_text: str | None
    external_job_id: str | None
    complete: bool
    reason: str | None


def _normalized_title(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def _job_url_parts(url: str) -> tuple[str, str, str, str] | None:
    try:
        parsed = urlsplit(url)
        if (parsed.scheme.lower() != "https" or not parsed.hostname
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.query or parsed.fragment):
            return None
    except ValueError:
        return None
    if any(segment.casefold() in _APPLICATION_SEGMENTS for segment in parsed.path.split("/")):
        return None
    match = _JOB_PATH.search(parsed.path)
    if not match:
        return None
    canonical = urlunsplit(("https", parsed.netloc.lower(), parsed.path.rstrip("/"), "", ""))
    return parsed.hostname.lower(), match.group(1), match.group(2), canonical


class _DetailParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.section_depth = 0
        self.active_marker_depths: list[int] = []
        self.markers: list[tuple[str | None, str | None]] = []
        self.heading_tag: str | None = None
        self.heading_parts: list[str] = []
        self.headings: list[str] = []
        self.skip_depth = 0
        self.container_count = 0
        self.description_div_depth = 0
        self.description_parts: list[str] = []
        self.description_chars = 0
        self.description_too_long = False
        self.description_closed = False

    def _append_description(self, value: str) -> None:
        self.description_chars += len(value)
        if self.description_chars > _MAX_DESCRIPTION_CHARS:
            self.description_too_long = True
        elif not self.description_too_long:
            self.description_parts.append(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag in _SKIP_TAGS:
            self.skip_depth += 1
        if tag == "section":
            self.section_depth += 1
            if (attr.get("data-selector-name") or "").casefold() == "jobdetails":
                self.markers.append((attr.get("data-job-id"), attr.get("data-org-id")))
                self.active_marker_depths.append(self.section_depth)
        if tag in ("h1", "h2", "h3") and self.heading_tag is None and not self.skip_depth:
            self.heading_tag = tag
            self.heading_parts = []
        if self.description_div_depth:
            if tag == "div":
                self.description_div_depth += 1
            if tag in _BLOCK_TAGS:
                self._append_description(" ")
        if tag == "div" and "ats-description" in (attr.get("class") or "").split() and self.active_marker_depths:
            self.container_count += 1
            if not self.description_div_depth:
                self.description_div_depth = 1
                self.description_parts = []
                self.description_chars = 0

    def handle_endtag(self, tag: str) -> None:
        if self.heading_tag == tag:
            self.headings.append(" ".join(self.heading_parts).strip())
            self.heading_tag = None
            self.heading_parts = []
        if self.description_div_depth:
            if tag in _BLOCK_TAGS:
                self._append_description(" ")
            if tag == "div":
                self.description_div_depth -= 1
                if not self.description_div_depth:
                    self.description_closed = True
        if tag == "section":
            if self.active_marker_depths and self.active_marker_depths[-1] == self.section_depth:
                self.active_marker_depths.pop()
            self.section_depth = max(0, self.section_depth - 1)
        if tag in _SKIP_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)

    def handle_data(self, data: str) -> None:
        if self.skip_depth:
            return
        if self.heading_tag:
            self.heading_parts.append(data)
        if self.description_div_depth:
            self._append_description(data)


def parse_public_detail(html: str, page_url: str, listed_url: str, expected_title: str) -> TalentBrewDetail:
    """Accept one ATS description for the exact HTTPS host, ID, and card title.

    The listing title must come from the visible job card, not the detail page.
    The caller remains responsible for robots permission and all network I/O.
    """
    def incomplete(reason: str) -> TalentBrewDetail:
        return TalentBrewDetail(None, None, None, None, False, reason)

    listed = _job_url_parts(listed_url)
    returned = _job_url_parts(page_url)
    if listed is None:
        return incomplete("listed TalentBrew URL is not a public HTTPS job detail")
    if returned is None or returned[:3] != listed[:3]:
        return incomplete("TalentBrew detail left its listed host or job ID")
    if not isinstance(expected_title, str) or not _normalized_title(expected_title):
        return incomplete("TalentBrew listing card omitted its job title")
    if not isinstance(html, str) or len(html) > _MAX_HTML_CHARS:
        return incomplete("TalentBrew detail HTML is missing or exceeds the size limit")

    parser = _DetailParser()
    try:
        parser.feed(html)
        parser.close()
    except (ValueError, OverflowError) as exc:
        return incomplete(f"TalentBrew detail HTML could not be parsed: {type(exc).__name__}")
    if not parser.markers or any(job_id != listed[2] or org_id != listed[1] for job_id, org_id in parser.markers):
        return incomplete("TalentBrew detail data-job-id or data-org-id did not match its listing")
    if _normalized_title(expected_title) not in {_normalized_title(heading) for heading in parser.headings}:
        return incomplete("TalentBrew detail heading did not match its listing title")
    if parser.container_count != 1 or not parser.description_closed or parser.description_div_depth:
        return incomplete("TalentBrew detail lacked exactly one complete ATS description container")
    if parser.description_too_long:
        return incomplete("TalentBrew detail ATS description exceeds the size limit")
    description = " ".join("".join(parser.description_parts).split())
    if len(description) <= 200:
        return incomplete("TalentBrew detail ATS description was too short")
    return TalentBrewDetail(" ".join(expected_title.split()), returned[3], description, listed[2], True, None)
