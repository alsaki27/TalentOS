#!/usr/bin/env python3
"""Partition a verified employer career cohort into balanced, host-exclusive CSVs.

Every input row is preserved in one output shard. URLs that normalize to the
same source group, and all source groups on one hostname, stay together. This
script only prepares tracker files; it does not fetch sources or ingest jobs.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

from employer_career_ingest import ADAPTER_VERSION, normalize_source_url


VERIFIED = {"verified_official", "verified_official_ats_link"}
ALGORITHM = "largest-host-first-greedy-v1"
RESULT_STATUSES = {"scraped", "no_jobs", "partial", "blocked", "error", "held"}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _attempted_groups(results_path: Path, adapter_version: str) -> set[str]:
    """Use valid results for the selected adapter; malformed lines are ignored."""
    attempted: set[str] = set()
    with results_path.open(encoding="utf-8") as results:
        for line in results:
            try:
                item = json.loads(line)
                if not isinstance(item, dict) or item.get("adapter_version") != adapter_version or item.get("status") not in RESULT_STATUSES:
                    continue
                url = item.get("normalized_url") or item.get("url")
                if not isinstance(url, str):
                    continue
                key = normalize_source_url(url)
                parsed = urlparse(key)
                if parsed.scheme in ("http", "https") and parsed.hostname:
                    attempted.add(key)
            except (json.JSONDecodeError, TypeError, ValueError):
                continue
    return attempted


def build_shards(
    input_path: Path,
    output_dir: Path,
    shard_count: int = 4,
    exclude_results: Path | None = None,
    exclude_adapter_version: str = ADAPTER_VERSION,
) -> dict:
    if shard_count < 1 or shard_count > 64:
        raise ValueError("shard_count must be between 1 and 64")
    if not exclude_adapter_version.strip():
        raise ValueError("exclude_adapter_version must not be empty")
    with input_path.open(newline="", encoding="utf-8-sig") as source_file:
        reader = csv.DictReader(source_file)
        fieldnames = reader.fieldnames
        if not fieldnames or "career_page_url" not in fieldnames or "career_page_status" not in fieldnames:
            raise ValueError("input must have career_page_url and career_page_status columns")
        input_rows = list(reader)
    if not input_rows:
        raise ValueError("input cohort has no rows")

    excluded_keys = _attempted_groups(exclude_results, exclude_adapter_version) if exclude_results else set()

    by_group: dict[str, list[dict[str, str]]] = defaultdict(list)
    groups_by_host: dict[str, set[str]] = defaultdict(set)
    rows: list[dict[str, str]] = []
    excluded_groups: set[str] = set()
    excluded_alias_rows = 0
    for line, row in enumerate(input_rows, start=2):
        if row.get("career_page_status") not in VERIFIED:
            raise ValueError(f"row {line} is not a verified career source; provide a verified-only cohort")
        url = (row.get("career_page_url") or "").strip()
        try:
            key = normalize_source_url(url)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"row {line} has an invalid career_page_url: {exc}") from exc
        host = (urlparse(key).hostname or "").lower()
        if not host or urlparse(key).scheme not in ("http", "https"):
            raise ValueError(f"row {line} has no valid HTTP source hostname")
        if key in excluded_keys:
            excluded_groups.add(key)
            excluded_alias_rows += 1
            continue
        rows.append(row)
        by_group[key].append(row)
        groups_by_host[host].add(key)

    host_assignment: dict[str, int] = {}
    group_totals = [0] * shard_count
    row_totals = [0] * shard_count
    for host, keys in sorted(groups_by_host.items(), key=lambda item: (-len(item[1]), item[0])):
        index = min(range(shard_count), key=lambda slot: (group_totals[slot], row_totals[slot], slot))
        host_assignment[host] = index
        group_totals[index] += len(keys)
        row_totals[index] += sum(len(by_group[key]) for key in keys)

    shard_rows: list[list[dict[str, str]]] = [[] for _ in range(shard_count)]
    for row in rows:
        key = normalize_source_url((row.get("career_page_url") or "").strip())
        host = (urlparse(key).hostname or "").lower()
        shard_rows[host_assignment[host]].append(row)

    filenames = [f"career_page_tracker_shard_{index + 1:02d}.csv" for index in range(shard_count)]
    output_dir.mkdir(parents=True, exist_ok=True)
    targets = [output_dir / filename for filename in filenames]
    manifest_path = output_dir / "shard_manifest.json"
    existing = [path for path in [*targets, manifest_path] if path.exists()]
    if existing:
        raise FileExistsError(f"shard output already exists; choose a new directory: {existing[0]}")

    shards = []
    for index, (target, selected) in enumerate(zip(targets, shard_rows)):
        with target.open("w", newline="", encoding="utf-8") as output_file:
            writer = csv.DictWriter(output_file, fieldnames=fieldnames, lineterminator="\n")
            writer.writeheader()
            writer.writerows(selected)
        shards.append({
            "index": index + 1,
            "file": target.name,
            "sha256": _sha256(target),
            "rows": len(selected),
            "normalized_source_groups": group_totals[index],
            "hostnames": sum(1 for assigned in host_assignment.values() if assigned == index),
        })

    if sum(shard["rows"] for shard in shards) != len(rows):
        raise AssertionError("shard rows did not reconcile with input")
    if sum(shard["normalized_source_groups"] for shard in shards) != len(by_group):
        raise AssertionError("shard source groups did not reconcile with input")

    manifest = {
        "algorithm": ALGORITHM,
        "input_file": input_path.name,
        "input_sha256": _sha256(input_path),
        "input_rows": len(input_rows),
        "emitted_rows": len(rows),
        "normalized_source_groups": len(by_group),
        "unique_hostnames": len(groups_by_host),
        "exclude_results_file": exclude_results.name if exclude_results else None,
        "exclude_results_sha256": _sha256(exclude_results) if exclude_results else None,
        "exclude_adapter_version": exclude_adapter_version if exclude_results else None,
        "excluded_normalized_source_groups": len(excluded_groups),
        "excluded_normalized_source_groups_sha256": hashlib.sha256(
            "".join(f"{key}\n" for key in sorted(excluded_groups)).encode("utf-8")
        ).hexdigest(),
        "excluded_alias_rows": excluded_alias_rows,
        "shard_count": shard_count,
        "host_exclusive": True,
        "alias_rows_preserved": True,
        "shards": shards,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="verified-only cohort tracker CSV")
    parser.add_argument("--output-dir", type=Path, required=True, help="new directory for shard CSVs and manifest")
    parser.add_argument("--shards", type=int, default=4)
    parser.add_argument("--exclude-results", type=Path, help="skip groups with a result for --exclude-adapter-version in this JSONL checkpoint")
    parser.add_argument("--exclude-adapter-version", default=ADAPTER_VERSION, help="adapter version to match in --exclude-results; defaults to the crawler's current version")
    args = parser.parse_args()
    print(json.dumps(build_shards(args.input, args.output_dir, args.shards, args.exclude_results, args.exclude_adapter_version), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
