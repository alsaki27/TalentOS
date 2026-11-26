#!/usr/bin/env python3
"""Dry-run-first, permission-gated uploader for employer-crawl ready jobs.

This consumes the reporter's ready_jobs.jsonl output. It is deliberately
separate from the crawler: source crawling and permission filtering happen
before this script runs. The script verifies the same exact-source permission
manifest again, uses Job CEO's permanent external-ID check before upload, and
keeps a private atomic checkpoint so an acknowledged batch can be resumed.

No network calls are made unless --ingest is supplied. --ingest requires both
INGEST_SECRET and CRON_SECRET: batches use deferDispatch, then one exact-run
dispatch request is sent after all batches are staged. --wait-for-run polls the
read-only status API without redispatching. A completed run means Job CEO
reached its terminal state; logged_count is reported separately from staged_count.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
from typing import Any
import urllib.parse
import uuid

import requests

from employer_career_ingest import ADAPTER_VERSION, _restricted_external_job_source, _source_policy_hold
from employer_career_permissions import PolicyManifestError, load_collection_policy, normalize_source_url


SOURCE = "talentos_employer_career"
CURRENT_ADAPTER_VERSION = ADAPTER_VERSION
BATCH_SIZE = 100
MAX_POST_ATTEMPTS = 3
BACKOFF_SECONDS = (2, 4)
STATE_VERSION = 1
DEFAULT_STATE = Path("outputs/employer-career-upload-state.json")
MIN_DESCRIPTION_CHARS = 201


class UploadError(RuntimeError):
    """Fail-closed input, permission, API, or checkpoint error."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clean_job(value: Any) -> Any:
    """Make JSON output safe for NaN/Inf values without changing other fields."""
    if isinstance(value, dict):
        return {key: _clean_job(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_clean_job(item) for item in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def load_approved_ready_jobs(jobs_path: Path, manifest_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Validate ready payloads against exact active manifest URLs and fields."""
    try:
        approved_urls, permission_summary = load_collection_policy(manifest_path)
    except (OSError, PolicyManifestError) as exc:
        raise UploadError(f"permission manifest rejected: {exc}") from exc

    jobs: list[dict[str, Any]] = []
    seen_ids: dict[str, str] = {}
    rejected = 0
    with jobs_path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                job = json.loads(line)
            except json.JSONDecodeError as exc:
                raise UploadError(f"ready payload line {line_number} is invalid JSON") from exc
            if not isinstance(job, dict):
                raise UploadError(f"ready payload line {line_number} must be an object")

            raw = job.get("raw")
            raw = raw if isinstance(raw, dict) else {}
            if raw.get("adapter_version") != CURRENT_ADAPTER_VERSION:
                raise UploadError(
                    f"ready payload line {line_number} has a stale or unknown adapter version; "
                    f"expected {CURRENT_ADAPTER_VERSION}"
                )
            source_url = str(raw.get("career_source_url") or "").strip()
            try:
                normalized_source_url = normalize_source_url(source_url)
            except Exception as exc:
                raise UploadError(f"ready payload line {line_number} has no valid career source URL") from exc
            if normalized_source_url not in approved_urls:
                raise UploadError(f"ready payload line {line_number} has no active exact-source permission approval")
            source_host = urllib.parse.urlparse(source_url).hostname or ""
            policy_hold = _source_policy_hold(source_host, source_url, raw.get("employer_keys") if isinstance(raw.get("employer_keys"), list) else [])
            if policy_hold:
                raise UploadError(f"ready payload line {line_number} is currently policy-held: {policy_hold[0]}")
            if str(raw.get("source") or "").strip().lower() != SOURCE:
                raise UploadError(f"ready payload line {line_number} has an unexpected source tag")
            employer_keys = raw.get("employer_keys")
            if not isinstance(employer_keys, list) or not employer_keys or any(not str(key).strip() for key in employer_keys):
                raise UploadError(f"ready payload line {line_number} has no employer-key lineage")

            external_id = str(job.get("external_job_id") or "").strip()
            title = str(job.get("title") or "").strip()
            company = str(job.get("company") or "").strip()
            description = str(job.get("description_text") or "").strip()
            job_url = str(job.get("source_url") or "").strip()
            parsed_job_url = urllib.parse.urlparse(job_url)
            if not external_id or not title or not company:
                raise UploadError(f"ready payload line {line_number} is missing stable ID, title, or company")
            if len(description) < MIN_DESCRIPTION_CHARS:
                raise UploadError(f"ready payload line {line_number} has a short or missing full description")
            if parsed_job_url.scheme.lower() != "https" or not parsed_job_url.hostname:
                raise UploadError(f"ready payload line {line_number} does not have a canonical HTTPS job URL")
            restricted_job_host = _restricted_external_job_source(parsed_job_url.hostname)
            if restricted_job_host:
                raise UploadError(f"ready payload line {line_number} points at a held third-party source: {restricted_job_host}")

            identity = external_id.casefold()
            canonical = json.dumps(_clean_job(job), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            previous = seen_ids.get(identity)
            if previous is not None:
                if previous != canonical:
                    raise UploadError(f"ready payload line {line_number} conflicts with another row sharing its external job ID")
                rejected += 1
                continue
            seen_ids[identity] = canonical
            jobs.append(_clean_job(job))

    summary = {
        "ready_job_rows": len(jobs) + rejected,
        "unique_job_rows": len(jobs),
        "duplicate_rows_removed": rejected,
        "permission_manifest_sha256": permission_summary["manifest_sha256"],
        "approved_source_url_count": permission_summary["approved_url_count"],
        "ready_jobs_sha256": _sha256_file(jobs_path),
    }
    return jobs, summary


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": STATE_VERSION, "source": SOURCE, "active_run": None}
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UploadError("upload checkpoint is unreadable; preserve it and inspect before retrying") from exc
    if not isinstance(state, dict) or state.get("version") != STATE_VERSION or state.get("source") != SOURCE:
        raise UploadError("upload checkpoint has an unknown version or source")
    active = state.get("active_run")
    if active is not None and not isinstance(active, dict):
        raise UploadError("upload checkpoint active_run is malformed")
    return state


def save_state(path: Path, state: dict[str, Any]) -> None:
    """Atomically save only IDs, hashes, counts, status, and run metadata."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(path.name + ".tmp")
    payload = json.dumps(state, indent=2, sort_keys=True)
    temp_path.write_text(payload + "\n", encoding="utf-8")
    os.replace(temp_path, path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def fetch_seen_external_ids(session: requests.Session, base_url: str, secret: str) -> set[str]:
    url = base_url.rstrip("/") + "/api/job-ceo/seen-external-ids"
    try:
        response = session.get(
            url,
            params={"source": SOURCE},
            headers={"Authorization": f"Bearer {secret}"},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise UploadError("could not verify previously seen Job CEO IDs; refusing to upload") from exc
    if not isinstance(data, dict) or data.get("source") != SOURCE:
        raise UploadError("seen-ID response has an unexpected source")
    ids = data.get("external_job_ids")
    if not isinstance(ids, list) or data.get("count") != len(ids):
        raise UploadError("seen-ID response is incomplete or malformed")
    if any(not isinstance(item, str) or not item.strip() for item in ids):
        raise UploadError("seen-ID response contains invalid IDs")
    return {item.casefold() for item in ids}


def _validate_response(response: requests.Response, batch_size: int) -> tuple[str, int, int]:
    try:
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise UploadError("Job CEO ingest returned an invalid or unsuccessful response") from exc
    if not isinstance(data, dict) or data.get("total_received") != batch_size or data.get("dispatch_deferred") is not True:
        raise UploadError("Job CEO ingest response did not confirm the batch size and deferred-dispatch state")
    run_id = data.get("runId")
    try:
        run_id = str(uuid.UUID(str(run_id)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise UploadError("Job CEO ingest response did not contain a valid run ID") from exc
    staged = data.get("staged")
    skipped = data.get("skipped")
    if type(staged) is not int or type(skipped) is not int or staged < 0 or skipped < 0 or staged + skipped != batch_size:
        raise UploadError("Job CEO ingest response contains invalid staged/skipped counts")
    return run_id, staged, skipped


def _post_one_batch(
    session: requests.Session,
    *,
    url: str,
    secret: str,
    jobs: list[dict[str, Any]],
    run_id: str | None,
    attempt_limit: int = MAX_POST_ATTEMPTS,
) -> tuple[str, int, int]:
    payload: dict[str, Any] = {"jobs": jobs, "deferDispatch": True}
    if run_id:
        payload["runId"] = run_id
    last_error: Exception | None = None
    for attempt in range(attempt_limit):
        try:
            response = session.post(
                url,
                json=payload,
                headers={"Authorization": f"Bearer {secret}", "Content-Type": "application/json"},
                timeout=90,
            )
            return _validate_response(response, len(jobs))
        except (requests.RequestException, UploadError) as exc:
            last_error = exc
            # Before we have a run ID, an accepted request with a lost response
            # cannot be tied to a run. Retrying would create a second empty or
            # duplicate run, so persist an ambiguous state and stop.
            if run_id is None:
                raise UploadError("first Job CEO batch response is ambiguous; inspect server state before retrying") from exc
            if attempt + 1 < attempt_limit:
                time.sleep(BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)])
    raise UploadError(f"Job CEO batch failed after retries for run {run_id}") from last_error


def _active_run_for_plan(
    state: dict[str, Any],
    plan: dict[str, Any],
    jobs: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    active = state.get("active_run")
    if active:
        if active.get("ready_jobs_sha256") != plan["ready_jobs_sha256"] or active.get("permission_manifest_sha256") != plan["permission_manifest_sha256"]:
            if active.get("status") != "completed":
                raise UploadError("a different upload run is still active; resume or reconcile it before starting a new snapshot")
            state["active_run"] = None
            active = None
    if active is None:
        return {}, jobs

    candidate_ids = active.get("candidate_external_ids")
    if not isinstance(candidate_ids, list) or any(not isinstance(item, str) for item in candidate_ids):
        raise UploadError("active upload checkpoint has no valid candidate ID list")
    jobs_by_id = {str(job["external_job_id"]).casefold(): job for job in jobs}
    if any(item.casefold() not in jobs_by_id for item in candidate_ids):
        raise UploadError("ready payload no longer matches the active checkpoint")
    return active, [jobs_by_id[item.casefold()] for item in candidate_ids]


def upload_ready_jobs(
    jobs: list[dict[str, Any]],
    plan: dict[str, Any],
    *,
    base_url: str,
    secret: str,
    state_path: Path,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Upload unseen records in resumable batches; caller must opt in via CLI."""
    client = session or requests.Session()
    state = load_state(state_path)
    active, candidates = _active_run_for_plan(state, plan, jobs)
    resuming_existing_run = bool(active)
    if active and active.get("status") in {"ambiguous", "failed", "cancelled"}:
        raise UploadError("active run needs manual reconciliation before upload can continue")
    if active and active.get("status") == "completed":
        return dict(active)
    if active and active.get("status") in {"staged", "dispatching", "dispatch_ambiguous", "dispatched"}:
        return dict(active)

    if not active:
        seen_ids = fetch_seen_external_ids(client, base_url, secret)
        candidates = [job for job in jobs if str(job["external_job_id"]).casefold() not in seen_ids]
        if not candidates:
            result = {
                "status": "completed_no_new_jobs",
                "run_id": None,
                "ready_count": len(jobs),
                "candidate_count": 0,
                "staged_count": 0,
                "server_seen_count": len(jobs),
                "updated_at_utc": _now(),
            }
            state["last_result"] = {**result, **plan}
            state["active_run"] = None
            save_state(state_path, state)
            return result
        active = {
            "ready_jobs_sha256": plan["ready_jobs_sha256"],
            "permission_manifest_sha256": plan["permission_manifest_sha256"],
            "candidate_external_ids": [str(job["external_job_id"]) for job in candidates],
            "ready_count": len(jobs),
            "candidate_count": len(candidates),
            "next_batch_index": 0,
            "batch_count": (len(candidates) + BATCH_SIZE - 1) // BATCH_SIZE,
            "run_id": None,
            "staged_count": 0,
            "server_skipped_count": 0,
            "status": "uploading",
            "updated_at_utc": _now(),
        }
        state["active_run"] = active
        save_state(state_path, state)

    # The checkpoint is written before the first POST. If the process stops
    # after TalentOS accepts that POST but before the response/run ID is saved,
    # a later process must not blindly retry and create an untraceable run.
    if (
        resuming_existing_run
        and active.get("status") == "uploading"
        and active.get("run_id") is None
        and active.get("next_batch_index") == 0
    ):
        active["status"] = "ambiguous"
        active["ambiguity_reason"] = "process stopped before first batch run ID was checkpointed"
        active["updated_at_utc"] = _now()
        state["active_run"] = active
        save_state(state_path, state)
        raise UploadError("first Job CEO batch may have been accepted before interruption; inspect server state before retrying")

    run_id = active.get("run_id")
    next_batch = active.get("next_batch_index")
    if type(next_batch) is not int or next_batch < 0:
        raise UploadError("active upload checkpoint has an invalid batch cursor")
    url = base_url.rstrip("/") + "/api/job-ceo/ingest"
    while next_batch < active["batch_count"]:
        start = next_batch * BATCH_SIZE
        batch = candidates[start : start + BATCH_SIZE]
        try:
            returned_id, staged, skipped = _post_one_batch(
                client,
                url=url,
                secret=secret,
                jobs=batch,
                run_id=run_id,
            )
        except UploadError as exc:
            if run_id is None:
                active["status"] = "ambiguous"
                active["ambiguity_reason"] = "first batch response not confirmed"
            else:
                active["status"] = "upload_error"
                active["last_error"] = str(exc)
            active["updated_at_utc"] = _now()
            state["active_run"] = active
            save_state(state_path, state)
            raise
        if run_id and returned_id != run_id:
            raise UploadError("Job CEO returned a different run ID for a resumed batch")
        run_id = returned_id
        active["run_id"] = run_id
        active["staged_count"] += staged
        active["server_skipped_count"] += skipped
        active["next_batch_index"] = next_batch + 1
        active["status"] = "uploading"
        active["updated_at_utc"] = _now()
        state["active_run"] = active
        save_state(state_path, state)
        next_batch += 1

    active["status"] = "staged"
    active["updated_at_utc"] = _now()
    state["active_run"] = active
    save_state(state_path, state)
    return dict(active)


def _json_response(response: requests.Response, context: str) -> dict[str, Any]:
    try:
        response.raise_for_status()
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise UploadError(f"{context} returned an invalid or unsuccessful response") from exc
    if not isinstance(data, dict):
        raise UploadError(f"{context} response must be an object")
    return data


def dispatch_run_once(
    run_id: str,
    *,
    base_url: str,
    cron_secret: str,
    state_path: Path,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Send one scoped dispatch only after every batch has been acknowledged."""
    client = session or requests.Session()
    try:
        canonical_run_id = str(uuid.UUID(run_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise UploadError("cannot poll an invalid Job CEO run ID") from exc
    base = base_url.rstrip("/")
    headers = {"Authorization": f"Bearer {cron_secret}"}
    state = load_state(state_path)
    active = state.get("active_run")
    if not isinstance(active, dict) or active.get("run_id") != canonical_run_id:
        raise UploadError("checkpoint does not identify the requested Job CEO run")
    if active.get("status") in {"completed", "completed_no_new_jobs"}:
        return dict(active)
    if active.get("status") in {"dispatching", "dispatch_ambiguous"}:
        raise UploadError("run dispatch may already have been sent; inspect run status before retrying")
    if active.get("status") == "dispatched":
        return dict(active)
    if active.get("status") != "staged" or active.get("next_batch_index") != active.get("batch_count"):
        raise UploadError("refusing to dispatch before all deferred batches are staged")

    active["status"] = "dispatching"
    active["updated_at_utc"] = _now()
    state["active_run"] = active
    save_state(state_path, state)
    try:
        dispatch = _json_response(
            client.post(
                base + "/api/job-ceo/dispatch",
                params={"runId": canonical_run_id},
                headers=headers,
                timeout=300,
            ),
            "Job CEO dispatch",
        )
        if dispatch.get("runId") != canonical_run_id or type(dispatch.get("needsDispatch")) is not bool:
            raise UploadError("Job CEO dispatch did not confirm the requested run")
    except (requests.RequestException, UploadError) as exc:
        active["status"] = "dispatch_ambiguous"
        active["ambiguity_reason"] = "dispatch response not confirmed"
        active["updated_at_utc"] = _now()
        state["active_run"] = active
        save_state(state_path, state)
        raise UploadError("dispatch response is ambiguous; inspect the exact run before retrying") from exc
    active["status"] = "dispatched"
    active["dispatch_needs_dispatch"] = dispatch["needsDispatch"]
    active["updated_at_utc"] = _now()
    state["active_run"] = active
    save_state(state_path, state)
    return dict(active)


def drive_and_verify_run(
    run_id: str,
    *,
    base_url: str,
    cron_secret: str,
    timeout_seconds: int = 3600,
    poll_seconds: float = 5.0,
    session: requests.Session | None = None,
) -> dict[str, Any]:
    """Poll a dispatched run without sending any further dispatch requests."""
    client = session or requests.Session()
    try:
        canonical_run_id = str(uuid.UUID(run_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise UploadError("cannot poll an invalid Job CEO run ID") from exc
    if timeout_seconds <= 0:
        raise UploadError("wait timeout must be positive")
    status_url = base_url.rstrip("/") + "/api/job-ceo/runs/" + canonical_run_id
    headers = {"Authorization": f"Bearer {cron_secret}"}
    deadline = time.monotonic() + timeout_seconds
    latest: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        try:
            status_data = _json_response(client.get(status_url, headers=headers, timeout=30), "Job CEO status")
        except requests.RequestException as exc:
            raise UploadError("Job CEO status request failed") from exc
        run = status_data.get("run")
        if not isinstance(run, dict) or run.get("id") != canonical_run_id:
            raise UploadError("Job CEO status did not identify the requested run")
        status = run.get("status")
        if status not in {"staging", "ingesting", "qa", "deep_fetch", "matchmaking", "completed", "failed", "cancelled"}:
            raise UploadError("Job CEO returned an unknown run status")
        stages = status_data.get("stages")
        if not isinstance(stages, list) or any(not isinstance(item, dict) for item in stages):
            raise UploadError("Job CEO status has malformed stage counts")
        logged = run.get("logged_count")
        if type(logged) is not int or logged < 0:
            raise UploadError("Job CEO run has an invalid logged_count")
        latest = {"run_id": canonical_run_id, "status": status, "logged_count": logged, "stages": stages}
        if status in {"completed", "failed", "cancelled"}:
            if status != "completed":
                latest["last_error"] = str(run.get("last_error") or "")
            return latest
        time.sleep(poll_seconds)
    raise UploadError(f"timed out waiting for Job CEO run {canonical_run_id}; last status={latest.get('status') if latest else 'unknown'}")


def run_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", required=True, type=Path, help="reporter ready_jobs.jsonl")
    parser.add_argument("--permission-manifest", required=True, type=Path, help="private active per-source permission manifest")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE, help="private resumable upload checkpoint")
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL") or os.environ.get("TALENTOS_INGEST_URL") or "https://talent.skarion.com")
    parser.add_argument("--ingest", action="store_true", help="explicitly POST eligible jobs to Job CEO")
    parser.add_argument("--wait-for-run", action="store_true", help="drive and verify the returned Job CEO run")
    parser.add_argument("--wait-timeout-seconds", type=int, default=3600)
    args = parser.parse_args(argv)
    if args.wait_for_run and not args.ingest:
        parser.error("--wait-for-run requires --ingest")

    try:
        jobs, plan = load_approved_ready_jobs(args.jobs, args.permission_manifest)
        state = load_state(args.state)
        if not args.ingest:
            print(
                f"dry-run: eligible={len(jobs)} duplicate_input_rows_removed={plan['duplicate_rows_removed']} "
                f"approved_source_urls={plan['approved_source_url_count']} network_calls=0"
            )
            print("No jobs were uploaded. Pass --ingest to check server IDs and stage the approved payloads.")
            return 0
        secret = (os.environ.get("INGEST_SECRET") or os.environ.get("JOB_CEO_INGEST_SECRET") or "").strip()
        if not secret:
            raise UploadError("INGEST_SECRET or JOB_CEO_INGEST_SECRET is required with --ingest")
        cron_secret = (os.environ.get("CRON_SECRET") or "").strip()
        if not cron_secret:
            raise UploadError("CRON_SECRET is required with --ingest")
        result = upload_ready_jobs(
            jobs,
            plan,
            base_url=args.base_url,
            secret=secret,
            state_path=args.state,
        )
        run_id = result.get("run_id")
        if run_id:
            result = dispatch_run_once(
                run_id,
                base_url=args.base_url,
                cron_secret=cron_secret,
                state_path=args.state,
            )
            if args.wait_for_run:
                verified = drive_and_verify_run(
                    run_id,
                    base_url=args.base_url,
                    cron_secret=cron_secret,
                    timeout_seconds=args.wait_timeout_seconds,
                )
            else:
                verified = None
            state = load_state(args.state)
            active = state.get("active_run")
            if verified and isinstance(active, dict) and active.get("run_id") == run_id:
                active.update(verified)
                active["status"] = verified["status"]
                active["updated_at_utc"] = _now()
                state["last_result"] = {**active, **plan}
                state["active_run"] = active
                save_state(args.state, state)
            if verified and verified["status"] != "completed":
                raise UploadError(f"Job CEO run ended with status={verified['status']}")
            if verified:
                print(f"Job CEO run completed: staged={result.get('staged_count', 0)} logged={verified['logged_count']} run_id={run_id}")
            else:
                print(f"Job CEO run dispatched once: staged={result.get('staged_count', 0)} run_id={run_id}")
        else:
            print(
                f"Job CEO upload status={result.get('status')} staged={result.get('staged_count', 0)} "
                f"skipped={result.get('server_skipped_count', 0)} run_id={run_id or 'none'}"
            )
        return 0
    except UploadError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(run_cli())
