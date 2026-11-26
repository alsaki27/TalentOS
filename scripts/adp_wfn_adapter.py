"""Authorized ADP Workforce Now job-requisition adapter.

This adapter intentionally requires a per-source, permission-backed config.
It uses ADP's documented API only; it does not crawl the employer's career
center pages. A requisition is integration-ready only when the authorized API
response itself contains a candidate-facing job URL and a sufficiently complete
posting description.

`TALENTOS_ADP_WFN_CONFIG_JSON` is a JSON object keyed by the exact normalized
career-source URL. Each value must include `product: "workforce_now"`, a
non-empty `employer_keys` list matching the source group, `authorization_confirmed:
true`, a non-empty `authorization_reference`, and `granted_scopes` containing
the exact `READ_SCOPE` string declared below. It must also include
`job_description_field_confirmed: true`, `candidate_url_field_confirmed: true`,
`tenant_client`, `client_id`, `client_secret`, `certificate_file`,
`private_key_file`, and an exact `candidate_hosts` allowlist. The two
field-confirmation flags require an authorized sanitized tenant sample to verify
the current WFN response contract. Secrets are read at run time and never
written to results.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
import re
import urllib.parse
from typing import Any, Callable

import requests


TOKEN_URL = "https://accounts.adp.com/auth/oauth/v2/token"
REQUISITIONS_URL = "https://api.adp.com/staffing/v1/job-requisitions"
READ_SCOPE = (
    "/staffing/staffingManagement/workFulfillmentManagement/"
    "jobRequisitionsManagement/jobRequisition.read"
)
PAGE_SIZE = 20  # ADP documents a maximum of twenty records per page.
MAX_PAGES = 250


class AdpAdapterError(RuntimeError):
    """A safe, credential-free ADP adapter error."""


def is_wfn_source_url(source_url: str) -> bool:
    """Accept only the known ADP Workforce Now public recruitment route."""
    try:
        parsed = urllib.parse.urlsplit(source_url)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme.lower() == "https"
        and parsed.hostname is not None
        and parsed.hostname.lower().rstrip(".") == "workforcenow.adp.com"
        and port in (None, 443)
        and not parsed.username and not parsed.password
        and parsed.path.rstrip("/").casefold() == "/mascsr/default/mdf/recruitment/recruitment.html"
        and not parsed.fragment
    )


def _nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def load_source_config(
    normalized_source_url: str,
    employer_keys: list[str],
    raw_config: str | None = None,
) -> dict[str, Any] | None:
    """Load a config only when it exactly matches this source and employer set."""
    serialized = os.environ.get("TALENTOS_ADP_WFN_CONFIG_JSON", "") if raw_config is None else raw_config
    if not serialized:
        return None
    try:
        mapping = json.loads(serialized)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(mapping, dict):
        return None
    config = mapping.get(normalized_source_url)
    if not isinstance(config, dict) or not is_wfn_source_url(normalized_source_url):
        return None
    required_strings = (
        "authorization_reference", "tenant_client", "client_id", "client_secret",
        "certificate_file", "private_key_file",
    )
    if any(not _nonempty_string(config.get(name)) for name in required_strings):
        return None
    granted_scopes = config.get("granted_scopes")
    if (not isinstance(granted_scopes, list)
            or any(not _nonempty_string(scope) for scope in granted_scopes)
            or READ_SCOPE not in granted_scopes):
        return None
    if (config.get("product") != "workforce_now"
            or config.get("authorization_confirmed") is not True
            or config.get("job_description_field_confirmed") is not True
            or config.get("candidate_url_field_confirmed") is not True):
        return None
    configured_keys = config.get("employer_keys")
    if not isinstance(configured_keys, list) or not configured_keys:
        return None
    if any(not _nonempty_string(key) for key in configured_keys):
        return None
    if sorted(set(configured_keys)) != sorted(set(employer_keys)) or not employer_keys:
        return None
    candidate_hosts = config.get("candidate_hosts")
    if not isinstance(candidate_hosts, list) or not candidate_hosts:
        return None
    normalized_hosts: set[str] = set()
    for candidate_host in candidate_hosts:
        if not _nonempty_string(candidate_host):
            return None
        host = candidate_host.strip().lower().rstrip(".")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+", host):
            return None
        normalized_hosts.add(host)
    if len(normalized_hosts) != len(candidate_hosts):
        return None
    return {
        **config,
        "candidate_hosts": sorted(normalized_hosts),
        "employer_keys": sorted(set(configured_keys)),
    }


def _json(response: Any, label: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except (ValueError, AttributeError) as exc:
        raise AdpAdapterError(f"ADP {label} returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise AdpAdapterError(f"ADP {label} returned a non-object JSON response")
    return payload


def _total_number(payload: dict[str, Any]) -> int | None:
    meta = payload.get("meta")
    value = meta.get("totalNumber") if isinstance(meta, dict) else None
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return None


def _description(instruction: dict[str, Any], clean_description: Callable[[Any], str | None]) -> str | None:
    # The ADP sample response places the posting's long-form text under this
    # instruction's nameCode.longName. Do not substitute the channel label,
    # req title, or a summary for missing description text.
    name_code = instruction.get("nameCode")
    value = name_code.get("longName") if isinstance(name_code, dict) else None
    if not isinstance(value, str):
        return None
    return clean_description(value)


def _external_instructions(row: dict[str, Any]) -> list[dict[str, Any]]:
    instructions = row.get("postingInstructions")
    if not isinstance(instructions, list):
        return []
    selected: list[dict[str, Any]] = []
    for instruction in instructions:
        if not isinstance(instruction, dict):
            continue
        channel = instruction.get("postingChannel")
        channel = channel if isinstance(channel, dict) else {}
        if instruction.get("externalIndicator") is True or channel.get("externalIndicator") is True:
            selected.append(instruction)
    # The official guide recommends the default external channel (CC3).
    selected.sort(key=lambda instruction: (
        0 if (isinstance(instruction.get("postingChannel"), dict)
              and isinstance(instruction["postingChannel"].get("nameCode"), dict)
              and instruction["postingChannel"]["nameCode"].get("codeValue") == "CC3") else
        1 if (isinstance(instruction.get("postingChannel"), dict)
              and instruction["postingChannel"].get("defaultIndicator") is True) else 2
    ))
    return selected


def _single_query_value(query: str, name: str) -> str | None:
    try:
        values = [value for key, value in urllib.parse.parse_qsl(query, keep_blank_values=True, strict_parsing=True)
                  if key.casefold() == name.casefold()]
    except ValueError:
        return None
    if len(values) != 1 or not values[0]:
        return None
    return values[0]


def _candidate_url(instruction: dict[str, Any], allowed_hosts: set[str], tenant_client: str) -> str | None:
    channel = instruction.get("postingChannel")
    channel = channel if isinstance(channel, dict) else {}
    address = channel.get("internetAddress")
    value = address.get("uri") if isinstance(address, dict) else None
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    try:
        parsed = urllib.parse.urlparse(candidate)
    except ValueError:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    job_id = _single_query_value(parsed.query, "jobId")
    client = _single_query_value(parsed.query, "client")
    if (parsed.scheme.lower() != "https" or parsed.port not in (None, 443)
            or parsed.username or parsed.password or host not in allowed_hosts
            or not job_id or client != tenant_client):
        return None
    return candidate


def _location(row: dict[str, Any]) -> str | None:
    locations = row.get("requisitionLocations")
    if not isinstance(locations, list):
        return None
    values: list[str] = []
    for location in locations:
        if not isinstance(location, dict):
            continue
        address = location.get("address") if isinstance(location.get("address"), dict) else {}
        subdivision = address.get("countrySubdivisionLevel1") if isinstance(address.get("countrySubdivisionLevel1"), dict) else {}
        name = location.get("nameCode") if isinstance(location.get("nameCode"), dict) else {}
        parts = [
            address.get("cityName"), subdivision.get("shortName") or subdivision.get("codeValue"),
            address.get("countryCode"), name.get("shortName") or name.get("longName"),
        ]
        value = ", ".join(dict.fromkeys(part.strip() for part in parts if isinstance(part, str) and part.strip()))
        if value and value not in values:
            values.append(value)
    return "; ".join(values) or None


def _fetch_token(config: dict[str, Any], session: requests.Session) -> str:
    try:
        response = session.post(
            TOKEN_URL,
            data={"grant_type": "client_credentials"},
            auth=(config["client_id"], config["client_secret"]),
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            timeout=25,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise AdpAdapterError("ADP OAuth token request failed") from exc
    if response.status_code != 200:
        raise AdpAdapterError(f"ADP OAuth token endpoint returned HTTP {response.status_code}")
    payload = _json(response, "OAuth token endpoint")
    token = payload.get("access_token")
    if not _nonempty_string(token):
        raise AdpAdapterError("ADP OAuth response omitted an access token")
    return token


def fetch_jobs(
    source_url: str,
    employer: str,
    config: dict[str, Any],
    *,
    request_get: Callable[..., Any],
    clean_description: Callable[[Any], str | None],
) -> tuple[list[dict[str, Any]], bool, list[str]]:
    """Read all externally visible requisitions through the authorized WFN API."""
    session = requests.Session()
    session.cert = (config["certificate_file"], config["private_key_file"])
    jobs: list[dict[str, Any]] = []
    notes: list[str] = []
    requisitions: list[dict[str, Any]] = []
    expected_total: int | None = None
    skip = 0
    complete = True
    try:
        token = _fetch_token(config, session)
        for page_index in range(MAX_PAGES):
            query = urllib.parse.urlencode({
                "$top": str(PAGE_SIZE),
                "$skip": str(skip),
                "$filter": "visibleToJobSeekerIndicator eq true AND externalIndicator eq true",
            })
            response = request_get(
                f"{REQUISITIONS_URL}?{query}",
                timeout=30,
                session=session,
                check_robots=False,
                count_content_request=True,
                headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
                allowed_hosts={"api.adp.com"},
            )
            if response.status_code == 404 and expected_total is not None and skip >= expected_total:
                break
            if response.status_code != 200:
                raise AdpAdapterError(f"ADP Job Requisitions API returned HTTP {response.status_code} at offset {skip}")
            payload = _json(response, "Job Requisitions API")
            page_total = _total_number(payload)
            if page_total is None:
                complete = False
                notes.append("ADP response omitted a valid meta.totalNumber; source count cannot be verified")
            elif expected_total is None:
                expected_total = page_total
            elif expected_total != page_total:
                complete = False
                notes.append("ADP meta.totalNumber changed while paging")
            page_rows = payload.get("jobRequisitions")
            if not isinstance(page_rows, list):
                raise AdpAdapterError("ADP Job Requisitions API omitted jobRequisitions")
            if len(page_rows) > PAGE_SIZE:
                complete = False
                notes.append("ADP returned more than its documented 20 records per page")
            if not page_rows:
                if expected_total is not None and skip < expected_total:
                    complete = False
                    notes.append(f"ADP returned an empty page before expected offset {expected_total}")
                break
            valid_page_rows = [row for row in page_rows if isinstance(row, dict)]
            requisitions.extend(valid_page_rows)
            if len(valid_page_rows) != len(page_rows):
                complete = False
                notes.append("ADP returned a non-object requisition")
            skip += len(page_rows)
            if expected_total is not None and skip >= expected_total:
                break
            if len(page_rows) < PAGE_SIZE:
                if expected_total is None or skip != expected_total:
                    complete = False
                    notes.append("ADP pagination stopped before the reported requisition total")
                break
        else:
            complete = False
            notes.append(f"ADP pagination stopped at the {MAX_PAGES}-page safety limit")

        if expected_total is None:
            complete = False
        elif len(requisitions) != expected_total:
            complete = False
            notes.append(f"ADP returned {len(requisitions)} requisitions of {expected_total}")

        seen_ids: set[str] = set()
        allowed_hosts = set(config["candidate_hosts"])
        for row in requisitions:
            if row.get("visibleToJobSeekerIndicator") is not True:
                complete = False
                notes.append("ADP returned a requisition that is not visible to job seekers")
                continue
            instruction = next((candidate for candidate in _external_instructions(row)
                                if _candidate_url(candidate, allowed_hosts, config["tenant_client"])), None)
            if instruction is None:
                complete = False
                notes.append("ADP requisition lacked a valid, allowlisted external job URL")
                continue
            title = row.get("job", {}).get("jobTitle") if isinstance(row.get("job"), dict) else None
            external_id = row.get("itemID") or row.get("clientRequisitionID")
            if not isinstance(title, str) or not title.strip() or not isinstance(external_id, (str, int)) or not str(external_id).strip():
                complete = False
                notes.append("ADP requisition omitted a title or stable requisition ID")
                continue
            external_id = str(external_id).strip()
            if external_id in seen_ids:
                complete = False
                notes.append("ADP returned a duplicate requisition ID")
                continue
            seen_ids.add(external_id)
            description = _description(instruction, clean_description)
            if not description or len(description.strip()) <= 200:
                complete = False
                notes.append(f"ADP requisition {external_id} has no full description over 200 characters")
            channel = instruction.get("postingChannel") if isinstance(instruction.get("postingChannel"), dict) else {}
            channel_code = channel.get("nameCode") if isinstance(channel.get("nameCode"), dict) else {}
            name_code = instruction.get("nameCode") if isinstance(instruction.get("nameCode"), dict) else {}
            posted_at = instruction.get("postDate")
            jobs.append({
                "title": title.strip(),
                "company": employer,
                "location": _location(row),
                "source_url": _candidate_url(instruction, allowed_hosts, config["tenant_client"]),
                "external_job_id": external_id,
                "description_text": description,
                "snippet": (description or "")[:300] or None,
                "raw": {
                    "source_provider": "ADP Workforce Now",
                    "ats": "adp_wfn",
                    "requisition_id": external_id,
                    "client_requisition_id": row.get("clientRequisitionID"),
                    "posted_at": posted_at,
                    "posting_channel": channel_code.get("codeValue"),
                    "api_retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
                },
            })
        if expected_total == 0 and not requisitions:
            return [], complete and not notes, list(dict.fromkeys(notes))
        if len(jobs) != len(requisitions):
            complete = False
            notes.append(f"ADP yielded {len(jobs)} candidate URLs from {len(requisitions)} requisitions")
    finally:
        session.close()
    return jobs, complete and not notes, list(dict.fromkeys(notes))
