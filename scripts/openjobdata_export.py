#!/usr/bin/env python3
"""
scripts/openjobdata_export.py

Pulls one or more days' delta from the openjobdata.com public dataset and
exports jobs matching an OSP (Outside Plant / fiber optic / telecom
construction) keyword filter to an .xlsx workbook.

This is a thin CLI over scripts/openjobdata_common.py, which holds the
shared, hardened matching logic (word-boundary keyword matching, binary-blob
guard, dedup, company join, xlsx writer) reused by every keyword-search tool
built on this dataset — see that module's docstring for why those guards
exist. scripts/EEE_job_search.py is the sibling tool for FPGA/power-
electronics keyword sets; both share this same core rather than duplicating it.

Usage:
    python scripts/openjobdata_export.py
    python scripts/openjobdata_export.py --date 2026-07-13
    python scripts/openjobdata_export.py --date 2026-07-13 --days 7
    python scripts/openjobdata_export.py --keywords "OSP,fiber optic,splice"

No Hugging Face token is required — the bucket is public.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from openjobdata_common import run_keyword_export

# OSP = Outside Plant. This is the fiber-optic / telecom construction & engineering
# domain Skarion Engineering recruits for (see MASTERPROMPT_Talentos_v2.md). Keywords
# chosen to catch explicit OSP titles plus the adjacent skill/tool vocabulary that
# shows up in real OSP postings even when the title itself is generic ("Field
# Engineer", "Design Technician").
DEFAULT_OSP_KEYWORDS = [
    "osp",
    "outside plant",
    "fiber optic",
    "fibre optic",
    "fiber network",
    "ftth",
    "fttx",
    "splice",
    "splicing",
    "aerial construction",
    "underground utility",
    "underground construction",
    "pole attachment",
    "broadband construction",
    "telecom construction",
    "cable placement",
    "conduit placement",
    "vetro fibermap",
    "katapult",
    "fiber network design",
    "construction drawings fiber",
    "aerial fiber",
    "underground fiber",
    "outside plant engineer",
    "osp design",
    "osp engineer",
    "fiber technician",
    "cable locator",
    "utility locating",
    "fiber splicer",
    "fiber installer",
    "telecommunications construction",
    "gis fiber",
]
# Deliberately excluded despite sounding OSP-relevant: "make-ready"/"make ready" (heavy
# collision with apartment/property-maintenance postings), "central office" (generic
# corporate-speak collision — "central office in a prime location"), bare "vetro" (an
# ordinary Italian word). All confirmed as real false-positive sources in testing.


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Export OSP-relevant jobs from openjobdata.com's daily delta.")
    p.add_argument(
        "--date",
        default=None,
        help="Date (YYYY-MM-DD, UTC) of the delta file to pull. Defaults to yesterday (UTC). "
        "With --days > 1, this is treated as the LAST (most recent) day of the window.",
    )
    p.add_argument(
        "--days",
        type=int,
        default=1,
        help="Number of trailing daily delta files to pull and combine into one export (default: 1).",
    )
    p.add_argument(
        "--variant",
        choices=["full", "minimal"],
        default="full",
        help="Dataset variant. 'full' includes description text needed for real keyword recall (default). "
        "'minimal' only filters on title/department — faster, much lower recall.",
    )
    p.add_argument(
        "--keywords",
        default=None,
        help="Comma-separated keyword list to override the default OSP keyword set.",
    )
    p.add_argument(
        "--keywords-only-title",
        action="store_true",
        help="Match keywords against title/department only, even in 'full' variant (skip description scan; faster).",
    )
    p.add_argument(
        "--output",
        default=None,
        help="Output .xlsx path. Defaults to exports/osp_jobs_<date>.xlsx in the repo root.",
    )
    return p.parse_args()


def main() -> int:
    args = parse_args()
    keywords = (
        [k.strip() for k in args.keywords.split(",")] if args.keywords else DEFAULT_OSP_KEYWORDS
    )
    run_keyword_export(
        keywords=keywords,
        days=args.days,
        end_date=args.date,
        variant=args.variant,
        keywords_only_title=args.keywords_only_title,
        output_path=Path(args.output) if args.output else None,
        output_stub="osp_jobs",
        sheet_name="OSP Jobs",
        log_prefix="openjobdata-export",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
