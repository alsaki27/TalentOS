"""Audit frozen crawl shards and build exact private retry trackers.

Run without --write for a read-only audit. Stop all shard processes first,
then rerun with --write into a new output directory. A source group is retained
when it has one valid non-error result and every tagged job row matches that
result's attempt, source, adapter version, and job_count. All other groups are
requeued; this script never edits the frozen inputs.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import csv
import hashlib
import json
from pathlib import Path
from typing import Any

from employer_career_ingest import load_sources, normalize_source_url


RETAINED_STATUSES = {"scraped", "no_jobs", "partial", "blocked", "held"}
ALL_STATUSES = RETAINED_STATUSES | {"error"}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise ValueError(f"missing frozen JSONL: {path}")
    with path.open("rb") as stream:
        stream.seek(0, 2)
        if stream.tell():
            stream.seek(-1, 2)
            if stream.read(1) != b"\n":
                raise ValueError(f"JSONL has an unterminated final line: {path}")
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, 1):
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"malformed JSONL {path}:{line_number}: {exc}") from exc
            if not isinstance(row, dict):
                raise ValueError(f"non-object JSONL {path}:{line_number}")
            rows.append(row)
    return rows


def _frozen_signature(paths: list[Path]) -> tuple[tuple[int, int], ...]:
    return tuple((path.stat().st_size, path.stat().st_mtime_ns) for path in paths)


def _tracker(path: Path) -> tuple[list[str], list[dict[str, str]], dict[str, list[dict[str, str]]]]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        fields = list(reader.fieldnames or [])
        rows = list(reader)
    if not fields or "career_page_url" not in fields:
        raise ValueError(f"tracker has no career_page_url: {path}")
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        if row.get("career_page_status") not in {"verified_official", "verified_official_ats_link"}:
            raise ValueError(f"tracker includes an unverified source row: {path}")
        groups[normalize_source_url((row.get("career_page_url") or "").strip())].append(row)
    if any(not key for key in groups):
        raise ValueError(f"tracker has an empty normalized source URL: {path}")
    return fields, rows, groups


def audit_shard(run_dir: Path, expected_version: str) -> dict[str, Any]:
    manifest_path = run_dir / "run_manifest.json"
    result_path = run_dir / "source_results.jsonl"
    job_path = run_dir / "jobs.jsonl"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    tracker_path = Path(manifest["tracker_path"])
    paths = [tracker_path, manifest_path, result_path, job_path]
    before = _frozen_signature(paths)
    if manifest.get("adapter_version") != expected_version:
        raise ValueError(f"adapter version mismatch in {run_dir}")
    fields, tracker_rows, groups = _tracker(tracker_path)
    if len(groups) != manifest.get("normalized_unique_career_urls"):
        raise ValueError(f"tracker denominator mismatch in {run_dir}")
    results = _jsonl(result_path)
    jobs = _jsonl(job_path)
    if _frozen_signature(paths) != before:
        raise ValueError(f"input changed during audit; stop shard before checkpoint: {run_dir}")

    results_by_group: dict[str, dict[str, Any]] = {}
    attempt_to_group: dict[str, str] = {}
    for row in results:
        group = row.get("normalized_url")
        attempt = row.get("crawl_attempt_id")
        if (not isinstance(group, str) or group not in groups
                or normalize_source_url(str(row.get("url") or "")) != group
                or row.get("adapter_version") != expected_version
                or row.get("status") not in ALL_STATUSES
                or not isinstance(attempt, str) or not attempt
                or group in results_by_group or attempt in attempt_to_group):
            raise ValueError(f"duplicate, foreign, or invalid source result in {run_dir}: {group}")
        results_by_group[group] = row
        attempt_to_group[attempt] = group

    jobs_by_attempt: Counter[str] = Counter()
    orphan_groups: set[str] = set()
    invalid_payload_groups: set[str] = set()
    orphan_job_rows = 0
    for job in jobs:
        raw = job.get("raw")
        if not isinstance(raw, dict):
            raise ValueError(f"job row omitted raw provenance in {run_dir}")
        attempt = raw.get("crawl_attempt_id")
        source_url = raw.get("career_source_url")
        if not isinstance(attempt, str) or not attempt or not isinstance(source_url, str):
            raise ValueError(f"job row omitted crawl attempt or career source in {run_dir}")
        group = normalize_source_url(source_url)
        if group not in groups:
            raise ValueError(f"job row points outside shard tracker in {run_dir}: {group}")
        if attempt not in attempt_to_group:
            orphan_groups.add(group)
            orphan_job_rows += 1
            continue
        result_group = attempt_to_group[attempt]
        jobs_by_attempt[attempt] += 1
        if group != result_group or raw.get("adapter_version") != expected_version:
            invalid_payload_groups.add(result_group)
            invalid_payload_groups.add(group)

    payload_mismatches: set[str] = set()
    retryable_errors: set[str] = set()
    retained: set[str] = set()
    for group, row in results_by_group.items():
        count = row.get("job_count")
        if not isinstance(count, int) or count < 0 or jobs_by_attempt[row["crawl_attempt_id"]] != count:
            payload_mismatches.add(group)
        if row["status"] == "error":
            retryable_errors.add(group)
        if (row["status"] in RETAINED_STATUSES and group not in payload_mismatches
                and group not in invalid_payload_groups and group not in orphan_groups):
            retained.add(group)
    retry = set(groups) - retained
    if retained & retry or retained | retry != set(groups):
        raise ValueError(f"coverage partition failed in {run_dir}")
    retry_rows = [row for row in tracker_rows if normalize_source_url(row["career_page_url"].strip()) in retry]
    return {
        "run_dir": run_dir,
        "tracker_path": tracker_path,
        "fields": fields,
        "retry_rows": retry_rows,
        "input_groups": set(groups),
        "retained_groups": retained,
        "retry_groups": retry,
        "report": {
            "input_tracker_rows": len(tracker_rows),
            "input_source_groups": len(groups),
            "recorded_source_groups": len(results_by_group),
            "retained_source_groups": len(retained),
            "retry_source_groups": len(retry),
            "retry_alias_rows": len(retry_rows),
            "status_counts": dict(Counter(row["status"] for row in results)),
            "payload_mismatch_groups": len(payload_mismatches),
            "invalid_payload_groups": len(invalid_payload_groups),
            "orphan_job_rows": orphan_job_rows,
            "orphan_source_groups": len(orphan_groups),
            "retryable_error_groups": len(retryable_errors),
            "result_job_rows": sum(int(row.get("job_count") or 0) for row in results),
            "actual_job_rows": len(jobs),
            "input_sha256": _sha256(tracker_path),
            "results_sha256": _sha256(result_path),
            "jobs_sha256": _sha256(job_path),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, action="append", required=True,
                        help="frozen shard directory; repeat once per shard")
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="new private directory for retry trackers and manifest")
    parser.add_argument("--expected-version", required=True)
    parser.add_argument("--write", action="store_true", help="write trackers after stopping every shard")
    args = parser.parse_args()

    shards = [audit_shard(path.resolve(), args.expected_version) for path in args.run_dir]
    input_groups = set().union(*(shard["input_groups"] for shard in shards))
    retained = set().union(*(shard["retained_groups"] for shard in shards))
    retry = set().union(*(shard["retry_groups"] for shard in shards))
    if sum(len(shard["input_groups"]) for shard in shards) != len(input_groups):
        raise ValueError("input shard source groups overlap")
    if len(input_groups) != len(retained) + len(retry) or retained & retry:
        raise ValueError("global source coverage is not exact")
    manifest: dict[str, Any] = {
        "expected_version": args.expected_version,
        "input_source_groups": len(input_groups),
        "retained_source_groups": len(retained),
        "retry_source_groups": len(retry),
        "coverage_union_source_groups": len(retained | retry),
        "shards": [],
    }
    if args.write:
        args.output_dir.mkdir(parents=True, exist_ok=False)
    for index, shard in enumerate(shards, 1):
        report = dict(shard["report"])
        report["shard"] = f"{index:02d}"
        report["source_run_dir"] = str(shard["run_dir"])
        if args.write:
            output = args.output_dir / f"career_page_tracker_shard_{index:02d}.csv"
            with output.open("w", newline="", encoding="utf-8") as stream:
                writer = csv.DictWriter(stream, fieldnames=shard["fields"])
                writer.writeheader()
                writer.writerows(shard["retry_rows"])
            if len(load_sources(output)) != report["retry_source_groups"]:
                raise ValueError(f"written retry tracker count differs in shard {index:02d}")
            report["output_tracker_path"] = str(output.resolve())
            report["output_sha256"] = _sha256(output)
        manifest["shards"].append(report)
    if args.write:
        (args.output_dir / "resume_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
