#!/usr/bin/env python3
"""
scripts/EEE_job_search.py

EEE = Electrical & Electronics Engineering. General-purpose keyword-search
tool over the openjobdata.com dataset for EEE-track candidates — built
first for two entry-level positioning routes:

  1. Solar / power-electronics PCB & hardware design
  2. FPGA / Verilog / VHDL / VLSI / digital systems design

Unlike scripts/openjobdata_export.py (which is hardcoded to the OSP/fiber
keyword set), this tool is meant to be reused by the team for other EEE
keyword sets going forward — pass any keyword list via --keywords or
--keywords-file, or edit the two DEFAULT_*_KEYWORDS lists below and add a
new track.

Both tools share the same hardened core in scripts/openjobdata_common.py
(word-boundary matching, binary-blob guard, dedup, company join, xlsx
writer) — see that module's docstring for the two real bugs that guard
protects against. Do not re-implement keyword matching independently in a
new script; import from openjobdata_common instead.

Usage:
    # Both default tracks combined, last 10 days:
    python scripts/EEE_job_search.py --days 10

    # One track only:
    python scripts/EEE_job_search.py --track solar_pcb --days 10
    python scripts/EEE_job_search.py --track fpga_vlsi --days 10

    # Custom keyword list:
    python scripts/EEE_job_search.py --keywords "FPGA design engineer,RTL design engineer" --days 10

No Hugging Face token is required — the bucket is public.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from openjobdata_common import run_keyword_export

# Track A: Solar / power-electronics PCB & hardware design (entry level).
# Multi-word technical phrases only, mirroring the lesson learned building the
# OSP tool — bare short/generic terms (e.g. a standalone "PCB" or "BMS")
# collide too often with unrelated industries once run through a word-boundary
# match across 2M+ postings.
DEFAULT_SOLAR_PCB_KEYWORDS = [
    "pcb design engineer",
    "power electronics engineer",
    "power electronics design engineer",
    "solar inverter design",
    "pv inverter engineer",
    "analog circuit design",
    "circuit design engineer",
    "mppt controller",
    "charge controller design",
    "dc-dc converter design",
    "dc dc converter design",
    "switch mode power supply",
    "smps design",
    "power supply design engineer",
    "solar electronics engineer",
    "pcb layout engineer",
    "electrical hardware engineer",
    "power converter design",
    "gate driver design",
    "battery management system",
    "bms design engineer",
    "inverter firmware engineer",
    "junior hardware engineer",
    "entry level pcb designer",
    "renewable energy hardware engineer",
    "power electronics associate",
]

# Track B: FPGA / Verilog / VHDL / VLSI / digital systems design (entry level).
DEFAULT_FPGA_VLSI_KEYWORDS = [
    "fpga design engineer",
    "associate fpga engineer",
    "rtl design engineer",
    "verilog design engineer",
    "vhdl design engineer",
    "digital design engineer",
    "asic design engineer",
    "vlsi design engineer",
    "digital ic design engineer",
    "hardware verification engineer",
    "fpga verification engineer",
    "embedded systems engineer",
    "digital logic design engineer",
    "soc design engineer",
    "fpga hardware engineer",
    "rtl verification engineer",
    "physical design engineer",
    "analog layout engineer",
    "ic design engineer",
    "digital asic engineer",
    "computer architecture engineer",
    "junior vlsi engineer",
    "fpga prototyping engineer",
    "signal processing engineer",
    "xilinx vivado design engineer",
]

TRACKS = {
    "solar_pcb": DEFAULT_SOLAR_PCB_KEYWORDS,
    "fpga_vlsi": DEFAULT_FPGA_VLSI_KEYWORDS,
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="EEE keyword search over the openjobdata.com daily deltas.")
    p.add_argument(
        "--track",
        choices=list(TRACKS.keys()) + ["both"],
        default="both",
        help="Which default keyword set to run. 'both' (default) combines solar_pcb + fpga_vlsi into one export.",
    )
    p.add_argument(
        "--keywords",
        default=None,
        help="Comma-separated keyword list. Overrides --track entirely if given.",
    )
    p.add_argument(
        "--keywords-file",
        default=None,
        help="Path to a text file with one keyword/phrase per line. Overrides --track if given "
        "(and takes precedence over --keywords if both are given).",
    )
    p.add_argument(
        "--date",
        default=None,
        help="Last day of the export window (YYYY-MM-DD, UTC). Defaults to yesterday.",
    )
    p.add_argument(
        "--days",
        type=int,
        default=1,
        help="Number of trailing daily delta files to pull and combine (default: 1).",
    )
    p.add_argument(
        "--variant",
        choices=["full", "minimal"],
        default="full",
        help="Dataset variant. 'full' (default) scans description text for real recall.",
    )
    p.add_argument(
        "--keywords-only-title",
        action="store_true",
        help="Match keywords against title/department only (skip description scan; faster, lower recall).",
    )
    p.add_argument(
        "--output",
        default=None,
        help="Output .xlsx path. Defaults to exports/EEE_jobs_<track>_<date-range>.xlsx.",
    )
    p.add_argument(
        "--exclude-senior",
        action="store_true",
        help="Drop postings whose title signals Senior/Staff/Principal/Lead/III/IV-level seniority "
        "(title-text heuristic — the dataset has no real years-of-experience field). A plain title "
        "with no seniority modifier is kept, since that ambiguity is exactly the target zone for a "
        "candidate whose experience doesn't cleanly match 'entry' or 'senior'.",
    )
    p.add_argument(
        "--countries",
        default=None,
        help="Comma-separated country filter (e.g. 'United States'). Matches the dataset's country field exactly.",
    )
    return p.parse_args()


def resolve_keywords(args: argparse.Namespace) -> tuple[list[str], str]:
    """Returns (keyword_list, output_stub)."""
    if args.keywords_file:
        text = Path(args.keywords_file).read_text(encoding="utf-8")
        keywords = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
        return keywords, "EEE_jobs_custom"

    if args.keywords:
        return [k.strip() for k in args.keywords.split(",") if k.strip()], "EEE_jobs_custom"

    if args.track == "both":
        return DEFAULT_SOLAR_PCB_KEYWORDS + DEFAULT_FPGA_VLSI_KEYWORDS, "EEE_jobs_both"

    return TRACKS[args.track], f"EEE_jobs_{args.track}"


def main() -> int:
    args = parse_args()
    keywords, output_stub = resolve_keywords(args)
    if args.exclude_senior:
        output_stub += "_noSenior"
    countries = [c.strip() for c in args.countries.split(",")] if args.countries else None

    run_keyword_export(
        keywords=keywords,
        days=args.days,
        end_date=args.date,
        variant=args.variant,
        keywords_only_title=args.keywords_only_title,
        output_path=Path(args.output) if args.output else None,
        output_stub=output_stub,
        drop_senior_titles=args.exclude_senior,
        countries=countries,
        sheet_name="EEE Jobs",
        log_prefix="EEE-job-search",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
