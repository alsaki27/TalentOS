#!/usr/bin/env python3
"""Build combined readiness while excluding explicitly invalid crawl run folders.

Pass historical checkpoints first and newer clean shards last. A run folder
containing INVALID_ROBOTS_RUN.json is excluded with both its results and jobs.
The underlying reporter still decides source and job eligibility.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from employer_career_ingest import ADAPTER_VERSION
from report_employer_career_ingest import build_report


INVALID_MARKER = "INVALID_ROBOTS_RUN.json"


def select_runs(run_dirs: list[Path], *, allow_pending: bool = False) -> tuple[list[Path], list[Path], list[dict[str, str]], list[str]]:
    """Pair result/job paths and fail closed when a run is marked invalid."""
    results: list[Path] = []
    jobs: list[Path] = []
    excluded: list[dict[str, str]] = []
    pending: list[str] = []
    seen: set[Path] = set()
    for run_dir in run_dirs:
        run_dir = run_dir.resolve()
        if run_dir in seen:
            raise ValueError(f"duplicate run directory: {run_dir}")
        seen.add(run_dir)
        marker = run_dir / INVALID_MARKER
        if marker.exists():
            excluded.append({
                "run_dir": str(run_dir),
                "marker_sha256": hashlib.sha256(marker.read_bytes()).hexdigest(),
            })
            continue
        result_path = run_dir / "source_results.jsonl"
        jobs_path = run_dir / "jobs.jsonl"
        if not result_path.is_file() or not jobs_path.is_file():
            if allow_pending and run_dir.is_dir():
                pending.append(str(run_dir))
                continue
            raise FileNotFoundError(f"run directory lacks paired source_results.jsonl/jobs.jsonl: {run_dir}")
        results.append(result_path)
        jobs.append(jobs_path)
    if not results:
        raise ValueError("no valid run directories were selected")
    return results, jobs, excluded, pending


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracker", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, action="append", required=True, help="repeat in chronological order; invalid marked runs are excluded")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--adapter-version", default=ADAPTER_VERSION)
    parser.add_argument("--min-sitemap-adapter-version")
    parser.add_argument("--allow-pending", action="store_true", help="skip existing run folders until both JSONL files are present")
    args = parser.parse_args()

    results, jobs, excluded, pending = select_runs(args.run_dir, allow_pending=args.allow_pending)
    summary = build_report(
        args.tracker, results, jobs, args.output_dir,
        args.adapter_version, args.min_sitemap_adapter_version,
    )
    selection = {
        "selected_run_dirs": [str(path.parent) for path in results],
        "excluded_invalid_run_dirs": excluded,
        "pending_run_dirs": pending,
    }
    (args.output_dir / "run_selection.json").write_text(json.dumps(selection, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"run_selection": selection, "readiness_summary": summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
