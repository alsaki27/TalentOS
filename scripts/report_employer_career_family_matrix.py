"""Build a privacy-safe per-adapter summary from source dispositions.

The report intentionally excludes employer names and source URLs. It can be
run on historical or current dispositions; callers should label the checkpoint
date and adapter versions in the surrounding handoff.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from employer_career_ingest import _platform


def _parse_complete(value: str, row_number: int) -> bool:
    normalized = value.strip().lower()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no"}:
        return False
    raise ValueError(f"row {row_number}: complete must be a boolean")


def build_family_matrix(dispositions_path: Path) -> list[dict[str, Any]]:
    """Aggregate unique source groups by current route and saved disposition."""
    csv.field_size_limit(10_000_000)
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    complete_counts: Counter[str] = Counter()
    seen: set[str] = set()

    with dispositions_path.open(encoding="utf-8-sig", newline="") as source_file:
        reader = csv.DictReader(source_file)
        required = {"normalized_url", "url", "status", "complete"}
        if not reader.fieldnames or not required.issubset(reader.fieldnames):
            raise ValueError("dispositions CSV is missing required columns")

        for row_number, row in enumerate(reader, start=2):
            normalized_url = (row.get("normalized_url") or "").strip()
            url = (row.get("url") or "").strip()
            status = (row.get("status") or "").strip().lower()
            if not normalized_url or not url or not status:
                raise ValueError(f"row {row_number}: source group fields are incomplete")
            if normalized_url in seen:
                raise ValueError(f"row {row_number}: duplicate normalized source group")
            seen.add(normalized_url)

            complete = _parse_complete(row.get("complete") or "", row_number)
            if complete != (status in {"scraped", "no_jobs"}):
                raise ValueError(f"row {row_number}: status and complete flag disagree")

            route = _platform(url)
            family = route[0] if route else "generic"
            counts[family][status] += 1
            complete_counts[family] += int(complete)

    matrix: list[dict[str, Any]] = []
    for family in sorted(counts):
        statuses = counts[family]
        group_count = sum(statuses.values())
        record: dict[str, Any] = {
            "adapter_family": family,
            "group_count": group_count,
            "complete_count": complete_counts[family],
            "incomplete_count": group_count - complete_counts[family],
        }
        for status in sorted(statuses):
            record[f"status_{status}"] = statuses[status]
        matrix.append(record)
    return matrix


def write_family_matrix(matrix: list[dict[str, Any]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["adapter_family", "group_count", "complete_count", "incomplete_count"]
    fields.extend(sorted({key for row in matrix for key in row if key.startswith("status_")}))
    with output_path.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in matrix:
            writer.writerow(row)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dispositions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    matrix = build_family_matrix(args.dispositions)
    write_family_matrix(matrix, args.output)
    totals = {
        "adapter_families": len(matrix),
        "source_groups": sum(int(row["group_count"]) for row in matrix),
        "complete_groups": sum(int(row["complete_count"]) for row in matrix),
        "incomplete_groups": sum(int(row["incomplete_count"]) for row in matrix),
        "output_path": str(args.output.resolve()),
    }
    print(json.dumps(totals, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
