#!/usr/bin/env python3
"""
scripts/openjobdata_ingest.py

Nightly ingestion: scans openjobdata.com's daily deltas for TalentOS's Job Agent
role groups and POSTs the results to TalentOS's job_agent staging pipeline
(POST /api/job-agent/openjobdata-ingest), where they're deduped, AI-classified,
and staged for review exactly like an Apify run — see comparison_report.md for
why openjobdata is the intended "broad net" source and Apify stays the
on-demand/real-time one.

Role group ids/labels/title lists here MUST stay in sync with
src/lib/jobAgentRoleLibrary.ts (the TypeScript source of truth) — this script
does not read that file directly (it's a separate Python process, typically run
from a GitHub Actions runner with no Node toolchain available), so a title added
there needs a matching edit here.

Usage:
    # One role group, last 1 day (the nightly default):
    python scripts/openjobdata_ingest.py --role-group A

    # All role groups, last 1 day:
    python scripts/openjobdata_ingest.py --role-group all

    # Wider backfill window, dry run (no POST, just prints counts):
    python scripts/openjobdata_ingest.py --role-group C --days 7 --dry-run

Requires TALENTOS_INGEST_URL (e.g. https://skarion-talent-os.<account>.workers.dev)
and CRON_SECRET as env vars (same secret the /api/cron/* routes already use).
No Hugging Face token is required — the openjobdata bucket is public.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

from openjobdata_common import run_keyword_ingest

# Mirrors src/lib/jobAgentRoleLibrary.ts's ROLE_GROUPS exactly (ids A-L). Keep in
# sync — a title added on the TypeScript side needs a matching edit here.
ROLE_GROUPS: dict[str, dict] = {
    "A": {
        "label": "OSP / Fiber",
        "titles": [
            "OSP Design Engineer", "Outside Plant Engineer", "OSP Engineer",
            "Fiber Design Engineer", "FTTH Design Engineer", "Fiber Optic Design Engineer",
            "Telecom Design Engineer", "Splice Engineer", "Fiber Splicing Engineer",
            "OSP Planning Engineer", "OSP CAD Designer", "Fiber Network Engineer",
            "Fiber Construction Engineer", "Outside Plant Designer",
            "Telecommunications Engineer", "Fiber Route Engineer",
            "Aerial Fiber Design Engineer", "Underground Fiber Design Engineer",
            "Joint Use Engineer", "Make Ready Engineer", "Fiber Permitting Engineer",
            "GIS Fiber Design Technician", "OSP Project Engineer",
            "Fiber Design Technician", "OSP Field Engineer",
            "Fiber Construction Manager", "OSP Estimator",
            "Telecom Infrastructure Engineer", "Broadband Design Engineer",
            "FTTx Design Engineer", "Fiber Network Planner", "OSP QC Engineer",
            "Fiber Splice Technician", "Broadband Network Engineer", "Fiber Engineer",
        ],
    },
    "B": {
        "label": "CAD / Drafting",
        "titles": [
            "AutoCAD Drafter", "CAD Technician", "CAD Designer", "Drafter",
            "Drafter I", "Design Drafter", "Civil CAD Drafter",
            "Electrical CAD Drafter", "Mechanical CAD Drafter", "Structural Drafter",
            "CAD Operator", "Engineering Technician CAD", "Utility Drafter",
            "Land Surveying Drafter", "Piping Designer", "Site Design Technician",
            "BIM Technician", "Construction Drafter", "Telecom Drafter",
            "Drafting Technician",
        ],
    },
    "C": {
        "label": "GIS / Geospatial",
        "titles": [
            "GIS Analyst", "GIS Technician", "GIS Specialist", "GIS Coordinator",
            "GIS Developer", "GIS Mapping Technician", "Geospatial Analyst",
            "GIS Data Analyst", "GIS Analyst I", "GIS Technician I",
            "Utility GIS Analyst", "Telecom GIS Analyst", "GIS Field Technician",
            "Cartographer", "Remote Sensing Analyst", "GIS Database Technician",
            "GIS QA/QC Analyst", "Land Records GIS Analyst",
            "Environmental GIS Analyst", "GIS Support Specialist",
        ],
    },
    "D": {
        "label": "Mechanical / Manufacturing / Product CAD",
        "titles": [
            "Mechanical Drafter", "Mechanical Designer", "Mechanical CAD Technician",
            "Product Design Drafter", "Product Development Designer",
            "Manufacturing Drafter", "Tool Design Drafter", "Tooling Designer",
            "Fixture Designer", "Jig and Fixture Designer", "Sheet Metal Drafter",
            "Weldment Drafter", "SolidWorks Drafter", "SolidWorks Designer",
            "Inventor Drafter", "3D CAD Modeler",
        ],
    },
    "E": {
        "label": "Electrical / Controls / PCB CAD",
        "titles": [
            "Electrical Drafter", "Electrical Designer", "Electrical Design Technician",
            "Controls Drafter", "Instrumentation Drafter",
            "Instrumentation Designer", "Wiring Harness Designer", "Harness Drafter",
            "Panel Designer", "Schematic Drafter", "Power Distribution Drafter",
            "PCB Designer", "PCB Layout Designer",
        ],
    },
    "F": {
        "label": "Civil / Land Development CAD",
        "titles": [
            "Civil Drafter", "Civil Designer", "Civil 3D Technician",
            "Land Development Drafter", "Site Civil Drafter", "Roadway Drafter",
            "Highway Drafter", "Transportation Drafter", "Stormwater Drafter",
            "Grading Drafter", "Subdivision Drafter", "Municipal Drafter",
        ],
    },
    "G": {
        "label": "Structural / Steel / Rebar Detailing",
        "titles": [
            "Structural Steel Detailer", "Steel Detailer",
            "Miscellaneous Steel Detailer", "Rebar Detailer", "Concrete Detailer",
            "Precast Detailer", "Structural Designer", "Structural CAD Technician",
            "Tekla Detailer", "SDS2 Detailer",
        ],
    },
    "H": {
        "label": "Architectural / Building / Interiors",
        "titles": [
            "Architectural Drafter", "Architectural Designer",
            "Architectural CAD Technician", "Revit Drafter", "Revit Technician",
            "Revit Designer", "Building Designer", "Residential Drafter",
            "Millwork Drafter", "Casework Designer", "Kitchen and Bath Designer",
            "Space Planner",
        ],
    },
    "I": {
        "label": "MEP / HVAC / Plumbing / Fire Protection",
        "titles": [
            "MEP Drafter", "MEP Designer", "HVAC Drafter", "HVAC Designer",
            "Plumbing Drafter", "Plumbing Designer", "Fire Protection Drafter",
            "Fire Sprinkler Designer", "Fire Sprinkler Drafter", "Ductwork Drafter",
        ],
    },
    "J": {
        "label": "Piping / Process / Industrial Plant",
        "titles": [
            "Piping Drafter", "Process Piping Drafter", "Plant Design Drafter",
            "Plant Layout Designer", "P&ID Drafter", "Industrial Drafter",
        ],
    },
    "K": {
        "label": "Utility / Energy / Renewables",
        "titles": [
            "Utility Designer", "Utility CAD Designer", "Substation Drafter",
            "Transmission Drafter", "Distribution Designer", "Solar Designer",
            "Solar Drafter", "Solar PV Designer", "Renewable Energy Drafter",
        ],
    },
    "L": {
        "label": "Cross-industry Entry-level",
        "titles": [
            "Junior Drafter", "Associate Designer", "Design Technician",
            "Detailing Technician", "Layout Designer", "Drafting Intern",
            "CAD Intern",
        ],
    },
}

INGEST_PATH = "/api/job-agent/openjobdata-ingest"
BATCH_SIZE = 500  # keep individual POST bodies reasonable


def post_batch(base_url: str, secret: str, role_group: str, role_group_label: str, jobs: list[dict]) -> dict:
    payload = json.dumps({
        "roleGroup": role_group,
        "roleGroupLabel": role_group_label,
        "jobs": jobs,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{base_url.rstrip('/')}{INGEST_PATH}",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Ingest POST failed ({e.code}): {body}") from e


def run_for_group(group_id: str, days: int, end_date: str | None, base_url: str, secret: str, dry_run: bool) -> None:
    group = ROLE_GROUPS[group_id]
    jobs = run_keyword_ingest(
        keywords=group["titles"],
        days=days,
        end_date=end_date,
        log_prefix=f"openjobdata-ingest-{group_id}",
    )

    if not jobs:
        print(f"[openjobdata-ingest-{group_id}] Nothing matched — skipping POST.")
        return

    if dry_run:
        print(f"[openjobdata-ingest-{group_id}] DRY RUN — would POST {len(jobs):,} jobs. Skipping.")
        return

    total_staged = 0
    for i in range(0, len(jobs), BATCH_SIZE):
        batch = jobs[i : i + BATCH_SIZE]
        result = post_batch(base_url, secret, group_id, group["label"], batch)
        staged = result.get("stagedCount", 0)
        total_staged += staged
        print(f"[openjobdata-ingest-{group_id}] Batch {i // BATCH_SIZE + 1}: "
              f"raw={result.get('rawCount')} staged={staged} "
              f"dupes(in-batch={result.get('inBatchDuplicates')}, "
              f"cross={result.get('crossRunOrExistingDuplicates')}) runId={result.get('runId')}")
        if i + BATCH_SIZE < len(jobs):
            time.sleep(1)  # small pause between batches

    print(f"[openjobdata-ingest-{group_id}] Done — {total_staged:,} jobs staged for review.")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ingest openjobdata.com postings into TalentOS's Job Agent staging pipeline.")
    p.add_argument("--role-group", required=True, help=f"One of {', '.join(ROLE_GROUPS)}, or 'all' for every group.")
    p.add_argument("--days", type=int, default=1, help="Number of trailing daily delta files to scan (default: 1, i.e. yesterday's file — the nightly default).")
    p.add_argument("--end-date", default=None, help="Last day of the scan window (YYYY-MM-DD, UTC). Defaults to yesterday.")
    p.add_argument("--dry-run", action="store_true", help="Scan and print counts but don't POST to TalentOS.")
    p.add_argument("--base-url", default=os.environ.get("TALENTOS_INGEST_URL"), help="TalentOS base URL. Defaults to $TALENTOS_INGEST_URL.")
    p.add_argument("--secret", default=os.environ.get("CRON_SECRET"), help="Bearer secret. Defaults to $CRON_SECRET.")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if args.role_group != "all" and args.role_group not in ROLE_GROUPS:
        print(f"Unknown role group '{args.role_group}'. Valid: {', '.join(ROLE_GROUPS)}, or 'all'.", file=sys.stderr)
        return 1

    if not args.dry_run:
        if not args.base_url:
            print("TALENTOS_INGEST_URL is required (or pass --base-url) unless --dry-run.", file=sys.stderr)
            return 1
        if not args.secret:
            print("CRON_SECRET is required (or pass --secret) unless --dry-run.", file=sys.stderr)
            return 1

    groups = list(ROLE_GROUPS) if args.role_group == "all" else [args.role_group]
    for group_id in groups:
        run_for_group(group_id, args.days, args.end_date, args.base_url or "", args.secret or "", args.dry_run)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
