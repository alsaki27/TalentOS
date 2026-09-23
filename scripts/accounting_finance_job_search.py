#!/usr/bin/env python3
"""
scripts/accounting_finance_job_search.py

Accounting & Finance entry/mid-entry keyword search over the openjobdata.com
dataset. Built for candidates with international accounting/finance
experience but no U.S. work history, targeting entry-to-mid-entry U.S. roles
(AP/billing -> accounting clerk/bookkeeping -> staff/junior accountant ->
accounting analyst -> financial analyst -> payroll), consistent with the
positioning brief: "entry to mid-entry rather than true beginner roles."

Same shared core as scripts/openjobdata_export.py and scripts/EEE_job_search.py
(see scripts/openjobdata_common.py's module docstring for why: word-boundary
keyword matching, binary-blob guard, the description_plain/description_html
extraction fix, years-of-experience text heuristic, location text-match
proxy). Read that docstring before trusting any output from this tool,
especially the years-required and location filters — neither is backed by a
real structured field in the dataset.

Usage:
    # All tracks, last 30 days, US-only, remote or local to Huntsville AL,
    # no more than 5 years experience stated, non-senior titles only:
    python scripts/accounting_finance_job_search.py --days 30

    # One track only:
    python scripts/accounting_finance_job_search.py --track ap_billing --days 30
    python scripts/accounting_finance_job_search.py --track staff_junior_accountant --days 30

    # Different metro / different experience cap:
    python scripts/accounting_finance_job_search.py --days 30 --local-to "Austin" --max-years 3

No Hugging Face token required — the bucket is public.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from openjobdata_common import run_keyword_export

# Track A: Accounts Payable / Billing / Receivable — the fastest, most commonly
# open-to-international-candidates entry point per the positioning brief.
DEFAULT_AP_BILLING_KEYWORDS = [
    "accounts payable specialist",
    "accounts payable clerk",
    "accounts payable associate",
    "accounts payable coordinator",
    "accounts payable analyst",
    "ap specialist",
    "ap clerk",
    "ap/ar specialist",
    "accounts receivable specialist",
    "accounts receivable clerk",
    "billing specialist",
    "billing coordinator",
    "billing analyst",
    "invoice processing specialist",
    "cash application specialist",
    "cash applications analyst",
    "collections specialist",
    "credit and collections specialist",
]

# Track B: Accounting Clerk / Bookkeeping — practical U.S. bookkeeping/invoice/
# reporting entry point.
DEFAULT_ACCOUNTING_CLERK_KEYWORDS = [
    "accounting clerk",
    "accounting assistant",
    "accounting associate",
    "accounting support specialist",
    "bookkeeper",
    "bookkeeping specialist",
    "entry level accountant",
    "entry level accounting",
    "entry level accounting clerk",
    "entry level bookkeeper",
]

# Track C: Staff / Junior Accountant — the "best target" band per the brief for
# someone with real reconciliation/GL/reporting exposure abroad.
DEFAULT_STAFF_JUNIOR_ACCOUNTANT_KEYWORDS = [
    "junior accountant",
    "staff accountant",
    "accountant i",
    "entry level staff accountant",
    "general ledger accountant",
    "reconciliation accountant",
    "general accountant",
    "corporate accountant",
    "fund accountant",
    "junior staff accountant",
]

# Track D: Accounting Analyst — for stronger Excel/reporting/data-analysis
# candidates over pure transaction processing.
DEFAULT_ACCOUNTING_ANALYST_KEYWORDS = [
    "accounting analyst",
    "financial reporting analyst",
    "general ledger analyst",
    "month end close analyst",
    "accounts analyst",
    "accounting operations analyst",
    "accounting operations specialist",
    "finance operations analyst",
]

# Track E: Financial Analyst — closer to planning/budgeting/FP&A/decision support.
DEFAULT_FINANCIAL_ANALYST_KEYWORDS = [
    "junior financial analyst",
    "financial analyst i",
    "entry level financial analyst",
    "financial analyst associate",
    "fp&a analyst",
    "budget analyst",
    "financial planning analyst",
    "treasury analyst",
]

# Track F: Payroll — finance-operations bridge role.
DEFAULT_PAYROLL_KEYWORDS = [
    "payroll specialist",
    "payroll clerk",
    "payroll coordinator",
    "payroll associate",
    "payroll analyst",
]

TRACKS = {
    "ap_billing": DEFAULT_AP_BILLING_KEYWORDS,
    "accounting_clerk": DEFAULT_ACCOUNTING_CLERK_KEYWORDS,
    "staff_junior_accountant": DEFAULT_STAFF_JUNIOR_ACCOUNTANT_KEYWORDS,
    "accounting_analyst": DEFAULT_ACCOUNTING_ANALYST_KEYWORDS,
    "financial_analyst": DEFAULT_FINANCIAL_ANALYST_KEYWORDS,
    "payroll": DEFAULT_PAYROLL_KEYWORDS,
}

ALL_DEFAULT_KEYWORDS = (
    DEFAULT_AP_BILLING_KEYWORDS
    + DEFAULT_ACCOUNTING_CLERK_KEYWORDS
    + DEFAULT_STAFF_JUNIOR_ACCOUNTANT_KEYWORDS
    + DEFAULT_ACCOUNTING_ANALYST_KEYWORDS
    + DEFAULT_FINANCIAL_ANALYST_KEYWORDS
    + DEFAULT_PAYROLL_KEYWORDS
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Accounting/Finance keyword search over the openjobdata.com daily deltas.")
    p.add_argument(
        "--track",
        choices=list(TRACKS.keys()) + ["all"],
        default="all",
        help="Which default keyword set to run. 'all' (default) combines every track.",
    )
    p.add_argument("--keywords", default=None, help="Comma-separated keyword list. Overrides --track.")
    p.add_argument("--keywords-file", default=None, help="Path to a text file, one keyword/phrase per line. Overrides --track/--keywords.")
    p.add_argument("--date", default=None, help="Last day of the export window (YYYY-MM-DD, UTC). Defaults to yesterday.")
    p.add_argument("--days", type=int, default=1, help="Number of trailing daily delta files to pull and combine (default: 1).")
    p.add_argument("--variant", choices=["full", "minimal"], default="full")
    p.add_argument("--keywords-only-title", action="store_true")
    p.add_argument("--output", default=None)
    p.add_argument(
        "--exclude-senior",
        action="store_true",
        default=True,
        help="Drop Senior/Staff(-titled-as-lead)/Principal/Lead/Director/III/IV-style titles. "
        "On by default for this tool, consistent with the entry/mid-entry brief. Use --no-exclude-senior to turn off.",
    )
    p.add_argument("--no-exclude-senior", dest="exclude_senior", action="store_false")
    p.add_argument(
        "--max-years",
        type=int,
        default=5,
        help="Drop postings whose description states more than this many years required (default: 5). "
        "Postings stating no number at all are kept, not dropped — see openjobdata_common.py docstring.",
    )
    p.add_argument(
        "--countries",
        default="United States",
        help="Comma-separated country filter (default: 'United States').",
    )
    p.add_argument(
        "--local-to",
        default="Huntsville,Redstone Arsenal",
        help="Comma-separated location substrings to match as 'local' (in addition to remote postings). "
        "Default targets Huntsville, AL. NOTE: this is a text-substring match against whatever free-text "
        "location string the ATS provided — the dataset has no zip/lat-long, so this is NOT a true geocoded "
        "radius. Only include place names you are confident sit within your real target radius; do not add "
        "a neighboring city name without verifying the actual distance yourself.",
    )
    p.add_argument(
        "--no-remote",
        action="store_true",
        help="Exclude remote postings — local-to matches only.",
    )
    return p.parse_args()


def resolve_keywords(args: argparse.Namespace) -> tuple[list[str], str]:
    if args.keywords_file:
        text = Path(args.keywords_file).read_text(encoding="utf-8")
        keywords = [line.strip() for line in text.splitlines() if line.strip() and not line.strip().startswith("#")]
        return keywords, "AccFin_jobs_custom"
    if args.keywords:
        return [k.strip() for k in args.keywords.split(",") if k.strip()], "AccFin_jobs_custom"
    if args.track == "all":
        return ALL_DEFAULT_KEYWORDS, "AccFin_jobs_all"
    return TRACKS[args.track], f"AccFin_jobs_{args.track}"


def main() -> int:
    args = parse_args()
    keywords, output_stub = resolve_keywords(args)
    if args.exclude_senior:
        output_stub += "_noSenior"

    countries = [c.strip() for c in args.countries.split(",")] if args.countries else None
    local_contains = [s.strip() for s in args.local_to.split(",") if s.strip()] if args.local_to else []
    location_filter = {"remote_ok": not args.no_remote, "local_contains": local_contains}

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
        max_years_experience=args.max_years,
        location_filter=location_filter,
        sheet_name="AccFin Jobs",
        log_prefix="accfin-job-search",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
