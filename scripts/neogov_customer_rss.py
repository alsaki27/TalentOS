"""Offline parser and strict config loader for customer-provided NEOGOV RSS feeds.

The module never discovers, constructs, or fetches a feed URL and never fetches
posting links. Feed access belongs to a separately reviewed scheduler path.
Completeness depends on explicit operator confirmation based on a sanitized
customer sample; this parser cannot prove that a feed covers the whole board.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
import json
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET


MAX_FEED_BYTES = 8_000_000
MIN_INTEGRATION_DESCRIPTION_CHARS = 201
_BLOCK_TAGS = {
    "address", "article", "blockquote", "br", "dd", "div", "dl", "dt",
    "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "pre",
    "section", "td", "th", "tr", "ul",
}
_HOST_RE = re.compile(
    r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)"
    r"(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\Z",
    re.I,
)
_NEOGOV_SOURCE_DOMAINS = ("governmentjobs.com", "schooljobs.com")


@dataclass(frozen=True, repr=False)
class NeogovCustomerRSSConfig:
    """One exact employer source/feed mapping.

    Permission references and sample evidence are checked by the config loader
    but deliberately are not retained in this object or its repr.
    """

    source_url: str
    feed_url: str
    employer: str
    employer_keys: tuple[str, ...]
    allowed_feed_hosts: tuple[str, ...]
    allowed_job_hosts: tuple[str, ...]
    feed_coverage_confirmed: bool | None = None

    def __repr__(self) -> str:
        return "NeogovCustomerRSSConfig(<redacted>)"

    def __post_init__(self) -> None:
        source = _validate_https_url(self.source_url, "source_url")
        if not _is_neogov_source_host(source.hostname or ""):
            raise ValueError("source_url must be an exact GovernmentJobs or SchoolJobs source")
        feed = _validate_https_url(self.feed_url, "feed_url")
        feed_hosts = _normalize_host_allowlist(self.allowed_feed_hosts, "allowed_feed_hosts")
        job_hosts = _normalize_host_allowlist(self.allowed_job_hosts, "allowed_job_hosts")
        if (feed.hostname or "").lower().rstrip(".") not in feed_hosts:
            raise ValueError("feed_url host is not in allowed_feed_hosts")
        if not isinstance(self.employer, str) or not self.employer.strip():
            raise ValueError("employer must not be empty")
        if _unique_nonempty_keys(self.employer_keys) is None:
            raise ValueError("employer_keys must contain unique exact keys")
        if self.feed_coverage_confirmed is not None and type(self.feed_coverage_confirmed) is not bool:
            raise ValueError("feed_coverage_confirmed must be a boolean or None")
        del job_hosts  # Validation is intentionally performed even for parser-only use.


@dataclass(frozen=True)
class ParseResult:
    """Parsed jobs; complete is false unless all items validate and coverage is confirmed."""

    jobs: list[dict[str, object]]
    complete: bool
    notes: list[str]
    item_count: int


class NeogovRSSConfigError(ValueError):
    """Safe config error whose message does not include private config values."""


def _normalize_source_url(url: str) -> str:
    """Match employer_career_ingest.normalize_source_url without importing it."""
    parsed = urllib.parse.urlparse(url.strip())
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunparse((
        parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.params,
        parsed.query, "",
    ))


def _unique_nonempty_keys(values: object) -> tuple[str, ...] | None:
    if not isinstance(values, (list, tuple, set, frozenset)):
        return None
    keys = list(values)
    if not keys or any(not isinstance(key, str) or not key or key != key.strip() for key in keys):
        return None
    if len(set(keys)) != len(keys):
        return None
    return tuple(keys)


def _is_neogov_source_host(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    return any(
        normalized == domain or normalized.endswith("." + domain)
        for domain in _NEOGOV_SOURCE_DOMAINS
    )


def _validate_https_url(value: str, field: str) -> urllib.parse.ParseResult:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be supplied explicitly")
    if any(character.isspace() or ord(character) < 32 for character in value):
        raise ValueError(f"{field} must be a valid HTTPS URL")
    parsed = urllib.parse.urlparse(value.strip())
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{field} must be a valid HTTPS URL") from exc
    if (
        parsed.scheme.lower() != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or port not in (None, 443)
    ):
        raise ValueError(f"{field} must be an HTTPS URL without embedded credentials")
    return parsed


def _normalize_host_allowlist(values: object, field: str) -> set[str]:
    if not isinstance(values, (list, tuple)) or not values:
        raise ValueError(f"{field} must contain exact hostnames")
    normalized: list[str] = []
    for host in values:
        if not isinstance(host, str) or host != host.strip():
            raise ValueError(f"{field} must contain exact hostnames")
        candidate = host.lower().rstrip(".")
        if not _HOST_RE.fullmatch(candidate):
            raise ValueError(f"{field} must contain exact hostnames")
        normalized.append(candidate)
    if len(set(normalized)) != len(normalized):
        raise ValueError(f"{field} must not contain duplicate hostnames")
    return set(normalized)


def load_neogov_customer_rss_source_config(
    source_url: str,
    employer_keys: object,
    raw_json: str | None = None,
) -> NeogovCustomerRSSConfig:
    """Load one exact authorized customer feed mapping.

    ``raw_json`` is injectable for offline tests. Otherwise the loader reads
    ``TALENTOS_NEOGOV_RSS_CONFIG_JSON``. The object must be keyed by the exact
    normalized source URL. Written permission and TalentOS reuse references,
    plus all three sanitized-sample confirmations, are required before the
    mapping can be used by a caller.
    """
    try:
        source = _validate_https_url(source_url, "source_url")
        if not _is_neogov_source_host(source.hostname or ""):
            raise ValueError("unsupported source domain")
    except (AttributeError, ValueError) as exc:
        raise NeogovRSSConfigError("source must be an HTTPS GovernmentJobs or SchoolJobs URL") from exc
    requested_keys = _unique_nonempty_keys(employer_keys)
    if requested_keys is None:
        raise NeogovRSSConfigError("employer key set is missing or invalid")

    config_text = os.environ.get("TALENTOS_NEOGOV_RSS_CONFIG_JSON", "") if raw_json is None else raw_json
    if not isinstance(config_text, str) or not config_text:
        raise NeogovRSSConfigError("NEOGOV RSS source configuration is missing")

    def reject_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
        parsed: dict[str, object] = {}
        for key, value in pairs:
            if key in parsed:
                raise ValueError("duplicate JSON key")
            parsed[key] = value
        return parsed

    try:
        raw_config = json.loads(config_text, object_pairs_hook=reject_duplicate_json_keys)
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise NeogovRSSConfigError("NEOGOV RSS source configuration JSON is invalid") from exc
    if not isinstance(raw_config, dict):
        raise NeogovRSSConfigError("NEOGOV RSS source configuration must be an object")

    normalized_source = _normalize_source_url(source_url)
    entry = raw_config.get(normalized_source)
    if not isinstance(entry, dict):
        raise NeogovRSSConfigError("exact normalized GovernmentJobs/SchoolJobs source mapping is missing")
    configured_keys = _unique_nonempty_keys(entry.get("employer_keys"))
    if configured_keys is None or set(configured_keys) != set(requested_keys):
        raise NeogovRSSConfigError("configured employer key set does not exactly match source")
    if entry.get("authorization_confirmed") is not True:
        raise NeogovRSSConfigError("written source permission is not explicitly confirmed")
    if entry.get("talentos_reuse_confirmed") is not True:
        raise NeogovRSSConfigError("TalentOS reuse grant is not explicitly confirmed")
    for field in ("written_permission_reference", "talentos_reuse_grant_reference"):
        reference = entry.get(field)
        if not isinstance(reference, str) or not reference.strip():
            raise NeogovRSSConfigError(f"{field} is missing")

    sample = entry.get("sanitized_sample_confirmation")
    if not isinstance(sample, dict):
        raise NeogovRSSConfigError("sanitized sample confirmation is missing")
    sample_reference = sample.get("reference")
    if not isinstance(sample_reference, str) or not sample_reference.strip():
        raise NeogovRSSConfigError("sanitized sample reference is missing")
    for field in ("schema_confirmed", "full_description_confirmed", "full_feed_coverage_confirmed"):
        if sample.get(field) is not True:
            raise NeogovRSSConfigError(f"sanitized sample confirmation {field} is required")

    feed_url = entry.get("feed_url")
    if not isinstance(feed_url, str) or not feed_url.strip():
        raise NeogovRSSConfigError("exact customer feed URL is missing")
    allowed_feed_hosts = entry.get("allowed_feed_hosts")
    allowed_job_hosts = entry.get("allowed_job_hosts")
    employer = entry.get("employer")
    if not isinstance(employer, str) or not employer.strip():
        raise NeogovRSSConfigError("employer label is missing")
    if not isinstance(allowed_feed_hosts, list) or not isinstance(allowed_job_hosts, list):
        raise NeogovRSSConfigError("feed and posting host allowlists are required")

    try:
        return NeogovCustomerRSSConfig(
            source_url=normalized_source,
            feed_url=feed_url,
            employer=employer,
            employer_keys=configured_keys,
            allowed_feed_hosts=tuple(allowed_feed_hosts),
            allowed_job_hosts=tuple(allowed_job_hosts),
            feed_coverage_confirmed=True,
        )
    except (AttributeError, ValueError) as exc:
        raise NeogovRSSConfigError("NEOGOV feed or host config is invalid") from exc


class _PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        tag = tag.lower()
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1].casefold()


def _child_elements(item: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in list(item) if _local_name(child.tag) == name]


def _element_text(element: ET.Element) -> str:
    return "".join(element.itertext()).strip()


def _plain_description(value: str | None) -> str | None:
    if not value:
        return None
    parser = _PlainText()
    try:
        parser.feed(value)
        parser.close()
    except Exception:
        return None
    lines: list[str] = []
    for raw_line in "".join(parser.parts).replace("\r", "\n").split("\n"):
        cleaned = re.sub(r"\s+", " ", raw_line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines).strip() or None


def _valid_posting_url(value: str | None, allowed_hosts: set[str]) -> str | None:
    if not value:
        return None
    candidate = value.strip()
    if any(character.isspace() or ord(character) < 32 for character in candidate):
        return None
    try:
        parsed = urllib.parse.urlparse(candidate)
        port = parsed.port
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if (
        parsed.scheme.lower() != "https"
        or not host
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or host not in allowed_hosts
    ):
        return None
    return urllib.parse.urlunparse(parsed._replace(scheme="https", netloc=host, fragment=""))


def _single_child_text(item: ET.Element, field: str, *, html: bool = False) -> tuple[str | None, bool]:
    values = _child_elements(item, field)
    if len(values) != 1:
        return None, len(values) > 1
    value = _element_text(values[0])
    if html:
        return _plain_description(value), False
    return value or None, False


def _rss_item(item: ET.Element) -> dict[str, object]:
    title, title_ambiguous = _single_child_text(item, "title")
    link, link_ambiguous = _single_child_text(item, "link")
    guid_elements = _child_elements(item, "guid")
    guid = _element_text(guid_elements[0]) if len(guid_elements) == 1 else None
    description, description_ambiguous = _single_child_text(item, "description", html=True)
    date, _ = _single_child_text(item, "pubdate")
    guid_permalink_value = "true"
    if len(guid_elements) == 1:
        guid_permalink_value = next(
            (value for key, value in guid_elements[0].attrib.items() if key.casefold() == "ispermalink"),
            "true",
        )
    guid_is_url = guid_permalink_value.strip().casefold() != "false"
    return {
        "title": title,
        "id": guid,
        "url": link or (guid if guid_is_url else None),
        "description": description,
        "published_at": date,
        "ambiguous": title_ambiguous or link_ambiguous or len(guid_elements) > 1 or description_ambiguous,
    }


def _atom_entry(item: ET.Element) -> dict[str, object]:
    title, title_ambiguous = _single_child_text(item, "title")
    atom_ids = _child_elements(item, "id")
    stable_id = _element_text(atom_ids[0]) if len(atom_ids) == 1 else None
    links: list[str] = []
    malformed_alternate_link = False
    for child in _child_elements(item, "link"):
        rel = child.attrib.get("rel", "alternate").strip().casefold().rstrip("/")
        rel_name = rel.rsplit("/", 1)[-1]
        href = child.attrib.get("href", "").strip()
        if rel_name == "alternate":
            if href:
                links.append(href)
            else:
                malformed_alternate_link = True
    content_elements = _child_elements(item, "content")
    summary_elements = _child_elements(item, "summary")
    description_ambiguous = len(content_elements) > 1 or len(summary_elements) > 1
    description: str | None = None
    if len(content_elements) == 1:
        content = content_elements[0]
        if content.attrib.get("type", "text").strip().casefold() in {"xhtml", "application/xhtml+xml"}:
            description_markup = "".join(ET.tostring(child, encoding="unicode") for child in list(content))
            if not description_markup:
                description_markup = _element_text(content)
        else:
            description_markup = _element_text(content)
        description = _plain_description(description_markup)
    elif len(content_elements) == 0 and len(summary_elements) == 1:
        summary_markup = _element_text(summary_elements[0])
        description = _plain_description(summary_markup)
    updated, _ = _single_child_text(item, "updated")
    published, _ = _single_child_text(item, "published")
    return {
        "title": title,
        "id": stable_id,
        "url": links[0] if len(links) == 1 else None,
        "description": description,
        "published_at": updated or published,
        "ambiguous": (
            title_ambiguous or len(atom_ids) > 1 or len(links) > 1
            or malformed_alternate_link or description_ambiguous
        ),
    }


def _safe_entry(entry: dict[str, object], index: int, config: NeogovCustomerRSSConfig) -> tuple[dict[str, object] | None, list[str]]:
    problems: list[str] = []
    title = entry.get("title")
    stable_id = entry.get("id")
    description = entry.get("description")
    if entry.get("ambiguous"):
        problems.append("ambiguous duplicate title, ID, link, or description field")
    if not isinstance(title, str) or not title.strip():
        problems.append("missing title")
    if (
        not isinstance(stable_id, str)
        or not stable_id.strip()
        or len(stable_id.strip()) > 512
        or any(character.isspace() or ord(character) < 32 for character in stable_id.strip())
    ):
        problems.append("missing or invalid stable posting ID")
    posting_url = _valid_posting_url(
        entry.get("url") if isinstance(entry.get("url"), str) else None,
        {host.lower().rstrip(".") for host in config.allowed_job_hosts},
    )
    if posting_url is None:
        problems.append("missing or invalid HTTPS posting URL")
    if not isinstance(description, str) or not description.strip():
        problems.append("missing description")
    elif len(description.strip()) < MIN_INTEGRATION_DESCRIPTION_CHARS:
        problems.append(f"description shorter than {MIN_INTEGRATION_DESCRIPTION_CHARS} characters")
    if problems:
        return None, [f"Feed entry {index}: " + "; ".join(problems)]
    assert isinstance(title, str)
    assert isinstance(stable_id, str)
    assert isinstance(posting_url, str)
    assert isinstance(description, str)
    return {
        "title": re.sub(r"\s+", " ", title).strip(),
        "company": config.employer.strip(),
        "location": None,
        "source_url": posting_url,
        "external_job_id": stable_id.strip(),
        "description_text": description,
        "snippet": description[:300],
        "raw": {
            "source": "talentos_employer_career",
            "ats": "neogov_customer_rss",
            "published_at": entry.get("published_at"),
        },
    }, []


def parse_neogov_customer_rss(
    payload: bytes | str,
    config: NeogovCustomerRSSConfig,
) -> ParseResult:
    """Parse a standard RSS 2.0 or Atom feed without performing any I/O.

    Only standard RSS ``item`` fields (title/link/guid/description/pubDate) and
    Atom ``entry`` fields (id/title/link/updated/published/content/summary) are
    interpreted. The caller must verify any vendor-specific semantics using a
    sanitized customer sample. Every posting URL is only parsed and allowlist
    checked; this function never requests it.
    """
    coverage = config.feed_coverage_confirmed is True
    initial_notes = [] if coverage else [
        "full feed coverage is not confirmed by an authorized sanitized sample"
    ]
    if isinstance(payload, str):
        encoded = payload.encode("utf-8")
    elif isinstance(payload, bytes):
        encoded = payload
    else:
        return ParseResult([], False, initial_notes + ["feed payload must be bytes or text"], 0)
    if not encoded or len(encoded) > MAX_FEED_BYTES:
        return ParseResult([], False, initial_notes + ["feed is empty or exceeds the size limit"], 0)
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", encoded, flags=re.IGNORECASE):
        return ParseResult([], False, initial_notes + ["feed contains a prohibited DTD or entity declaration"], 0)
    try:
        root = ET.fromstring(encoded)
    except (ET.ParseError, ValueError) as exc:
        del exc
        return ParseResult([], False, initial_notes + ["feed XML is malformed"], 0)

    root_name = _local_name(root.tag)
    if root_name == "rss":
        channel = next((child for child in list(root) if _local_name(child.tag) == "channel"), None)
        if channel is None:
            return ParseResult([], False, initial_notes + ["RSS channel is missing"], 0)
        raw_entries = [_rss_item(item) for item in _child_elements(channel, "item")]
        feed_kind = "rss"
    elif root_name == "feed":
        raw_entries = [_atom_entry(item) for item in _child_elements(root, "entry")]
        feed_kind = "atom"
    else:
        return ParseResult([], False, initial_notes + ["document root is neither RSS nor Atom"], 0)

    notes = list(initial_notes)
    jobs_by_index: dict[int, dict[str, object]] = {}
    allowed_job_hosts = {host.lower().rstrip(".") for host in config.allowed_job_hosts}
    ids: Counter[str] = Counter(
        str(entry.get("id")).strip()
        for entry in raw_entries
        if isinstance(entry.get("id"), str) and entry.get("id").strip()
    )
    urls: Counter[str] = Counter(
        url
        for entry in raw_entries
        if isinstance(entry.get("url"), str)
        for url in [_valid_posting_url(entry.get("url"), allowed_job_hosts)]
        if url is not None
    )
    for index, entry in enumerate(raw_entries, start=1):
        job, problems = _safe_entry(entry, index, config)
        if problems:
            notes.extend(problems)
            continue
        assert job is not None
        jobs_by_index[index] = job

    duplicate_indices: set[int] = set()
    for index, job in list(jobs_by_index.items()):
        duplicate_id = ids[str(job["external_job_id"])] > 1
        duplicate_url = urls[str(job["source_url"])] > 1
        if duplicate_id or duplicate_url:
            duplicate_indices.add(index)
            duplicate_reasons = []
            if duplicate_id:
                duplicate_reasons.append("duplicate stable posting ID")
            if duplicate_url:
                duplicate_reasons.append("duplicate posting URL")
            notes.append(f"Feed entry {index}: " + "; ".join(duplicate_reasons))
    jobs = [
        {**job, "raw": {**job["raw"], "feed_format": feed_kind}}
        for index, job in jobs_by_index.items()
        if index not in duplicate_indices
    ]
    complete = coverage and len(jobs) == len(raw_entries) and not notes
    return ParseResult(jobs, complete, notes, len(raw_entries))
