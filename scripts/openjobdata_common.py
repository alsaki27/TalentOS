"""
scripts/openjobdata_common.py

Shared core for pulling keyword-filtered job postings from the openjobdata.com
public dataset (hosted as a standard Hugging Face dataset repo at
hf://datasets/scholarweave/Jobs-Dataset-v2, Apache-2.0 licensed, no auth required).
Migrated 2026-10-11 from the earlier hf://buckets/Invicto69/Jobs-Dataset-bucket
storage-bucket product, which OpenJobData has retired in favor of this repo — same
project (the new repo's own README links back to openjobdata.com). Two things
changed, both confirmed by reading real live parquet files directly (the HF
datasets-server `/info` API's advertised schema for this repo is stale/wrong —
it still lists the old `id`/`status`/`job_model_json`/`entire_json` columns, which
do not actually exist in the current files; never trust it over a real file read):

1. File layout: daily deltas are now a glob of date+run-partitioned shards
   (`data/changes/{variant}/date=YYYY-MM-DD/run_id=.../part-*.parquet`) instead of
   one flat `{date}.parquet` file, and the company lookup is a date-partitioned
   snapshot (`data/companies/snapshot_date=YYYY-MM-DD/part-*.parquet`) instead of a
   single static file. See `load_and_filter_one_day()` and `join_company_metadata()`.

2. Columns were renamed/restructured: `id` → `posting_id` (now a durable compound
   string, e.g. `"ultipro:.../recruiting2.ultipro.com/..."`, not the old bucket's
   `{unique_id}/{job_id}` shape); the raw-JSON columns `job_model_json`/`entire_json`
   are now `normalized_payload`/`source_payload` (same nested keys inside, verified —
   `description_plain`/`description_html`/`location` all still present, so bug #3
   below still applies, just under renamed outer columns); there is no `status`
   column any more — "active" vs "closed" is now a structural split between the
   `data/changes/` and `data/closed/` top-level folders instead of a column value
   within one folder (confirmed: every row read from `changes/` has
   `event_type` in `{"active_insert", "active_update"}` and a null `closed_at`;
   `closed/` rows have `event_type == "close"` and a populated `closed_at`) — so
   simply reading from `changes/` already gives active-only postings, no post-read
   status filter needed or possible any more.

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
3. `job_model_json`'s real description keys are `description_plain` and
   `description_html`, not the `description`/`content`/etc keys originally
   assumed. A 2,000-row sample of US active postings showed 1,821 rows
   carrying real description text under these two keys, and the extractor
   was silently returning "" for 1,572 of them (86%) — every keyword search
   in this repo before this fix was degraded to title/department-only
   matching for most postings, with no error or log line indicating it.
   `extract_description_text()` now checks both.

Also in this module: `extract_years_required()` and `extract_location_text()`,
used for the optional `max_years_experience` and `location_filter` params on
`run_keyword_export()`. Read their docstrings before trusting their output —
neither is backed by a structured dataset field. Years-required is a regex
grep over description text (absence of a stated number is NOT treated as
"under the cap" being violated — it's kept, not dropped). Location filtering
is a plain substring match against whatever free-text location string the
ATS happened to provide — the dataset has NO zip code or lat/long fields, so
there is no true geocoded radius calculation available here. If you need a
real N-mile-radius filter, you need to add real geocoding (a places API) on
top of this, not trust text-matching alone to be geographically precise.

This dataset is read through the `huggingface_hub` Python client's
HfFileSystem (hf:// scheme, fsspec-compatible), using glob() rather than a
single open() since each day's delta and each company snapshot can be split
across more than one parquet shard — which is why this is Python, not a
TypeScript module in the Next.js app.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from huggingface_hub import HfFileSystem

DATASET_PREFIX = "datasets/scholarweave/Jobs-Dataset-v2"


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


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", " ", html)


# Bug #3 (found while building the accounting/finance track): job_model_json's actual
# keys are description_plain / description_html, not description/description_text/
# descriptionText/content/raw_description as originally assumed. A 2,000-row sample of
# US active postings on 2026-07-13 showed 1,821 rows carrying real description text
# under these two keys, and the extractor was returning "" for 1,572 of them (86%) —
# silently degrading every prior keyword search in this repo to title/department-only
# matching for most postings, without any error or log line saying so. Fixed by checking
# these keys too, with description_html run through _strip_html() first.
DESCRIPTION_TEXT_KEYS = (
    "description",
    "description_text",
    "descriptionText",
    "description_plain",
    "content",
    "raw_description",
)
DESCRIPTION_HTML_KEYS = ("description_html",)


def _arrow_series_to_object_list(series: pd.Series) -> list:
    """Converts one Arrow-backed Series to a plain Python list via per-element access
    (chunk[i].as_py()), NOT pandas' normal bulk conversion (.values / .to_numpy() /
    .tolist() on an Arrow dtype / .apply(axis=1) / .iterrows() — all of these ask
    pyarrow to build or rebuild ONE buffer for the WHOLE column). Confirmed empirically
    against real v2 data, on this dataset's large normalized_payload/source_payload
    columns specifically:
      - bulk conversion can raise pyarrow.lib.ArrowException ("Unknown error:
        Wrapping ... failed") on specific real rows, aborting the whole batch, while
        per-element access to the exact same data never fails (tested 27k+ real rows,
        0 failures);
      - even once that's avoided, any LATER pandas-level operation that still touches
        the ORIGINAL Arrow-backed column (Series "+", boolean-mask filtering/.take()
        via jobs_df[mask], etc.) re-triggers the same class of failure, now as
        pyarrow.lib.ArrowMemoryError ("realloc"/"malloc ... failed") — a single
        contiguous buffer spanning a full day's rows (up to 218k, confirmed) can be
        1GB+ for this field.
    The fix used throughout this module is to convert these columns to plain Python
    objects ONCE, this way, as early as possible (see load_and_filter_one_day()) —
    after that, pandas treats them as an ordinary object-dtype column, and every
    further operation (filtering, slicing, concatenation) is cheap pointer-copying,
    never a pyarrow buffer rebuild."""
    pa_array = getattr(series.array, "_pa_array", None)
    if pa_array is None:
        # Not Arrow-backed (already plain object dtype, e.g. converted earlier) —
        # ordinary .tolist() never hits the bulk-conversion failure modes above.
        return series.tolist()
    values: list = []
    for chunk in pa_array.chunks:
        for i in range(len(chunk)):
            try:
                values.append(chunk[i].as_py())
            except Exception:
                values.append(None)
    return values


def _json_columns_to_rows(df: pd.DataFrame, columns: tuple[str, ...]) -> list[dict]:
    """Pulls the given columns out of a DataFrame as plain Python dicts, one per row —
    see _arrow_series_to_object_list() for why this avoids pandas' normal bulk
    conversion path."""
    columns_data: dict[str, list] = {
        col: (_arrow_series_to_object_list(df[col]) if col in df.columns else [None] * len(df))
        for col in columns
    }
    return [dict(zip(columns, vals)) for vals in zip(*(columns_data[c] for c in columns))]


def extract_description_text(row: pd.Series) -> str:
    """Pulls whatever description text is available from the full variant's JSON columns.
    normalized_payload is checked first (same clean description_plain/description_html
    keys the old job_model_json had, verified unchanged), falling back to the ATS-raw
    source_payload (same caveat as before: its key shape is ATS-specific and not fully
    covered by DESCRIPTION_TEXT_KEYS — pre-existing, best-effort fallback, same as when
    this was named entire_json)."""
    for col in ("normalized_payload", "source_payload"):
        raw = row.get(col)
        if raw is None:
            continue
        try:
            data = raw if isinstance(raw, dict) else json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        for key in DESCRIPTION_TEXT_KEYS:
            val = data.get(key)
            if isinstance(val, str) and val.strip() and not looks_like_binary_blob(val):
                return val
        for key in DESCRIPTION_HTML_KEYS:
            val = data.get(key)
            if isinstance(val, str) and val.strip():
                stripped = _strip_html(val)
                if stripped.strip() and not looks_like_binary_blob(stripped):
                    return stripped
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


# Years-of-experience heuristic. The dataset has NO structured years-required field —
# this greps the description text for common ways postings state one ("5+ years",
# "3-5 years", "minimum of 2 years", "at least 4 years experience") and returns the
# HIGHEST number found. A posting that states no number at all returns None and is
# NOT excluded by max_years_experience filtering — absence of a stated requirement is
# not evidence it needs more experience than the cap; many genuine entry-level postings
# simply don't state a number.
YEARS_EXPERIENCE_PATTERN = re.compile(
    r"(?:"
    r"(\d{1,2})\s*\+\s*years|"                                    # "5+ years"
    r"(\d{1,2})\s*(?:-|to)\s*(\d{1,2})\s*years|"                  # "3-5 years" / "3 to 5 years"
    r"(?:minimum\s+(?:of\s+)?|at\s+least\s+)(\d{1,2})\s*years|"   # "minimum of 3 years" / "at least 4 years"
    r"(\d{1,2})\s*years?\s*(?:of\s+)?(?:relevant\s+|related\s+|professional\s+|prior\s+)?experience"
    r")",
    re.IGNORECASE,
)


def extract_years_required(text: str) -> int | None:
    if not text:
        return None
    found: list[int] = []
    for m in YEARS_EXPERIENCE_PATTERN.finditer(text):
        for g in m.groups():
            if g:
                try:
                    found.append(int(g))
                except ValueError:
                    pass
    return max(found) if found else None


def extract_location_text(row: pd.Series) -> str:
    """Concatenates every location-ish string found across normalized_payload /
    source_payload (formerly job_model_json / entire_json — see module docstring),
    across the different ATS schema shapes seen in this dataset (normalized_payload's
    location is a dict with city/state/raw_location_text, verified unchanged; some raw
    source_payload payloads instead carry a plain 'City, ST' string under 'location', or a
    business-unit descriptor under jobRequisitionLocation.descriptor). Used for substring
    matching against a target metro area — the dataset has no zip/lat-long, so this is a
    text-match proxy, not a geocoded radius calculation. See module docstring for the
    caveat this implies."""
    parts: list[str] = []
    for col in ("normalized_payload", "source_payload"):
        raw = row.get(col)
        if raw is None:
            continue
        try:
            data = raw if isinstance(raw, dict) else json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        loc = data.get("location")
        if isinstance(loc, str):
            parts.append(loc)
        elif isinstance(loc, dict):
            for key in ("raw_location_text", "city", "state", "postal_code"):
                val = loc.get(key)
                if isinstance(val, str):
                    parts.append(val)
        req_loc = data.get("jobRequisitionLocation")
        if isinstance(req_loc, dict):
            descriptor = req_loc.get("descriptor")
            if isinstance(descriptor, str):
                parts.append(descriptor)
    return " | ".join(p for p in parts if p)


def load_and_filter_one_day(
    fs: HfFileSystem,
    date_str: str,
    variant: str,
    pattern: re.Pattern,
    keywords_only_title: bool,
    log_prefix: str,
) -> pd.DataFrame:
    """Reads one day's delta shard(s) and returns just the keyword-matched rows for that day.
    A day's delta is a glob of one or more parquet shards under a date+run partition
    (data/changes/{variant}/date=YYYY-MM-DD/run_id=.../part-*.parquet), not a single file —
    see module docstring for why this changed from the old bucket layout."""
    changes_glob = f"{DATASET_PREFIX}/data/changes/{variant}/date={date_str}/**/*.parquet"
    shard_paths = sorted(fs.glob(changes_glob))
    if not shard_paths:
        print(f"[{log_prefix}] No delta shards found for {date_str} at {changes_glob} — skipping.", file=sys.stderr)
        return pd.DataFrame()

    # Filtered shard-by-shard, not loaded-then-concatenated-then-filtered: a day can be
    # 8+ shards (confirmed live, ~130MB raw parquet each), and only a small fraction of
    # rows ever match a keyword search. Keeping all shards' full data (including the
    # large normalized_payload/source_payload JSON columns on the full variant) resident
    # at once peaks at the WHOLE day's memory footprint for no benefit — confirmed to
    # exhaust memory on a constrained machine. Filtering each shard immediately and
    # discarding its unfiltered DataFrame before reading the next one bounds peak memory
    # to roughly one shard's data plus the (much smaller) accumulated matches.
    print(f"[{log_prefix}] Reading {len(shard_paths)} shard(s) for {date_str} ...")
    matched_frames: list[pd.DataFrame] = []
    total_rows = 0
    for shard_path in shard_paths:
        with fs.open(shard_path, "rb") as f:
            shard_df = pd.read_parquet(f)
        total_rows += len(shard_df)
        if shard_df.empty:
            continue

        # No post-read status filter any more: data/changes/ only ever contains
        # active_insert/active_update rows (closures live in the separate data/closed/
        # folder, see module docstring) — this folder is already active-only by
        # construction, unlike the old bucket's single changes file that mixed both.

        # Convert the large raw-JSON columns (full variant only) to plain object dtype
        # immediately — see _arrow_series_to_object_list() for why: every later
        # operation on an Arrow-backed version of these two columns (boolean-mask
        # filtering, "+", slicing) asks pyarrow to rebuild a large contiguous buffer,
        # which can fail outright on a memory-constrained runner. Once these are plain
        # Python objects, pandas treats them like any other object column and
        # everything downstream (here and in _scan_and_filter()) is cheap.
        for col in ("normalized_payload", "source_payload"):
            if col in shard_df.columns:
                shard_df[col] = pd.Series(_arrow_series_to_object_list(shard_df[col]), index=shard_df.index, dtype="object")

        title_dept_text = (
            shard_df.get("title", "").fillna("") + " | " + shard_df.get("department", "").fillna("")
        )

        if variant == "full" and not keywords_only_title:
            # _json_columns_to_rows(), not .apply(axis=1)/.iterrows() — both of those
            # call DataFrame.values on the whole frame internally, which can crash on
            # this dataset's normalized_payload/source_payload columns (see its
            # docstring).
            json_rows = _json_columns_to_rows(shard_df, ("normalized_payload", "source_payload"))
            # Plain Python string concatenation (f-string over .tolist()), not pandas'
            # Series "+" operator: title_dept_text is Arrow-backed, and "+"-ing it
            # against anything forces pandas to box the other side into an Arrow
            # large_string buffer too — confirmed to fail with a pyarrow realloc error
            # on a memory-constrained machine even when the description side alone was
            # already plain dtype="object". Building full_text this way never asks
            # pyarrow for one giant buffer at all.
            title_dept_list = title_dept_text.tolist()
            full_text = pd.Series(
                [f"{td} | {extract_description_text(r)}" for td, r in zip(title_dept_list, json_rows)],
                index=shard_df.index,
                dtype="object",
            )
        else:
            full_text = title_dept_text

        mask = full_text.str.contains(pattern, na=False)
        shard_matches = shard_df[mask].copy()
        if not shard_matches.empty:
            shard_matches["matched_keywords"] = full_text[mask].apply(lambda t: ", ".join(matched_keywords(t, pattern)))
            matched_frames.append(shard_matches)
        del shard_df, full_text, mask

    print(f"[{log_prefix}] {date_str}: loaded {total_rows:,} job records.")
    if not matched_frames:
        return pd.DataFrame()

    matches = pd.concat(matched_frames, ignore_index=True)
    matches["delta_date"] = date_str
    print(f"[{log_prefix}] {date_str}: {len(matches):,} matched postings.")
    return matches


def join_company_metadata(fs: HfFileSystem, matches: pd.DataFrame, log_prefix: str) -> pd.DataFrame:
    """Companies are published as dated snapshots (data/companies/snapshot_date=YYYY-MM-DD/
    part-*.parquet), not a single static file — reads whichever snapshot is most recent,
    found dynamically (ISO date strings sort correctly), not hardcoded."""
    snapshot_dirs = sorted(fs.glob(f"{DATASET_PREFIX}/data/companies/snapshot_date=*"))
    if not snapshot_dirs:
        print(f"[{log_prefix}] No company snapshot found — skipping company join.", file=sys.stderr)
        return matches
    latest_snapshot_dir = snapshot_dirs[-1]
    company_paths = sorted(fs.glob(f"{latest_snapshot_dir}/part-*.parquet"))
    if not company_paths:
        print(f"[{log_prefix}] Company snapshot {latest_snapshot_dir} has no part files — skipping company join.", file=sys.stderr)
        return matches

    print(f"[{log_prefix}] Joining company metadata from {latest_snapshot_dir} ({len(company_paths)} shard(s)) ...")
    frames = []
    for company_path in company_paths:
        with fs.open(company_path, "rb") as f:
            frames.append(pd.read_parquet(f))
    companies_df = pd.concat(frames, ignore_index=True)
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
    "location_text": "Location (raw)",
    "years_required": "Years Required (extracted)",
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


def _scan_and_filter(
    keywords: list[str],
    days: int,
    end_date: str | None,
    variant: str,
    keywords_only_title: bool,
    log_prefix: str,
    drop_senior_titles: bool,
    countries: list[str] | None,
    max_years_experience: int | None,
    location_filter: dict | None,
) -> tuple[pd.DataFrame | None, list[str]]:
    """Shared core: scans `days` trailing daily deltas, keyword-matches, dedupes
    same-job-multiple-days, applies the optional seniority/country/years/location
    filters, and joins company metadata. Returns (matches_df_or_None, date_strs) —
    every keyword-search/ingest tool in this family should call this rather than
    re-implementing the scan+filter steps, per this module's docstring."""
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
        print(f"[{log_prefix}] No postings matched across the window.")
        return None, date_strs

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

    if max_years_experience is not None or location_filter is not None:
        # Recomputed on the (small) already-keyword-matched set, not the full day's data —
        # cheap here even though extract_description_text is the "slow part" earlier.
        # _json_columns_to_rows(), not .apply(axis=1)/.iterrows() — see its docstring.
        json_rows = _json_columns_to_rows(matches, ("normalized_payload", "source_payload"))
        # dtype="object" and plain Python concatenation, not Series "+" — see
        # load_and_filter_one_day() for why mixing an Arrow-backed Series with an
        # object-dtype one via "+" forces the same kind of large buffer allocation.
        description_list = [extract_description_text(r) for r in json_rows]
        matches["description_text_extracted"] = pd.Series(description_list, index=matches.index, dtype="object")
        title_list = matches["title"].fillna("").tolist()
        matches["years_required"] = pd.Series(
            [extract_years_required(f"{t} | {d}") for t, d in zip(title_list, description_list)],
            index=matches.index,
        )
        matches["location_text"] = pd.Series(
            [extract_location_text(r) for r in json_rows], index=matches.index, dtype="object"
        )

    if max_years_experience is not None:
        before = len(matches)
        # Keep rows with no stated requirement (None) — absence isn't evidence of a high bar.
        matches = matches[
            matches["years_required"].isna() | (matches["years_required"] <= max_years_experience)
        ].copy()
        print(f"[{log_prefix}] Dropped {before - len(matches):,} postings stating more than "
              f"{max_years_experience} years required -> {len(matches):,} remaining.")

    if location_filter is not None:
        before = len(matches)
        remote_ok = location_filter.get("remote_ok", True)
        local_contains = [s.lower() for s in location_filter.get("local_contains", [])]

        def keep_row(row) -> bool:
            if remote_ok:
                wt = str(row.get("workplace_type", "")).strip().lower()
                if wt == "remote" or bool(row.get("is_remote")):
                    return True
            if local_contains:
                loc = str(row.get("location_text", "")).lower()
                if any(s in loc for s in local_contains):
                    return True
            return False

        matches = matches[matches.apply(keep_row, axis=1)].copy()
        print(f"[{log_prefix}] Filtered to remote_ok={remote_ok} or location contains "
              f"{location_filter.get('local_contains')} -> {len(matches):,} remaining (from {before:,}). "
              f"NOTE: this is a text-substring proxy on whatever location string the ATS provided, not a "
              f"geocoded radius calculation — the dataset has no zip/lat-long. See openjobdata_common.py "
              f"module docstring.")

    if matches.empty:
        print(f"[{log_prefix}] Nothing left after filtering.")
        return None, date_strs

    matches = join_company_metadata(fs, matches, log_prefix)
    return matches, date_strs


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
    max_years_experience: int | None = None,
    location_filter: dict | None = None,
) -> pd.DataFrame | None:
    """Runs a full keyword-filtered pull across `days` trailing daily deltas and writes
    an .xlsx. Returns the exported DataFrame (empty-safe: None if nothing matched).
    This is the entry point CLI/spreadsheet tools in this family should call — for
    pushing results straight into TalentOS instead, use run_keyword_ingest()."""
    matches, date_strs = _scan_and_filter(
        keywords, days, end_date, variant, keywords_only_title, log_prefix,
        drop_senior_titles, countries, max_years_experience, location_filter,
    )
    if matches is None:
        print(f"[{log_prefix}] Nothing to export.")
        return None

    output_columns = dict(DEFAULT_OUTPUT_COLUMNS)
    if extra_output_columns:
        output_columns.update(extra_output_columns)

    present_cols = [c for c in output_columns if c in matches.columns]
    export_df = matches[present_cols].rename(columns=output_columns)
    if "Posted At" in export_df.columns:
        # format="ISO8601", not pandas' default single-format auto-inference: this
        # dataset's posted_at strings aren't all the same length (some carry
        # milliseconds, e.g. "2026-10-09T22:15:26.069+00:00", some don't), which
        # breaks the strict format pandas infers from a sample. ISO8601 parsing
        # handles the optional fractional seconds natively. Parsed before sorting
        # (not after, as before) so "Posted At" sorts by actual instant, not by
        # lexicographic string order, which the mixed lengths would also throw off.
        # Excel has no tz-aware datetime type — Hugging Face's timestamps are UTC.
        export_df["Posted At"] = pd.to_datetime(export_df["Posted At"], utc=True, format="ISO8601").dt.tz_localize(None)
        export_df = export_df.sort_values("Posted At", ascending=False)

    if output_path is None:
        suffix = date_strs[-1] if len(date_strs) == 1 else f"{date_strs[0]}_to_{date_strs[-1]}"
        output_path = Path(__file__).resolve().parent.parent / "exports" / f"{output_stub}_{suffix}.xlsx"

    write_xlsx(export_df, output_path, sheet_name)
    print(f"[{log_prefix}] Wrote {len(export_df):,} rows to {output_path}")
    return export_df


# Maps a matched row to the exact JSON contract POST /api/job-agent/openjobdata-ingest
# expects per job. Keep in sync with that route's per-job field list — every field here
# has a home in the jobs table (see sql/01_schema.sql) or job_agent_staged_jobs, so
# nothing openjobdata provides gets silently dropped on the way into TalentOS.
def _row_to_ingest_job(row: pd.Series, json_row: dict) -> dict:
    description_text = extract_description_text(json_row)
    location_text = extract_location_text(json_row)
    workplace_type = str(row.get("workplace_type", "") or "").strip().lower()
    is_remote = bool(row.get("is_remote")) or workplace_type == "remote"

    posted_at = row.get("posted_at")
    posted_at_str = None
    if posted_at is not None and not pd.isna(posted_at):
        try:
            posted_at_str = pd.to_datetime(posted_at, utc=True).strftime("%Y-%m-%d")
        except (TypeError, ValueError):
            posted_at_str = None

    return {
        "title": row.get("title") or None,
        "company": row.get("company_name") or None,
        "company_website": row.get("company_website") or None,
        "industry": row.get("industry") or None,
        "location": location_text or None,
        "country": row.get("country") or None,
        "employment_type": row.get("employment_type") or None,
        "is_remote": is_remote,
        "posted_at": posted_at_str,
        "apply_url": row.get("apply_url") or None,
        "external_job_id": str(row.get("posting_id") or row.get("job_id") or "") or None,
        "description_text": description_text or None,
    }


def run_keyword_ingest(
    keywords: list[str],
    days: int = 1,
    end_date: str | None = None,
    variant: str = "full",
    keywords_only_title: bool = False,
    log_prefix: str = "openjobdata-ingest",
    drop_senior_titles: bool = False,
    countries: list[str] | None = None,
    max_years_experience: int | None = None,
    location_filter: dict | None = None,
) -> list[dict]:
    """Same scan+filter pipeline as run_keyword_export, but returns a list of plain
    dicts matching POST /api/job-agent/openjobdata-ingest's per-job contract instead
    of writing an .xlsx — the entry point for scripts/openjobdata_ingest.py to push
    results straight into TalentOS's job_agent staging pipeline."""
    matches, _ = _scan_and_filter(
        keywords, days, end_date, variant, keywords_only_title, log_prefix,
        drop_senior_titles, countries, max_years_experience, location_filter,
    )
    if matches is None:
        return []

    # The two JSON columns are dropped before iterrows() and supplied separately via
    # _json_columns_to_rows() — see that helper's docstring for why (bulk-converting
    # them through iterrows()/.values() can crash on specific real rows).
    json_rows = _json_columns_to_rows(matches, ("normalized_payload", "source_payload"))
    safe_matches = matches.drop(columns=["normalized_payload", "source_payload"], errors="ignore")
    jobs = [
        _row_to_ingest_job(row, json_row)
        for (_, row), json_row in zip(safe_matches.iterrows(), json_rows)
    ]
    jobs = [j for j in jobs if j["title"]]
    print(f"[{log_prefix}] Built {len(jobs):,} normalized job rows for ingest.")
    return jobs
