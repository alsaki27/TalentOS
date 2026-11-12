"""Validate public SmartRecruiters job details against HTML-board cards.

This module performs no I/O. The caller must fetch only robots-allowed public
job pages and pass their extracted JobPosting records here.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit


_TRACKING_ID = re.compile(r"[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\Z")


@dataclass(frozen=True)
class SmartRecruitersDetailResult:
    job: dict[str, Any]
    complete: bool
    reason: str | None


def public_job_path(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname != "jobs.smartrecruiters.com"
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.query or parsed.fragment):
            return None
    except ValueError:
        return None
    segments = [unquote(part).casefold() for part in parsed.path.split("/") if part]
    if len(segments) != 2 or any(part in {"apply", "application", "applications", "apps", "new"} for part in segments):
        return None
    return parsed.path.rstrip("/")


def public_job_url_from_card(url: str) -> str | None:
    """Remove only the board's UUID tracking tag from a public job card URL.

    The returned URL is a query-free job detail. Unknown query parameters and
    application routes remain invalid; the caller must still check robots.
    """
    try:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.hostname != "jobs.smartrecruiters.com"
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.fragment):
            return None
    except ValueError:
        return None
    if parsed.query:
        params = parse_qsl(parsed.query, keep_blank_values=True)
        if (len(params) != 1 or params[0][0].casefold() != "trid"
                or not _TRACKING_ID.fullmatch(params[0][1])):
            return None
    clean = urlunsplit(("https", "jobs.smartrecruiters.com", parsed.path.rstrip("/"), "", ""))
    return clean if public_job_path(clean) else None


def _title(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def merge_public_job_detail(
    listing_job: dict[str, Any],
    response_status: int,
    response_url: str,
    extracted_postings: list[dict[str, Any]],
    *,
    request_error: str | None = None,
) -> SmartRecruitersDetailResult:
    """Keep a card on failure; mark complete only for one matching full detail."""
    job = dict(listing_job)
    raw = dict(job.get("raw") or {})
    job["raw"] = raw

    def incomplete(reason: str) -> SmartRecruitersDetailResult:
        raw["smartrecruiters_detail_complete"] = False
        raw["smartrecruiters_detail_error"] = reason
        return SmartRecruitersDetailResult(job, False, reason)

    listed_path = public_job_path(str(job.get("source_url") or ""))
    if not listed_path:
        return incomplete("listing card did not contain a public SmartRecruiters job URL")
    if request_error:
        return incomplete(f"public job detail request failed: {request_error[:160]}")
    if response_status != 200:
        return incomplete(f"public job detail returned HTTP {response_status}")
    if public_job_path(response_url) != listed_path:
        return incomplete("public job detail redirected away from its listed path")
    matches = [posting for posting in extracted_postings
               if public_job_path(str(posting.get("source_url") or "")) == listed_path]
    if len(matches) != 1:
        return incomplete("public job detail lacked exactly one matching JobPosting")
    posting = matches[0]
    if _title(posting.get("title")) != _title(job.get("title")):
        return incomplete("public job detail title did not match its listing card")
    description = str(posting.get("description_text") or "").strip()
    if len(description) <= 200:
        return incomplete("public job detail description was too short for safe handoff")
    job["description_text"] = description
    job["snippet"] = description[:300]
    if posting.get("location"):
        job["location"] = posting["location"]
    raw["smartrecruiters_detail_complete"] = True
    raw.pop("smartrecruiters_detail_error", None)
    return SmartRecruitersDetailResult(job, True, None)
