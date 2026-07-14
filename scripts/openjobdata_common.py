"""
scripts/openjobdata_common.py

Shared core for pulling keyword-filtered job postings from the openjobdata.com
public dataset (hosted as a Hugging Face Storage Bucket at
hf://buckets/Invicto69/Jobs-Dataset-bucket, MIT licensed, no auth required).

This module exists so every keyword-search tool built on top of this dataset
(scripts/openjobdata_export.py for OSP, scripts/EEE_job_search.py for FPGA/
power-electronics, and any future one) shares the SAME hardened matching
logic instead of copy-pasting it. Two real bugs were found and fixed here
during development, and re-copying this code without them would silently
reintroduce both:

1. Word-boundary matching is required, not optional. A bare short keyword
   like "osp" matched as a substring inside unrelated words ("hoSPital",
   "hoSPitality"), pulling in dozens of irrelevant hotel-industry postings.
2. Some `entire_json` payloads mislabel a base64-encoded binary attachment
   (a logo, a PDF) under a text-like key such as "content". An 827K-char
   blob with near-zero whitespace once false-matched a keyword purely
   because a stray '+' in the base64 alphabet created a regex word boundary
   next to a coincidental 3-letter run. `looks_like_binary_blob()` guards
   against this by whitespace density, not by trusting the field name.

The Hugging Face Bucket is NOT plain-HTTPS-fetchable (confirmed: /resolve/
URLs 404, the web file-tree doesn't render nested paths). It only works
through the `huggingface_hub` Python client's HfFileSystem (hf:// scheme,
fsspec-compatible) — which is why this is Python, not a TypeScript module
in the Next.js app.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from huggingface_hub import HfFileSystem

BUCKET_PREFIX = "buckets/Invicto69/Jobs-Dataset-bucket"


def resolve_date(date_arg: str | None) -> str:
    """Returns date_arg as-is, or yesterday (UTC) if not given."""
    if date_arg:
        return date_arg
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    return yesterday.strftime("%Y-%m-%d")


def date_window(end_date_str: str, days: int) -> list[str]:
    """Returns `days` consecutive date strings ending on end_date_str, oldest first."""
    end_date = datetime.strptime(end_date_str, "%Y-%m-%d")
    return [(end_date - timedelta(days=offset)).strftime("%Y-%m-%d") for offset in range(days - 1, -1, -1)]


def looks_like_binary_blob(text: str) -> bool:
    """See module docstring, bug #2. Real job description prose has meaningful
    whitespace density; base64/binary blobs mislabeled as text don't."""
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
    """See module docstring, bug #1. \\b anchors are essential, not cosmetic."""
    escaped = [re.escape(k.strip()) for k in keywords if k.strip()]
    return re.compile(r"\b(?:" + "|".join(escaped) + r")\b", re.IGNORECASE)


def matched_keywords(text: str, pattern: re.Pattern) -> list[str]:
    if not text:
        return []
    return sorted(set(m.group(0).lower() for m in pattern.finditer(text)))


# Title-level seniority signal. Deliberately conservative (word-boundary, same discipline
# as the keyword matcher) — this is a title-text heuristic, not a real years-of-experience
# field (the dataset doesn't have one), so it only catches postings that seniority-gate
# themselves explicitly in the title. A plain "FPGA Design Engineer" with no modifier is
# NOT flagged senior even though it could be filled at any level — that ambiguity is the
# point: those are the postings where a lower-experience candidate isn't visibly screened
# out by the title alone.
SENIOR_TITLE_PATTERN = re.compile(
    r"\b(senior|sr\.?|staff|principal|lead|distinguished|fellow|director|head of|chief|"
    r"iv|iii|level\s*(3|4|5)|l[3-5])\b",
    re.IGNORECASE,
)


def is_senior_title(title: str) -> bool:
    return bool(SENIOR_TITLE_PATTERN.search(str(title or "")))


def load_and_filter_one_day(
    fs: HfFileSystem,
    date_str: str,
    variant: str,
    pattern: re.Pattern,
    keywords_only_title: bool,
    log_prefix: str,
) -> pd.DataFrame:
    """Reads one day's delta file and returns just the keyword-matched rows for that day."""
    changes_path = f"{BUCKET_PREFIX}/data/{variant}/changes/{date_str}.parquet"
    if not fs.exists(changes_path):
        print(f"[{log_prefix}] No delta file found for {date_str} at {changes_path} — skipping.", file=sys.stderr)
        return pd.DataFrame()

    print(f"[{log_prefix}] Reading {changes_path} ...")
    with fs.open(changes_path, "rb") as f:
        jobs_df = pd.read_parquet(f)
    print(f"[{log_prefix}] {date_str}: loaded {len(jobs_df):,} job records.")

    if jobs_df.empty:
        return pd.DataFrame()

    # Only postings that appeared/updated as OPEN, not closures.
    if "status" in jobs_df.columns:
        jobs_df = jobs_df[jobs_df["status"] == "active"].copy()
        print(f"[{log_prefix}] {date_str}: {len(jobs_df):,} active postings after status filter.")

    title_dept_text = (
        jobs_df.get("title", "").fillna("") + " | " + jobs_df.get("department", "").fillna("")
    )

    if variant == "full" and not keywords_only_title:
        print(f"[{log_prefix}] {date_str}: extracting description text for full-recall keyword scan (slow part)...")
        description_text = jobs_df.apply(extract_description_text, axis=1)
        full_text = title_dept_text + " | " + description_text
    else:
        full_text = title_dept_text

    mask = full_text.str.contains(pattern, na=False)
    matches = jobs_df[mask].copy()
    matches["matched_keywords"] = full_text[mask].apply(lambda t: ", ".join(matched_keywords(t, pattern)))
    matches["delta_date"] = date_str
    print(f"[{log_prefix}] {date_str}: {len(matches):,} matched postings.")
    return matches


def join_company_metadata(fs: HfFileSystem, matches: pd.DataFrame, log_prefix: str) -> pd.DataFrame:
    companies_path = f"{BUCKET_PREFIX}/data/companies/companies.parquet"
    if not fs.exists(companies_path):
        return matches
    print(f"[{log_prefix}] Joining company metadata ...")
    with fs.open(companies_path, "rb") as f:
        companies_df = pd.read_parquet(f)
    companies_df = companies_df.rename(
        columns={"name": "company_name", "website": "company_website", "career_url": "company_career_url"}
    )
    return matches.merge(
        companies_df[["id", "company_name", "company_website", "company_career_url", "industry", "country"]]
        .rename(columns={"country": "company_country"}),
        left_on="company_id",
        right_on="id",
        how="left",
        suffixes=("", "_company"),
    )


DEFAULT_OUTPUT_COLUMNS = {
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


def write_xlsx(export_df: pd.DataFrame, output_path: Path, sheet_name: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        export_df.to_excel(writer, index=False, sheet_name=sheet_name)
        ws = writer.sheets[sheet_name]
        for col_idx, col_name in enumerate(export_df.columns, start=1):
            max_len = max(
                [len(str(col_name))] + [len(str(v)) for v in export_df.iloc[:, col_idx - 1].astype(str).head(500)]
            )
            ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = min(max_len + 2, 60)
        ws.freeze_panes = "A2"


def run_keyword_export(
    keywords: list[str],
    days: int = 1,
    end_date: str | None = None,
    variant: str = "full",
    keywords_only_title: bool = False,
    output_path: Path | None = None,
    output_stub: str = "jobs",
    sheet_name: str = "Jobs",
    log_prefix: str = "openjobdata",
    extra_output_columns: dict[str, str] | None = None,
    drop_senior_titles: bool = False,
    countries: list[str] | None = None,
) -> pd.DataFrame | None:
    """Runs a full keyword-filtered pull across `days` trailing daily deltas and writes
    an .xlsx. Returns the exported DataFrame (empty-safe: None if nothing matched).
    This is the single entry point every CLI tool in this family should call."""
    if days < 1:
        raise ValueError("days must be >= 1")

    end_date_str = resolve_date(end_date)
    date_strs = date_window(end_date_str, days)
    pattern = build_keyword_pattern(keywords)

    print(f"[{log_prefix}] window={date_strs[0]}..{date_strs[-1]} ({len(date_strs)} day(s)) "
          f"variant={variant} keywords={len(keywords)}")

    fs = HfFileSystem()

    per_day_matches = [
        load_and_filter_one_day(fs, d, variant, pattern, keywords_only_title, log_prefix) for d in date_strs
    ]
    non_empty = [m for m in per_day_matches if not m.empty]
    matches = pd.concat(non_empty, ignore_index=True) if non_empty else pd.DataFrame()

    if matches.empty:
        print(f"[{log_prefix}] No postings matched across the window. Nothing to export.")
        return None

    # A job can appear in more than one day's delta (e.g. updated after posting). Keep the
    # most recent delta row per job id so the export doesn't duplicate the same posting.
    if "id" in matches.columns:
        before = len(matches)
        matches = matches.sort_values("delta_date").drop_duplicates(subset="id", keep="last")
        if len(matches) != before:
            print(f"[{log_prefix}] Deduplicated {before - len(matches):,} repeat postings across days "
                  f"(same job updated on multiple days) -> {len(matches):,} unique postings.")

    print(f"[{log_prefix}] {len(matches):,} total unique matched postings across the window.")

    if drop_senior_titles and "title" in matches.columns:
        before = len(matches)
        matches = matches[~matches["title"].apply(is_senior_title)].copy()
        print(f"[{log_prefix}] Dropped {before - len(matches):,} postings with a Senior/Staff/Principal/"
              f"Lead/III/IV-style title -> {len(matches):,} remaining.")

    if countries and "country" in matches.columns:
        before = len(matches)
        wanted = {c.strip().lower() for c in countries}
        matches = matches[matches["country"].astype(str).str.strip().str.lower().isin(wanted)].copy()
        print(f"[{log_prefix}] Filtered to countries {countries} -> {len(matches):,} remaining "
              f"(from {before:,}).")

    if matches.empty:
        print(f"[{log_prefix}] Nothing left after seniority/country filtering. Nothing to export.")
        return None

    matches = join_company_metadata(fs, matches, log_prefix)

    output_columns = dict(DEFAULT_OUTPUT_COLUMNS)
    if extra_output_columns:
        output_columns.update(extra_output_columns)

    present_cols = [c for c in output_columns if c in matches.columns]
    export_df = matches[present_cols].rename(columns=output_columns)
    if "Posted At" in export_df.columns:
        export_df = export_df.sort_values("Posted At", ascending=False)
        # Excel has no tz-aware datetime type — Hugging Face's timestamps are UTC.
        export_df["Posted At"] = pd.to_datetime(export_df["Posted At"], utc=True).dt.tz_localize(None)

    if output_path is None:
        suffix = date_strs[-1] if len(date_strs) == 1 else f"{date_strs[0]}_to_{date_strs[-1]}"
        output_path = Path(__file__).resolve().parent.parent / "exports" / f"{output_stub}_{suffix}.xlsx"

    write_xlsx(export_df, output_path, sheet_name)
    print(f"[{log_prefix}] Wrote {len(export_df):,} rows to {output_path}")
    return export_df
