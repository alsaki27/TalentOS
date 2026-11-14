#!/usr/bin/env python3
"""Policy-gated, overlap-safe wrapper for scheduled employer career crawls.

The employer tracker and permission manifest are private operational inputs.
Only exact normalized URLs with an unexpired approval record are passed to the
existing crawler. This wrapper is dry-run by default; ``--ingest`` is required
to stage complete results through TalentOS' existing Job CEO endpoint.
"""
from __future__ import annotations

import argparse
import csv
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import errno
from typing import Any, Iterator

import employer_career_ingest as crawler

try:
    import fcntl
except ImportError:  # Windows uses msvcrt below.
    fcntl = None  # type: ignore[assignment]


DEFAULT_OUTPUT_DIR = Path("outputs/employer-career-scheduled")
REQUIRED_POLICY_COLUMNS = {
    "normalized_url",
    "permission_status",
    "collection_scope",
    "permission_evidence_ref",
    "reviewed_at_utc",
    "reviewed_by",
    "expires_at_utc",
}
APPROVED_SCOPE = "job_listings_and_details"
VERIFIED_ROUTE_STATUSES = {"verified_official", "verified_official_ats_link"}


class PolicyManifestError(ValueError):
    pass


class RunLockBusy(OSError):
    """Raised only when another scheduler process owns the run lock."""


def _is_lock_contention(exc: OSError) -> bool:
    if os.name == "nt":
        return (
            getattr(exc, "winerror", None) in {33, 36}
            or (getattr(exc, "winerror", None) is None and exc.errno in {errno.EACCES, errno.EDEADLOCK})
        )
    return isinstance(exc, BlockingIOError) or exc.errno in {errno.EACCES, errno.EAGAIN, errno.EWOULDBLOCK}


def _parse_datetime(value: str, field: str, row_number: int) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except (AttributeError, ValueError) as exc:
        raise PolicyManifestError(f"policy row {row_number}: invalid {field}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_collection_policy(
    path: Path,
    *,
    now: datetime | None = None,
) -> tuple[set[str], dict[str, Any]]:
    """Load exact URL approvals; incomplete/expired rows remain held."""
    if not path.is_file():
        raise PolicyManifestError(f"permission manifest does not exist: {path}")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    current = current.astimezone(timezone.utc)

    approved: set[str] = set()
    seen: set[str] = set()
    status_counts: dict[str, int] = {}
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        fieldnames = set(reader.fieldnames or [])
        missing = REQUIRED_POLICY_COLUMNS - fieldnames
        if missing:
            raise PolicyManifestError("permission manifest is missing columns: " + ", ".join(sorted(missing)))
        for row_number, row in enumerate(reader, start=2):
            raw_url = (row.get("normalized_url") or "").strip()
            if not raw_url:
                raise PolicyManifestError(f"policy row {row_number}: normalized_url is required")
            normalized = crawler.normalize_source_url(raw_url)
            if normalized in seen:
                # Do not echo source URLs into console output or scheduled logs.
                raise PolicyManifestError(f"policy row {row_number}: duplicate normalized_url")
            seen.add(normalized)

            status = (row.get("permission_status") or "").strip().casefold()
            if status not in {"approved", "pending", "hold", "revoked"}:
                raise PolicyManifestError(f"policy row {row_number}: permission_status must be approved, pending, hold, or revoked")
            if status != "approved":
                status_counts[status] = status_counts.get(status, 0) + 1
                continue

            if (row.get("collection_scope") or "").strip() != APPROVED_SCOPE:
                raise PolicyManifestError(f"policy row {row_number}: approved rows require collection_scope={APPROVED_SCOPE}")
            if not (row.get("permission_evidence_ref") or "").strip():
                raise PolicyManifestError(f"policy row {row_number}: approved rows require permission_evidence_ref")
            if not (row.get("reviewed_by") or "").strip():
                raise PolicyManifestError(f"policy row {row_number}: approved rows require reviewed_by")
            reviewed_at = _parse_datetime(row.get("reviewed_at_utc") or "", "reviewed_at_utc", row_number)
            if reviewed_at > current:
                raise PolicyManifestError(f"policy row {row_number}: reviewed_at_utc cannot be in the future")
            expiry_text = (row.get("expires_at_utc") or "").strip()
            if expiry_text and _parse_datetime(expiry_text, "expires_at_utc", row_number) <= current:
                status_counts["expired"] = status_counts.get("expired", 0) + 1
                continue
            status_counts["approved"] = status_counts.get("approved", 0) + 1
            approved.add(normalized)

    return approved, {
        "manifest_rows": sum(status_counts.values()),
        "status_counts": status_counts,
        "approved_url_count": len(approved),
        "expired_rows": status_counts.get("expired", 0),
        "manifest_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def filter_tracker_by_permission(tracker_path: Path, approved_urls: set[str], output_path: Path) -> dict[str, int]:
    """Write a private filtered tracker without changing the source file."""
    if not tracker_path.is_file():
        raise FileNotFoundError(f"employer tracker does not exist: {tracker_path}")
    with tracker_path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        fieldnames = list(reader.fieldnames or [])
        required = {"career_page_status", "career_page_url"}
        if not required.issubset(fieldnames):
            raise ValueError("employer tracker must contain career_page_status and career_page_url")
        rows = list(reader)
    if not fieldnames:
        raise ValueError("employer tracker has no CSV header")

    verified_urls = {
        crawler.normalize_source_url(row["career_page_url"].strip())
        for row in rows
        if row.get("career_page_status") in VERIFIED_ROUTE_STATUSES and row.get("career_page_url", "").strip()
    }
    unknown_approved = approved_urls - verified_urls
    if unknown_approved:
        raise PolicyManifestError(f"approved policy URLs are absent from verified tracker ({len(unknown_approved)})")

    selected = [
        row for row in rows
        if row.get("career_page_status") in VERIFIED_ROUTE_STATUSES
        and row.get("career_page_url", "").strip()
        and crawler.normalize_source_url(row["career_page_url"].strip()) in approved_urls
    ]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.DictWriter(stream, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(selected)
    grouped = crawler.load_sources(output_path)
    return {
        "tracker_rows_total": len(rows),
        "verified_tracker_rows": sum(row.get("career_page_status") in VERIFIED_ROUTE_STATUSES for row in rows),
        "selected_tracker_rows": len(selected),
        "selected_source_groups": len(grouped),
        "selected_employer_key_count": sum(len(source.get("employer_keys", [])) for source in grouped),
        "approved_urls_not_in_tracker": len(unknown_approved),
    }


@contextmanager
def exclusive_lock(path: Path) -> Iterator[None]:
    """Prevent overlapping scheduler invocations on Windows and POSIX."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+b")
    locked = False
    try:
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if _is_lock_contention(exc):
                raise RunLockBusy("another scheduled employer career run holds the lock") from exc
            raise
        locked = True
        yield
    finally:
        if locked:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def _write_summary(path: Path, summary: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(summary, indent=2), encoding="utf-8")


def _current_crawler_summary(path: Path, tracker_path: Path, run_started: datetime) -> dict[str, Any] | None:
    """Accept only a structurally valid summary for this exact child run/input."""
    try:
        summary = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(summary, dict):
            return None
        child_started = _parse_datetime(summary.get("started_at_utc"), "started_at_utc", 0)
        tracker_hash = hashlib.sha256(tracker_path.read_bytes()).hexdigest()
    except (OSError, json.JSONDecodeError, PolicyManifestError, TypeError):
        return None
    status_counts = summary.get("status_counts_by_source_group")
    source_count = summary.get("unique_source_groups_with_result")
    content_request_count = summary.get("content_request_count")
    if not isinstance(status_counts, dict) or type(source_count) is not int or source_count < 0:
        return None
    if any(not isinstance(status, str) or type(count) is not int or count < 0 for status, count in status_counts.items()):
        return None
    if sum(status_counts.values()) != source_count:
        return None
    if (
        child_started < run_started
        or summary.get("adapter_version") != crawler.ADAPTER_VERSION
        or summary.get("tracker_sha256") != tracker_hash
        or type(content_request_count) is not int
        or content_request_count < 0
        or type(summary.get("content_fetch_started")) is not bool
        or summary.get("content_fetch_started") is not (content_request_count > 0)
        or type(summary.get("ingest_post_phase_invoked")) is not bool
        or type(summary.get("jobs_staged")) is not int
        or summary.get("jobs_staged") < 0
        or type(summary.get("jobs_skipped")) is not int
        or summary.get("jobs_skipped") < 0
    ):
        return None
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=crawler.DEFAULT_TRACKER, help="private employer tracker path")
    parser.add_argument("--permission-manifest", type=Path, required=True, help="private per-URL collection permission ledger")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR, help="private persistent crawl state and logs")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--refresh-completed-after-hours", type=float, default=24, help="refresh complete source results older than this interval")
    parser.add_argument("--ingest", action="store_true", help="stage complete jobs through TalentOS; off by default")
    args = parser.parse_args(argv)
    if not 1 <= args.workers <= 64:
        parser.error("--workers must be between 1 and 64")
    if not math.isfinite(args.refresh_completed_after_hours) or args.refresh_completed_after_hours <= 0:
        parser.error("--refresh-completed-after-hours must be a finite number greater than zero for scheduled runs")
    if args.ingest and not os.environ.get("INGEST_SECRET"):
        parser.error("--ingest requires INGEST_SECRET in the environment")

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    started = datetime.now(timezone.utc)
    summary_path = output_dir / "scheduled_run_summary.json"
    lock_path = output_dir / "scheduled_run.lock"
    try:
        lock = exclusive_lock(lock_path)
        lock.__enter__()
    except RunLockBusy:
        print("A scheduled employer career run already holds the lock; this invocation is skipped.")
        return 0

    try:
        approved_urls, policy_summary = load_collection_policy(args.permission_manifest)
        filtered_tracker = output_dir / "authorized_source_tracker.csv"
        selected_summary = filter_tracker_by_permission(args.input, approved_urls, filtered_tracker)
        base_summary: dict[str, Any] = {
            "run_started_at_utc": started.isoformat(),
            "adapter_version": crawler.ADAPTER_VERSION,
            "policy_manifest_sha256": policy_summary["manifest_sha256"],
            "input_tracker_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
            "policy_rows": policy_summary,
            "selected_sources": selected_summary,
            "refresh_completed_after_hours": args.refresh_completed_after_hours,
            "ingest_requested": args.ingest,
            "ingest_post_phase_invoked": False,
            "content_fetch_started": False,
            "output_dir": str(output_dir),
        }
        if not selected_summary["selected_source_groups"]:
            base_summary.update({
                "run_finished_at_utc": datetime.now(timezone.utc).isoformat(),
                "crawler_exit_code": 0,
                "crawler_invoked": False,
                "crawler_summary_valid": False,
                "result": "no approved source URLs; no content requests made",
            })
            _write_summary(summary_path, base_summary)
            print("No approved source URLs; no career-page requests were made.")
            return 0

        log_path = output_dir / f"crawler_{started.strftime('%Y%m%dT%H%M%SZ')}_{os.getpid()}.log"
        crawler_script = Path(__file__).with_name("employer_career_ingest.py")
        rate_dir = output_dir / "shared_host_rate"
        command = [
            sys.executable,
            str(crawler_script),
            "--input", str(filtered_tracker),
            "--output-dir", str(output_dir / "crawl_state"),
            "--workers", str(args.workers),
            "--refresh-completed-after-hours", str(args.refresh_completed_after_hours),
            "--shared-host-rate-dir", str(rate_dir),
        ]
        if args.ingest:
            command.append("--ingest")
        with log_path.open("w", encoding="utf-8") as log:
            completed = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=False)
        crawler_summary_path = output_dir / "crawl_state" / "run_summary.json"
        crawler_summary = _current_crawler_summary(crawler_summary_path, filtered_tracker, started)
        summary_valid = crawler_summary is not None
        crawler_summary = crawler_summary or {}
        run_ok = completed.returncode == 0 and summary_valid
        base_summary.update({
            "run_finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "crawler_exit_code": completed.returncode,
            "crawler_invoked": True,
            "crawler_summary_valid": summary_valid,
            "content_fetch_started": crawler_summary.get("content_fetch_started") if summary_valid else None,
            "ingest_post_phase_invoked": crawler_summary.get("ingest_post_phase_invoked") if summary_valid else None,
            "jobs_staged": crawler_summary.get("jobs_staged") if summary_valid else None,
            "jobs_skipped": crawler_summary.get("jobs_skipped") if summary_valid else None,
            "crawler_log": str(log_path),
            "content_request_count": crawler_summary.get("content_request_count") if summary_valid else None,
            "result": (
                "completed" if run_ok else
                ("crawler summary missing or invalid; inspect private log" if completed.returncode == 0 else "crawler failed; inspect private log")
            ),
        })
        _write_summary(summary_path, base_summary)
        result_code = completed.returncode if completed.returncode != 0 else (0 if summary_valid else 2)
        print(f"Scheduled employer career run result={base_summary['result']}; exit={result_code}; source groups={selected_summary['selected_source_groups']}; summary={summary_path}")
        return result_code
    except (PolicyManifestError, FileNotFoundError, ValueError) as exc:
        base_summary = {
            "run_started_at_utc": started.isoformat(),
            "run_finished_at_utc": datetime.now(timezone.utc).isoformat(),
            "adapter_version": crawler.ADAPTER_VERSION,
            "ingest_requested": args.ingest,
            "ingest_post_phase_invoked": False,
            "content_fetch_started": False,
            "error": str(exc),
        }
        _write_summary(summary_path, base_summary)
        print(f"Scheduled employer career run held before content fetch: {exc}", file=sys.stderr)
        return 2
    finally:
        lock.__exit__(None, None, None)


if __name__ == "__main__":
    raise SystemExit(main())
