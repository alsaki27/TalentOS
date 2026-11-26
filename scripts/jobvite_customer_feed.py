"""Permission-gated adapter for Jobvite's paid customer Job Feed API.

The public Jobvite career-site pages are never scraped here. A source is eligible
only when an exact source/employer mapping carries the customer feed contract,
an explicit TalentOS reuse grant, and confirmation that the documented API
returns every matching job in one response. The API documentation does not
define pagination parameters, so this adapter deliberately makes one full-feed
request instead of guessing at page/offset parameters.

Secrets are supplied through ``TALENTOS_JOBVITE_FEED_CONFIG_JSON`` and are never
written into results or call-budget state. ``TALENTOS_JOBVITE_CALL_BUDGET_DB``
must point to shared persistent state used by all workers; a SQLite transaction
enforces the documented 500-call-per-credential-per-UTC-day limit across
processes. Each HTTP request consumes a call even when it fails.
"""
from __future__ import annotations

from datetime import datetime, timezone
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import urllib.parse
from typing import Any, Callable

import requests


API_URL = "https://api.jobvite.com/api/v2/job"
API_HOST = "api.jobvite.com"
MAX_CALLS_PER_UTC_DAY = 500
MAX_RESPONSE_BYTES = 8_000_000
MIN_DESCRIPTION_CHARS = 200


class JobviteAdapterError(RuntimeError):
    """Safe Jobvite adapter error without URL or credential details."""


def is_jobvite_host(host: str) -> bool:
    normalized = host.lower().rstrip(".")
    return normalized == "jobvite.com" or normalized.endswith(".jobvite.com")


def _nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _career_site_slug(normalized_source_url: str) -> str | None:
    try:
        parsed = urllib.parse.urlparse(normalized_source_url)
        port = parsed.port
    except ValueError:
        return None
    if (parsed.scheme.lower() != "https" or parsed.hostname != "jobs.jobvite.com"
            or port not in (None, 443) or parsed.username or parsed.password
            or parsed.params or parsed.query or parsed.fragment):
        return None
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 1 or parts[0] in (".", ".."):
        return None
    return parts[0]


def load_source_config(
    normalized_source_url: str,
    employer_keys: list[str],
    raw_config: str | None = None,
    budget_db_path: str | None = None,
) -> dict[str, Any] | None:
    """Load configuration only for an exact, explicitly authorized source."""
    serialized = os.environ.get("TALENTOS_JOBVITE_FEED_CONFIG_JSON", "") if raw_config is None else raw_config
    state_path = os.environ.get("TALENTOS_JOBVITE_CALL_BUDGET_DB", "") if budget_db_path is None else budget_db_path
    if not serialized or not state_path:
        return None
    try:
        state_file = Path(state_path).expanduser()
        mapping = json.loads(serialized)
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return None
    if not state_file.is_absolute() or not isinstance(mapping, dict):
        return None
    slug = _career_site_slug(normalized_source_url)
    if not slug:
        return None
    config = mapping.get(normalized_source_url)
    if not isinstance(config, dict):
        return None
    required_strings = (
        "api_key", "api_secret", "feed_contract_reference",
        "talentos_reuse_grant_reference", "single_response_contract_reference",
        "full_description_contract_reference",
    )
    if any(not _nonempty(config.get(field)) for field in required_strings):
        return None
    if (config.get("authorization_confirmed") is not True
            or config.get("paid_feed_contract_confirmed") is not True
            or config.get("talentos_reuse_grant_confirmed") is not True
            or config.get("all_matching_jobs_single_response_confirmed") is not True
            or config.get("full_description_field_confirmed") is not True):
        return None
    if config.get("career_site_name") != slug:
        return None
    configured_keys = config.get("employer_keys")
    if (not isinstance(configured_keys, list) or not configured_keys
            or any(not _nonempty(key) for key in configured_keys)
            or not employer_keys
            or sorted(set(configured_keys)) != sorted(set(employer_keys))):
        return None
    return {
        "api_key": config["api_key"],
        "api_secret": config["api_secret"],
        "career_site_name": slug,
        "employer_keys": sorted(set(configured_keys)),
        "budget_db_path": str(state_file),
        "feed_contract_reference": config["feed_contract_reference"].strip(),
        "talentos_reuse_grant_reference": config["talentos_reuse_grant_reference"].strip(),
        "single_response_contract_reference": config["single_response_contract_reference"].strip(),
        "full_description_contract_reference": config["full_description_contract_reference"].strip(),
    }


def _credential_fingerprint(api_key: str, api_secret: str) -> str:
    return hashlib.sha256((api_key + "\0" + api_secret).encode("utf-8")).hexdigest()


def reserve_daily_call(
    state_path: str | Path,
    api_key: str,
    api_secret: str,
    *,
    now: datetime | None = None,
    max_calls: int = MAX_CALLS_PER_UTC_DAY,
) -> bool:
    """Atomically reserve one call for this credential and UTC date."""
    path = Path(state_path)
    if not path.is_absolute():
        raise JobviteAdapterError("Jobvite call-budget database path must be absolute")
    if max_calls <= 0:
        raise JobviteAdapterError("Jobvite daily API call limit is invalid")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        call_date = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).date().isoformat()
        fingerprint = _credential_fingerprint(api_key, api_secret)
        with closing(sqlite3.connect(path, timeout=30, isolation_level=None)) as connection:
            connection.execute("PRAGMA busy_timeout = 30000")
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS jobvite_daily_calls ("
                "credential_hash TEXT NOT NULL, call_date TEXT NOT NULL, calls INTEGER NOT NULL, "
                "PRIMARY KEY (credential_hash, call_date))"
            )
            connection.execute(
                "DELETE FROM jobvite_daily_calls WHERE call_date < date(?, '-30 days')",
                (call_date,),
            )
            row = connection.execute(
                "SELECT calls FROM jobvite_daily_calls WHERE credential_hash = ? AND call_date = ?",
                (fingerprint, call_date),
            ).fetchone()
            used = int(row[0]) if row else 0
            if used >= max_calls:
                connection.execute("ROLLBACK")
                return False
            connection.execute(
                "INSERT INTO jobvite_daily_calls(credential_hash, call_date, calls) VALUES (?, ?, 1) "
                "ON CONFLICT(credential_hash, call_date) DO UPDATE SET calls = calls + 1",
                (fingerprint, call_date),
            )
            connection.execute("COMMIT")
            return True
    except (OSError, sqlite3.Error, ValueError):
        raise JobviteAdapterError("Jobvite daily API call budget could not be reserved") from None


def _read_limited_response(response: Any) -> dict[str, Any] | list[Any]:
    if response.status_code != 200:
        raise JobviteAdapterError(f"Jobvite Job Feed API returned HTTP {response.status_code}")
    try:
        chunks: list[bytes] = []
        total = 0
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_RESPONSE_BYTES:
                raise JobviteAdapterError("Jobvite Job Feed API response exceeded the size limit")
            chunks.append(chunk)
        body = b"".join(chunks)
        payload = json.loads(body.decode(response.encoding or "utf-8"))
    except JobviteAdapterError:
        raise
    except (AttributeError, UnicodeDecodeError, ValueError) as exc:
        raise JobviteAdapterError("Jobvite Job Feed API returned invalid JSON") from None
    if not isinstance(payload, (dict, list)):
        raise JobviteAdapterError("Jobvite Job Feed API returned an unsupported JSON shape")
    return payload


def _fetch_full_feed(
    config: dict[str, Any],
    record_content_request: Callable[[], None] | None = None,
) -> dict[str, Any] | list[Any]:
    if not reserve_daily_call(config["budget_db_path"], config["api_key"], config["api_secret"]):
        raise JobviteAdapterError("Jobvite daily API call budget exhausted (500 calls per UTC day)")
    params = {
        "api": config["api_key"],
        "sc": config["api_secret"],
        "jobStatus": "Open",
        "availableTo": "External",
    }
    response = None
    try:
        if record_content_request is not None:
            record_content_request()
        response = requests.get(
            API_URL,
            params=params,
            headers={"Accept": "application/json", "User-Agent": "TalentOS/1.0"},
            timeout=30,
            allow_redirects=False,
            stream=True,
        )
        return _read_limited_response(response)
    except JobviteAdapterError:
        raise
    except requests.RequestException:
        # Requests exceptions may include the full URL, whose query includes
        # both secrets. Never forward provider exception text into checkpoints.
        raise JobviteAdapterError("Jobvite Job Feed API request failed") from None
    finally:
        if response is not None:
            try:
                response.close()
            except Exception:
                # Close failures may contain the credential-bearing request URL.
                pass


def _valid_jobvite_url(value: Any, external_id: str) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    try:
        parsed = urllib.parse.urlparse(candidate)
        port = parsed.port
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if (parsed.scheme.lower() != "https" or port not in (None, 443)
            or parsed.username or parsed.password
            or host not in {"jobs.jobvite.com", "app.jobvite.com"}):
        return None
    job_ids = {item for item in urllib.parse.parse_qs(parsed.query).get("j", []) if item}
    segments = [urllib.parse.unquote(item) for item in parsed.path.split("/") if item]
    for index, segment in enumerate(segments[:-1]):
        if segment.lower() == "job":
            job_ids.add(segments[index + 1])
    if external_id not in job_ids:
        return None
    return candidate


def _job_rows(payload: dict[str, Any] | list[Any]) -> tuple[list[dict[str, Any]], bool, list[str]]:
    if isinstance(payload, list):
        rows = payload
    elif all(key in payload for key in ("eId", "title", "description", "jobState", "postingType", "distribution")):
        # The official sample documents a single-job JSON object. It is accepted
        # only because source configuration separately confirms the full-feed
        # contract returns every match in one response.
        rows = [payload]
    else:
        raise JobviteAdapterError("Jobvite response did not match the documented job or job-list shape")
    valid_rows: list[dict[str, Any]] = []
    complete = True
    notes: list[str] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            complete = False
            notes.append(f"Jobvite feed row {index} was not a job object")
            continue
        if row.get("jobState") != "Open" or row.get("postingType") != "External":
            complete = False
            notes.append(f"Jobvite feed row {index} did not match the requested open external filter")
            continue
        if row.get("distribution") is not True:
            # Jobvite's API guide explicitly requires this second-stage filter;
            # such rows are not candidate-facing career-site postings.
            continue
        valid_rows.append(row)
    return valid_rows, complete, notes


def _first_valid_url(values: list[Any], external_id: str) -> str | None:
    for value in values:
        url = _valid_jobvite_url(value, external_id)
        if url:
            return url
    return None


def _job_urls(row: dict[str, Any], external_id: str) -> tuple[str | None, str | None]:
    locations = row.get("jobLocations")
    locations = locations if isinstance(locations, list) else []
    details = [row.get("detailLink")]
    applies = [row.get("applyLink")]
    for location in locations:
        if isinstance(location, dict):
            details.append(location.get("jobDetailsUrl"))
            applies.append(location.get("applyUrl"))
    detail_url = _first_valid_url(details, external_id)
    apply_url = _first_valid_url(applies, external_id)
    return detail_url, apply_url


def _location(row: dict[str, Any]) -> str | None:
    direct = row.get("location")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    values: list[str] = []
    locations = row.get("jobLocations")
    for location in locations if isinstance(locations, list) else []:
        if not isinstance(location, dict):
            continue
        text = ", ".join(
            part.strip() for part in (
                location.get("name"), location.get("city"), location.get("state"), location.get("country")
            ) if isinstance(part, str) and part.strip()
        )
        if text and text not in values:
            values.append(text)
    return "; ".join(values) or None


def fetch_jobs(
    source_url: str,
    employer: str,
    config: dict[str, Any],
    *,
    clean_description: Callable[[Any], str | None],
    feed_payload: dict[str, Any] | list[Any] | None = None,
    record_content_request: Callable[[], None] | None = None,
) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Fetch and map the complete authorized external Jobvite feed."""
    payload = (
        _fetch_full_feed(config, record_content_request)
        if feed_payload is None else feed_payload
    )
    rows, complete, notes = _job_rows(payload)
    jobs: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for index, row in enumerate(rows):
        external_id_value = row.get("eId")
        external_id = str(external_id_value).strip() if isinstance(external_id_value, (str, int)) else ""
        title = row.get("title")
        description = clean_description(row.get("description"))
        detail_url, apply_url = _job_urls(row, external_id) if external_id else (None, None)
        if not external_id or not title or not isinstance(title, str) or not title.strip():
            complete = False
            notes.append(f"Jobvite distributed row {index} omitted a stable ID or title")
            continue
        if external_id in seen_ids:
            complete = False
            notes.append(f"Jobvite returned duplicate job ID {external_id}")
            continue
        seen_ids.add(external_id)
        if not apply_url or not (detail_url or apply_url):
            complete = False
            notes.append(f"Jobvite job {external_id} omitted a valid Jobvite detail/apply URL")
            continue
        if not description or len(description.strip()) <= MIN_DESCRIPTION_CHARS:
            complete = False
            notes.append(f"Jobvite job {external_id} omitted a full description over {MIN_DESCRIPTION_CHARS} characters")
        jobs.append({
            "title": title.strip(),
            "company": employer,
            "location": _location(row),
            "source_url": detail_url or apply_url,
            "external_job_id": external_id,
            "description_text": description,
            "snippet": (description or "")[:300] or None,
            "raw": {
                "source_provider": "Jobvite",
                "ats": "jobvite",
                "jobvite_id": external_id,
                "apply_url": apply_url,
                "detail_url": detail_url,
                "job_state": row.get("jobState"),
                "posting_type": row.get("postingType"),
                "distribution": row.get("distribution"),
                "last_updated_at": row.get("lastUpdatedDate"),
                "category": row.get("category"),
                "department": row.get("department"),
                "api_retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
            },
        })
    if len(jobs) != len(rows):
        complete = False
        notes.append(f"Jobvite produced {len(jobs)} validated jobs from {len(rows)} distributed open external rows")
    return jobs, complete and not notes, list(dict.fromkeys(notes))
