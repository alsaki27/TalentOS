"""Offline parser for an explicitly configured Taleo Business Edition RSS feed.

The caller supplies the exact customer RSS URL, source URL, employer label, and
the exact hosts allowed for posting links. This module does not build or fetch
feed URLs and does not make robots, permission, or network decisions.
"""
from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
import json
import os
import re
import urllib.parse
import xml.etree.ElementTree as ET


MAX_RSS_BYTES = 8_000_000
MIN_INTEGRATION_DESCRIPTION_CHARS = 201
_BLOCK_TAGS = {"address", "article", "blockquote", "br", "dd", "div", "dl", "dt", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "pre", "section", "td", "th", "tr", "ul"}
_HOST_RE = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*\Z", re.I)


@dataclass(frozen=True, repr=False)
class TaleoBusinessEditionRSSConfig:
    """Explicit, caller-supplied mapping for one TBE career source."""

    source_url: str
    feed_url: str
    employer: str
    allowed_job_hosts: tuple[str, ...]
    feed_coverage_confirmed: bool | None = None

    def __repr__(self) -> str:
        return "TaleoBusinessEditionRSSConfig(<redacted>)"

    def __post_init__(self) -> None:
        _validate_https_url(self.source_url, "source_url")
        _validate_https_url(self.feed_url, "feed_url")
        if not self.employer.strip():
            raise ValueError("employer must not be empty")
        if not self.allowed_job_hosts:
            raise ValueError("allowed_job_hosts must contain at least one exact host")
        for host in self.allowed_job_hosts:
            if not isinstance(host, str) or host != host.strip():
                raise ValueError("allowed_job_hosts must contain exact hostnames only")
            normalized = host.strip().lower().rstrip(".")
            if not _HOST_RE.fullmatch(normalized):
                raise ValueError("allowed_job_hosts must contain exact hostnames only")


@dataclass(frozen=True)
class ParseResult:
    """Outcome; completeness requires caller-confirmed feed coverage and valid items."""

    jobs: list[dict[str, object]]
    # True only when the caller confirmed full feed coverage and every listed
    # item passed parser checks. The parser cannot establish board coverage.
    complete: bool
    notes: list[str]
    item_count: int


class TaleoBusinessEditionConfigError(ValueError):
    """Safe config error whose message never contains input config values."""


def _normalize_source_url(url: str) -> str:
    """Match employer_career_ingest.normalize_source_url without importing it."""
    parsed = urllib.parse.urlparse(url.strip())
    path = parsed.path.rstrip("/") or "/"
    return urllib.parse.urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), path, parsed.params, parsed.query, ""))


def _unique_nonempty_keys(values: object) -> tuple[str, ...] | None:
    if not isinstance(values, (list, tuple, set, frozenset)):
        return None
    keys = list(values)
    if not keys or any(not isinstance(key, str) or not key or key != key.strip() for key in keys):
        return None
    if len(set(keys)) != len(keys):
        return None
    return tuple(keys)


def load_taleo_business_edition_source_config(
    source_url: str,
    employer_keys: object,
    raw_json: str | None = None,
) -> TaleoBusinessEditionRSSConfig:
    """Load one exact, authorized TBE mapping without exposing config values.

    ``raw_json`` is injectable for offline tests; when omitted, the function
    reads ``TALENTOS_TALEO_TBE_CONFIG_JSON``. The JSON object is keyed by the
    crawler's normalized source URL. Employer keys must match the caller's
    source grouping exactly. Authorization/use confirmation must be literal
    JSON booleans. Feed coverage is optional and flows through as unconfirmed.
    """
    try:
        _validate_https_url(source_url, "source_url")
    except (AttributeError, ValueError) as exc:
        raise TaleoBusinessEditionConfigError("invalid TBE source URL") from exc
    requested_keys = _unique_nonempty_keys(employer_keys)
    if requested_keys is None:
        raise TaleoBusinessEditionConfigError("employer key set is missing or invalid")

    config_text = os.environ.get("TALENTOS_TALEO_TBE_CONFIG_JSON", "") if raw_json is None else raw_json
    if not isinstance(config_text, str) or not config_text:
        raise TaleoBusinessEditionConfigError("TBE source configuration is missing")

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
        raise TaleoBusinessEditionConfigError("TBE source configuration JSON is invalid") from exc
    if not isinstance(raw_config, dict):
        raise TaleoBusinessEditionConfigError("TBE source configuration must be an object")

    normalized_source = _normalize_source_url(source_url)
    entry = raw_config.get(normalized_source)
    if not isinstance(entry, dict):
        raise TaleoBusinessEditionConfigError("exact normalized TBE source mapping is missing")
    configured_keys = _unique_nonempty_keys(entry.get("employer_keys"))
    if configured_keys is None or set(configured_keys) != set(requested_keys):
        raise TaleoBusinessEditionConfigError("configured employer key set does not exactly match source")
    if entry.get("authorization_confirmed") is not True:
        raise TaleoBusinessEditionConfigError("source authorization is not explicitly confirmed")
    if entry.get("third_party_aggregator_use_confirmed") is not True:
        raise TaleoBusinessEditionConfigError("third-party aggregator use is not explicitly confirmed")
    authorization_reference = entry.get("authorization_reference")
    if not isinstance(authorization_reference, str) or not authorization_reference.strip():
        raise TaleoBusinessEditionConfigError("authorization reference is missing")

    feed_url = entry.get("feed_url")
    allowed_job_hosts = entry.get("allowed_job_hosts")
    if not isinstance(feed_url, str) or not feed_url.strip():
        raise TaleoBusinessEditionConfigError("exact customer feed URL is missing")
    if not isinstance(allowed_job_hosts, list) or not allowed_job_hosts or any(not isinstance(host, str) for host in allowed_job_hosts):
        raise TaleoBusinessEditionConfigError("exact posting host allowlist is missing or invalid")
    employer = entry.get("employer")
    if not isinstance(employer, str) or not employer.strip():
        raise TaleoBusinessEditionConfigError("employer label is missing")
    coverage = entry.get("feed_coverage_confirmed")
    if not isinstance(coverage, bool):
        coverage = None
    try:
        return TaleoBusinessEditionRSSConfig(
            source_url=normalized_source,
            feed_url=feed_url,
            employer=employer,
            allowed_job_hosts=tuple(allowed_job_hosts),
            feed_coverage_confirmed=coverage,
        )
    except (AttributeError, ValueError) as exc:
        raise TaleoBusinessEditionConfigError("TBE feed or posting host config is invalid") from exc


class _PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append("\n")
        if tag.lower() == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


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
    if parsed.scheme.lower() != "https" or not parsed.hostname or parsed.username or parsed.password or port not in (None, 443):
        raise ValueError(f"{field} must be an HTTPS URL without embedded credentials")
    return parsed


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].split(":")[-1]


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
    if not lines:
        return None
    # Preserve paragraph/list boundaries without carrying markup into TalentOS.
    result = "\n".join(lines).strip()
    return result or None


def _valid_posting_url(value: str | None, allowed_hosts: set[str]) -> str | None:
    if not value:
        return None
    parsed = urllib.parse.urlparse(value.strip())
    host = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.lower() != "https"
        or not host
        or parsed.username
        or parsed.password
        or port not in (None, 443)
        or host not in allowed_hosts
    ):
        return None
    return urllib.parse.urlunparse(parsed._replace(fragment=""))


def _child_map(item: ET.Element) -> dict[str, str]:
    values: dict[str, str] = {}
    for child in list(item):
        name = _local_name(child.tag).casefold()
        if name in values:
            continue
        value = "".join(part for part in child.itertext() if part).strip()
        if value:
            values[name] = value
    return values


def parse_taleo_business_edition_rss(
    payload: bytes | str,
    config: TaleoBusinessEditionRSSConfig,
) -> ParseResult:
    """Parse one TBE RSS document without performing any I/O.

    Oracle's documented RSS fields are used: ``title``, ``link``, ``guid``,
    ``description``, ``pubDate``, ``taleo:reqId``, and the Taleo location fields.
    Invalid entries are skipped and make the parse result incomplete. A
    ``complete`` is true only if the caller sets ``feed_coverage_confirmed`` to
    exactly ``True`` and every listed item passes parser checks. The caller is
    responsible for establishing feed coverage; the parser cannot do that.
    """
    coverage_notes = [] if config.feed_coverage_confirmed is True else [
        "full feed coverage is not confirmed against the live career board"
    ]
    if isinstance(payload, str):
        encoded = payload.encode("utf-8")
    elif isinstance(payload, bytes):
        encoded = payload
    else:
        return ParseResult([], False, coverage_notes + ["RSS payload must be bytes or text"], 0)
    if not encoded or len(encoded) > MAX_RSS_BYTES:
        return ParseResult([], False, coverage_notes + ["RSS payload is empty or exceeds the size limit"], 0)
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", encoded, flags=re.IGNORECASE):
        return ParseResult([], False, coverage_notes + ["RSS document contains a prohibited DTD or entity declaration"], 0)
    try:
        root = ET.fromstring(encoded)
    except (ET.ParseError, ValueError) as exc:
        return ParseResult([], False, coverage_notes + [f"RSS XML is malformed: {str(exc)[:120]}"], 0)
    if _local_name(root.tag).casefold() != "rss":
        return ParseResult([], False, coverage_notes + ["document root is not RSS"], 0)
    channel = next((child for child in list(root) if _local_name(child.tag).casefold() == "channel"), None)
    if channel is None:
        return ParseResult([], False, coverage_notes + ["RSS channel is missing"], 0)

    allowed_hosts = {host.strip().lower().rstrip(".") for host in config.allowed_job_hosts}
    items = [child for child in list(channel) if _local_name(child.tag).casefold() == "item"]
    jobs: list[dict[str, object]] = []
    notes: list[str] = list(coverage_notes)
    seen_ids: set[str] = set()
    seen_urls: set[str] = set()
    complete = config.feed_coverage_confirmed is True

    for index, item in enumerate(items, start=1):
        fields = _child_map(item)
        title = fields.get("title", "").strip()
        external_id = fields.get("reqid", "").strip()
        posting_url = (
            _valid_posting_url(fields.get("link"), allowed_hosts)
            or _valid_posting_url(fields.get("guid"), allowed_hosts)
        )
        description = _plain_description(fields.get("html-description") or fields.get("description"))
        problems: list[str] = []
        if not title:
            problems.append("missing title")
        if not description:
            problems.append("missing description")
        elif len(description) < MIN_INTEGRATION_DESCRIPTION_CHARS:
            problems.append(f"description shorter than {MIN_INTEGRATION_DESCRIPTION_CHARS} characters")
        if not external_id:
            problems.append("missing Taleo requisition ID")
        if not posting_url:
            problems.append("missing or invalid HTTPS posting URL")
        if external_id and external_id in seen_ids:
            problems.append("duplicate Taleo requisition ID")
        if posting_url and posting_url in seen_urls:
            problems.append("duplicate posting URL")
        if problems:
            complete = False
            notes.append(f"RSS item {index}: " + "; ".join(problems))
            continue

        assert posting_url is not None
        assert description is not None
        seen_ids.add(external_id)
        seen_urls.add(posting_url)
        location = fields.get("location")
        if not location:
            location = ", ".join(
                part for part in (
                    fields.get("locationcity"),
                    fields.get("locationstate"),
                    fields.get("locationcountry"),
                ) if part
            ) or None
        jobs.append({
            "title": title,
            "company": config.employer.strip(),
            "location": location,
            "source_url": posting_url,
            "external_job_id": external_id,
            "description_text": description,
            "snippet": description[:300],
            "raw": {
                "source": "talentos_employer_career",
                "ats": "taleo_business_edition_rss",
                "posted_at": fields.get("pubdate"),
                "department": fields.get("department"),
                "location_city": fields.get("locationcity"),
                "location_state": fields.get("locationstate"),
                "location_country": fields.get("locationcountry"),
            },
        })

    return ParseResult(jobs, complete, notes, len(items))
