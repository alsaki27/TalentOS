"""Build an integration-ready snapshot from an employer-career crawl checkpoint.

The crawler output directory may contain multiple attempts and adapter versions.
This report selects the latest result per normalized source (preserving an
earlier complete result for the same adapter). A comma-separated version list
supports checkpointed continuations that reuse complete results from an older
adapter while retrying unresolved sources with a newer one.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from employer_career_ingest import ADAPTER_VERSION, _platform, load_sources, normalize_source_url


def _paths(value: Path | list[Path]) -> list[Path]:
    return value if isinstance(value, list) else [value]


def _read_results(path: Path | list[Path], adapter_version: str) -> dict[str, dict[str, Any]]:
    versions = [value.strip() for value in adapter_version.split(",") if value.strip()]
    version_rank = {version: rank for rank, version in enumerate(versions)}
    selected: dict[str, dict[str, Any]] = {}
    for result_path in _paths(path):
        if not result_path.exists():
            continue
        with result_path.open(encoding="utf-8") as source_file:
            for line in source_file:
                try:
                    item = json.loads(line)
                    item_version = item.get("adapter_version")
                    if item_version not in version_rank:
                        continue
                    key = item.get("normalized_url") or normalize_source_url(item["url"])
                except (json.JSONDecodeError, KeyError, TypeError):
                    continue
                previous = selected.get(key)
                if previous:
                    previous_rank = version_rank.get(str(previous.get("adapter_version") or ""), -1)
                    item_rank = version_rank[str(item_version)]
                    if item_rank < previous_rank:
                        continue
                    if (
                        item_rank == previous_rank
                        and previous.get("complete") is True
                        and previous.get("method") == item.get("method")
                    ):
                        continue
                selected[key] = item
    return selected


def build_report(
    tracker_path: Path,
    results_path: Path | list[Path],
    jobs_path: Path | list[Path],
    output_dir: Path,
    adapter_version: str = ADAPTER_VERSION,
) -> dict[str, Any]:
    sources = load_sources(tracker_path)
    platform_counts = Counter(
        (_platform(source["url"]) or ("generic", ""))[0] for source in sources
    )
    adapter_versions = {value.strip() for value in adapter_version.split(",") if value.strip()}
    by_url = _read_results(results_path, adapter_version)
    complete = {
        key
        for key, item in by_url.items()
        if item.get("complete") is True and item.get("status") in ("scraped", "no_jobs")
    }
    statuses = Counter(str(item.get("status") or "unknown") for item in by_url.values())
    jobs_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    rejected_jobs = 0
    eligible_payload_rows = 0
    for one_jobs_path in _paths(jobs_path):
        if not one_jobs_path.exists():
            continue
        with one_jobs_path.open(encoding="utf-8") as job_file:
            for line in job_file:
                try:
                    job = json.loads(line)
                except json.JSONDecodeError:
                    rejected_jobs += 1
                    continue
                raw = job.get("raw") if isinstance(job.get("raw"), dict) else {}
                if raw.get("adapter_version") not in adapter_versions:
                    continue
                source_url = str(raw.get("career_source_url") or "")
                source_key = normalize_source_url(source_url) if source_url else ""
                selected_source = by_url.get(source_key)
                if (
                    not selected_source
                    or source_key not in complete
                    or raw.get("adapter_version") != selected_source.get("adapter_version")
                ):
                    continue
                eligible_payload_rows += 1
                required = ("title", "company", "source_url", "external_job_id")
                if any(not str(job.get(field) or "").strip() for field in required):
                    rejected_jobs += 1
                    continue
                key = (str(job["external_job_id"]).strip().lower(), str(job["source_url"]).strip().lower())
                jobs_by_key.setdefault(key, job)

    output_dir.mkdir(parents=True, exist_ok=True)
    ready_jobs_path = output_dir / "ready_jobs.jsonl"
    with ready_jobs_path.open("w", encoding="utf-8") as ready_file:
        for job in jobs_by_key.values():
            ready_file.write(json.dumps(job, ensure_ascii=False) + "\n")

    dispositions_path = output_dir / "source_dispositions.csv"
    with dispositions_path.open("w", newline="", encoding="utf-8-sig") as dispositions_file:
        writer = csv.DictWriter(
            dispositions_file,
            fieldnames=("normalized_url", "url", "employers", "employer_keys", "status", "complete", "job_count", "method", "error", "notes"),
        )
        writer.writeheader()
        for source in sources:
            item = by_url.get(source["normalized_url"])
            writer.writerow({
                "normalized_url": source["normalized_url"],
                "url": source["url"],
                "employers": " | ".join(source["employers"]),
                "employer_keys": " | ".join(source["employer_keys"]),
                "status": item.get("status", "not_started") if item else "not_started",
                "complete": bool(item and item.get("complete") is True and source["normalized_url"] in complete),
                "job_count": item.get("job_count", 0) if item else 0,
                "method": item.get("method", "") if item else "",
                "error": item.get("error", "") if item else "",
                "notes": " | ".join(item.get("notes") or []) if item else "",
            })

    summary = {
        "adapter_version": adapter_version,
        "tracker_path": str(tracker_path.resolve()),
        "results_path": [str(path.resolve()) for path in _paths(results_path)],
        "jobs_path": [str(path.resolve()) for path in _paths(jobs_path)],
        "normalized_source_groups_in_tracker": len(sources),
        "source_groups_by_direct_adapter": dict(sorted(platform_counts.items())),
        "source_groups_without_direct_ats_adapter": platform_counts.get("generic", 0),
        "unique_source_groups_with_result": len(by_url),
        "not_started_source_groups": max(0, len(sources) - len(by_url)),
        "complete_source_groups": len(complete),
        "complete_source_groups_with_jobs": sum(
            1 for key in complete if by_url[key].get("status") == "scraped"
        ),
        "complete_empty_source_groups": sum(
            1 for key in complete if by_url[key].get("status") == "no_jobs"
        ),
        "status_counts_by_source_group": dict(sorted(statuses.items())),
        "source_reported_job_count_for_complete_groups": sum(
            int(by_url[key].get("job_count") or 0) for key in complete
        ),
        "eligible_payload_rows_from_complete_groups": eligible_payload_rows,
        "unique_integration_ready_job_payloads": len(jobs_by_key),
        "rejected_or_malformed_job_rows": rejected_jobs,
        "live_ingest_performed": False,
        "ready_jobs_path": str(ready_jobs_path.resolve()),
        "source_dispositions_path": str(dispositions_path.resolve()),
    }
    (output_dir / "readiness_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tracker", type=Path, required=True)
    parser.add_argument("--results", type=Path, action="append", required=True, help="crawl results JSONL; repeat to combine checkpoints")
    parser.add_argument("--jobs", type=Path, action="append", required=True, help="jobs JSONL; repeat in the same order as --results")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--adapter-version", default=ADAPTER_VERSION)
    args = parser.parse_args()
    summary = build_report(args.tracker, args.results, args.jobs, args.output_dir, args.adapter_version)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
