"""Validate public Workday CXS job details and their canonical job URLs.

This module makes no requests. Callers must use the crawler's HTTPS, robots,
and per-host rate checks before fetching the returned CXS URL.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import parse_qsl, quote, unquote, urlsplit, urlunsplit


@dataclass(frozen=True)
class WorkdayDetail:
    title: str | None
    source_url: str | None
    description_text: str | None
    location: str | None
    external_job_id: str | None
    posted_at: str | None
    employment_type: str | None
    complete: bool
    reason: str | None


def _board_parts(board_url: str) -> tuple[str, tuple[str, ...]]:
    parsed = urlsplit(board_url)
    host = parsed.hostname or ""
    if (
        parsed.scheme.lower() != "https"
        or not host.endswith(".myworkdayjobs.com")
        or parsed.username
        or parsed.password
        or parsed.port not in (None, 443)
    ):
        raise ValueError("Workday board must use its public HTTPS host")
    return host, tuple(segment for segment in parsed.path.split("/") if segment)


def _job_path(external_path: str) -> tuple[str, str]:
    if not isinstance(external_path, str):
        raise ValueError("Workday externalPath is missing")
    parsed = urlsplit(external_path.strip())
    if parsed.scheme or parsed.netloc or parsed.fragment:
        raise ValueError("Workday externalPath must be a relative job path")
    path = parsed.path if parsed.path.startswith("/") else "/" + parsed.path
    segments = tuple(unquote(segment) for segment in path.split("/") if segment)
    if len(segments) < 3 or segments[0].lower() != "job" or any(segment in (".", "..") or "/" in segment or "\\" in segment for segment in segments):
        raise ValueError("Workday externalPath is not a job detail path")
    if any(segment.lower() in ("apply", "application", "applications", "apps") for segment in segments):
        raise ValueError("Workday externalPath points toward an application")
    if any(key.lower() in ("apply", "application", "apps") for key, _ in parse_qsl(parsed.query)):
        raise ValueError("Workday externalPath points toward an application")
    return path, parsed.query


def public_detail_url(board_url: str, tenant: str, site: str, external_path: str) -> str:
    """Build the same-host CXS detail URL from a listing ``externalPath``."""
    host, _ = _board_parts(board_url)
    if not tenant or not site or any("/" in value or "\\" in value or value in (".", "..") for value in (tenant, site)):
        raise ValueError("Workday tenant and site must be simple path segments")
    path, query = _job_path(external_path)
    return urlunsplit(("https", host, f"/wday/cxs/{quote(tenant, safe='-._~')}/{quote(site, safe='-._~')}{path}", query, ""))


def fallback_source_url(board_url: str, site: str, external_path: str) -> str:
    """Keep the board's locale and site prefix if detail metadata is missing."""
    host, segments = _board_parts(board_url)
    path, query = _job_path(external_path)
    site_index = next((index for index, segment in enumerate(segments) if segment.lower() == site.lower()), None)
    prefix = segments[:site_index + 1] if site_index is not None else (site,)
    return urlunsplit(("https", host, "/" + "/".join(prefix) + path, query, ""))


def _string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def parse_public_detail(
    payload: Any,
    board_url: str,
    site: str,
    external_path: str,
    clean_description: Callable[[Any], str | None],
) -> WorkdayDetail:
    """Accept detail fields only when they describe the requested same-host job."""
    host, _ = _board_parts(board_url)
    requested_path, _ = _job_path(external_path)
    info = payload.get("jobPostingInfo") if isinstance(payload, dict) else None
    if not isinstance(info, dict):
        return WorkdayDetail(None, None, None, None, None, None, None, False, "Workday detail omitted jobPostingInfo")

    title = _string(info.get("title"))
    description = clean_description(info.get("jobDescription"))
    location = _string(info.get("location")) or _string(info.get("jobRequisitionLocation"))
    external_id = _string(info.get("jobReqId")) or _string(info.get("jobPostingId"))
    posted_at = _string(info.get("postedOn"))
    employment_type = _string(info.get("timeType"))
    source_url: str | None = None
    reason: str | None = None
    external_url = _string(info.get("externalUrl"))
    if external_url:
        parsed = urlsplit(external_url)
        path_segments = tuple(unquote(segment) for segment in parsed.path.split("/") if segment)
        board_parts = host.split(".")
        workday_site_host = f"{board_parts[1]}.myworkdaysite.com" if len(board_parts) == 4 else ""
        same_board_job = (
            parsed.hostname == host
            and any(segment.lower() == site.lower() for segment in path_segments)
            and any(segment.lower() == "job" for segment in path_segments)
        )
        # Some Workday tenants publish their canonical public URL on the
        # matching myworkdaysite.com instance instead of myworkdayjobs.com.
        workday_site_job = (
            parsed.hostname == workday_site_host
            and len(path_segments) >= 6
            and tuple(segment.lower() for segment in path_segments[:4])
                == ("recruiting", board_parts[0].lower(), site.lower(), "job")
        )
        if (
            parsed.scheme.lower() == "https"
            and (same_board_job or workday_site_job)
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
            and not any(segment.lower() in ("apply", "application", "applications", "apps") for segment in path_segments)
            and path_segments
            and path_segments[-1].lower() == unquote(requested_path.split("/")[-1]).lower()
        ):
            source_url = urlunsplit(("https", parsed.netloc, parsed.path, parsed.query, ""))
        else:
            reason = "Workday detail returned an unsafe or mismatched externalUrl"
    else:
        reason = "Workday detail omitted externalUrl"
    if not title:
        reason = reason or "Workday detail omitted title"
    if not description:
        reason = reason or "Workday detail omitted jobDescription"
    return WorkdayDetail(title, source_url, description, location, external_id, posted_at, employment_type, reason is None, reason)
