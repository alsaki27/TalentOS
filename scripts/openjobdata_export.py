#!/usr/bin/env python3
"""
scripts/openjobdata_export.py

Pulls one day's delta from the openjobdata.com public dataset (hosted as a Hugging
Face Storage Bucket at hf://buckets/Invicto69/Jobs-Dataset-bucket) and exports jobs
matching an OSP (Outside Plant / fiber optic / telecom construction) keyword filter
to an .xlsx workbook.

Why the `full` variant, not `minimal`: the minimal schema only has title/department/
employment_type/workplace_type/country — no description text. Real recall for a
domain filter like OSP needs to scan the job description, which only exists in the
full variant's `job_model_json` (normalized) / `entire_json` (raw scraper payload).
The full variant's daily delta is small (~100-150MB), well within reach of a plain
`pip install` + GitHub Actions run — no need to touch the 25GB base dataset.

The Hugging Face Bucket is NOT plain-HTTPS-fetchable (confirmed: /resolve/ URLs
404, the web file-tree doesn't render nested paths). It only works through the
`huggingface_hub` Python client's HfFileSystem (hf:// scheme, fsspec-compatible).
That's why this is a Python script rather than a TypeScript one in this Next.js repo.

Usage:
    python scripts/openjobdata_export.py
    python scripts/openjobdata_export.py --date 2026-07-13
    python scripts/openjobdata_export.py --date 2026-07-13 --variant minimal --keywords-only-title
    python scripts/openjobdata_export.py --keywords "OSP,fiber optic,splice"

No Hugging Face token is required — the bucket is public.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from huggingface_hub import HfFileSystem

BUCKET_PREFIX = "buckets/Invicto69/Jobs-Dataset-bucket"

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
        help="Number of trailing daily delta files to pull and combine into one export (default: 1, "
        "i.e. --date only). E.g. --days 7 pulls the 7 days ending on --date (or yesterday).",
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


def resolve_date(date_arg: str | None) -> str:
    if date_arg:
        return date_arg
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    return yesterday.strftime("%Y-%m-%d")


def looks_like_binary_blob(text: str) -> bool:
    """Some entire_json payloads mislabel a base64-encoded attachment (logo, PDF) under
    a text-like key (e.g. "content"). A 800K-char blob with near-zero whitespace matched
    our OSP keyword pattern once purely because a stray '+' in the base64 alphabet created
    a regex word boundary next to a coincidental 3-letter run — confirmed live in testing.
    Real job description prose has meaningful whitespace density; base64/binary doesn't."""
    if len(text) < 500:
        return False
    whitespace_ratio = text.count(" ") / len(text)
    return whitespace_ratio < 0.05


def extract_description_text(row: pd.Series) -> str:
    """Pulls whatever description text is available from the full variant's JSON columns."""
    for col in ("job_model_json", "entire_json"):
        raw = row.get(col)
        if raw is None:
            continue
        try:
            data = raw if isinstance(raw, dict) else json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        for key in ("description", "description_text", "descriptionText", "content", "raw_description"):
            val = data.get(key)
            if isinstance(val, str) and val.strip() and not looks_like_binary_blob(val):
                return val
    return ""


def build_keyword_pattern(keywords: list[str]) -> re.Pattern:
    # Word-boundary anchors are essential here, not cosmetic: bare "osp" without \b
    # matches as a substring inside unrelated words like "hoSPital"/"hoSPitality",
    # which pulled in dozens of hotel-industry postings ("myhotel.team") in testing.
    escaped = [re.escape(k.strip()) for k in keywords if k.strip()]
    return re.compile(r"\b(?:" + "|".join(escaped) + r")\b", re.IGNORECASE)


def matched_keywords(text: str, pattern: re.Pattern) -> list[str]:
    if not text:
        return []
    return sorted(set(m.group(0).lower() for m in pattern.finditer(text)))


def load_and_filter_one_day(fs: HfFileSystem, date_str: str, variant: str, pattern: re.Pattern, keywords_only_title: bool) -> pd.DataFrame:
    """Reads one day's delta file and returns just the OSP-relevant matched rows for that day."""
    changes_path = f"{BUCKET_PREFIX}/data/{variant}/changes/{date_str}.parquet"
    if not fs.exists(changes_path):
        print(f"[openjobdata-export] No delta file found for {date_str} at {changes_path} — skipping.", file=sys.stderr)
        return pd.DataFrame()

    print(f"[openjobdata-export] Reading {changes_path} ...")
    with fs.open(changes_path, "rb") as f:
        jobs_df = pd.read_parquet(f)
    print(f"[openjobdata-export] {date_str}: loaded {len(jobs_df):,} job records.")

    if jobs_df.empty:
        return pd.DataFrame()

    # Only postings that appeared/updated as OPEN, not closures — "jobs posted" means new
    # openings, and status filtering avoids exporting that day's closures as if new.
    if "status" in jobs_df.columns:
        jobs_df = jobs_df[jobs_df["status"] == "active"].copy()
        print(f"[openjobdata-export] {date_str}: {len(jobs_df):,} active postings after status filter.")

    title_dept_text = (
        jobs_df.get("title", "").fillna("") + " | " + jobs_df.get("department", "").fillna("")
    )

    if variant == "full" and not keywords_only_title:
        print(f"[openjobdata-export] {date_str}: extracting description text for full-recall keyword scan (slow part)...")
        description_text = jobs_df.apply(extract_description_text, axis=1)
        full_text = title_dept_text + " | " + description_text
    else:
        full_text = title_dept_text

    mask = full_text.str.contains(pattern, na=False)
    matches = jobs_df[mask].copy()
    matches["matched_keywords"] = full_text[mask].apply(lambda t: ", ".join(matched_keywords(t, pattern)))
    matches["delta_date"] = date_str
    print(f"[openjobdata-export] {date_str}: {len(matches):,} OSP-relevant postings matched.")
    return matches


def main() -> int:
    args = parse_args()
    if args.days < 1:
        print("[openjobdata-export] --days must be >= 1", file=sys.stderr)
        return 1

    end_date_str = resolve_date(args.date)
    end_date = datetime.strptime(end_date_str, "%Y-%m-%d")
    date_strs = [(end_date - timedelta(days=offset)).strftime("%Y-%m-%d") for offset in range(args.days - 1, -1, -1)]

    keywords = (
        [k.strip() for k in args.keywords.split(",")] if args.keywords else DEFAULT_OSP_KEYWORDS
    )
    pattern = build_keyword_pattern(keywords)

    print(f"[openjobdata-export] window={date_strs[0]}..{date_strs[-1]} ({len(date_strs)} day(s)) "
          f"variant={args.variant} keywords={len(keywords)}")

    fs = HfFileSystem()

    per_day_matches = [
        load_and_filter_one_day(fs, d, args.variant, pattern, args.keywords_only_title) for d in date_strs
    ]
    matches = pd.concat([m for m in per_day_matches if not m.empty], ignore_index=True) if any(not m.empty for m in per_day_matches) else pd.DataFrame()

    if matches.empty:
        print("[openjobdata-export] No OSP-relevant jobs matched across the window. Nothing to export.")
        return 0

    # A job can appear in more than one day's delta (e.g. updated after posting). Keep the
    # most recent delta row per job id so the export doesn't duplicate the same posting.
    if "id" in matches.columns:
        before = len(matches)
        matches = matches.sort_values("delta_date").drop_duplicates(subset="id", keep="last")
        if len(matches) != before:
            print(f"[openjobdata-export] Deduplicated {before - len(matches):,} repeat postings across days "
                  f"(same job updated on multiple days) -> {len(matches):,} unique postings.")

    print(f"[openjobdata-export] {len(matches):,} total unique OSP-relevant postings across the window.")

    # Join company names/domains for readability.
    companies_path = f"{BUCKET_PREFIX}/data/companies/companies.parquet"
    if fs.exists(companies_path):
        print("[openjobdata-export] Joining company metadata ...")
        with fs.open(companies_path, "rb") as f:
            companies_df = pd.read_parquet(f)
        companies_df = companies_df.rename(
            columns={"name": "company_name", "website": "company_website", "career_url": "company_career_url"}
        )
        matches = matches.merge(
            companies_df[["id", "company_name", "company_website", "company_career_url", "industry", "country"]]
            .rename(columns={"country": "company_country"}),
            left_on="company_id",
            right_on="id",
            how="left",
            suffixes=("", "_company"),
        )

    output_columns = {
        "title": "Title",
        "company_name": "Company",
        "company_website": "Company Website",
        "industry": "Industry",
        "department": "Department",
        "employment_type": "Employment Type",
        "workplace_type": "Workplace Type",
        "country": "Country",
        "is_remote": "Remote",
        "posted_at": "Posted At",
        "apply_url": "Apply URL",
        "matched_keywords": "Matched Keywords",
        "status": "Status",
        "delta_date": "Delta Date",
    }
    present_cols = [c for c in output_columns if c in matches.columns]
    export_df = matches[present_cols].rename(columns=output_columns)
    if "Posted At" in export_df.columns:
        export_df = export_df.sort_values("Posted At", ascending=False)
        # Excel has no tz-aware datetime type — Hugging Face's timestamps are UTC, so
        # convert to naive UTC rather than dropping the offset without normalizing it.
        export_df["Posted At"] = pd.to_datetime(export_df["Posted At"], utc=True).dt.tz_localize(None)

    if args.output:
        output_path = Path(args.output)
    else:
        suffix = date_strs[-1] if len(date_strs) == 1 else f"{date_strs[0]}_to_{date_strs[-1]}"
        output_path = Path(__file__).resolve().parent.parent / "exports" / f"osp_jobs_{suffix}.xlsx"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        export_df.to_excel(writer, index=False, sheet_name="OSP Jobs")
        ws = writer.sheets["OSP Jobs"]
        for col_idx, col_name in enumerate(export_df.columns, start=1):
            max_len = max(
                [len(str(col_name))] + [len(str(v)) for v in export_df.iloc[:, col_idx - 1].astype(str).head(500)]
            )
            ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max_len + 2, 60)
        ws.freeze_panes = "A2"

    print(f"[openjobdata-export] Wrote {len(export_df):,} rows to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
