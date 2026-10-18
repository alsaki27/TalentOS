# MASTERPROMPT — Pull OSP / CAD-Drafting / GIS jobs from OpenJobData

Paste this whole document into any AI that can execute Python (Claude, ChatGPT with code
interpreter, a local coding agent, etc.) with the instruction: **"Follow this masterprompt
end to end and give me the resulting Excel file."** Everything needed is self-contained
below — no accounts, no API keys, no repo access required.

---

## 1. The data source (verified real, public, live)

**OpenJobData** (https://openjobdata.com) is a public, standard Hugging Face **dataset
repo** (migrated 2026-10-11 from an earlier storage-bucket product at a different HF
account — if you see references elsewhere to `hf://buckets/Invicto69/...`, that's the
old location). No token or account needed.

```
Dataset: hf://datasets/scholarweave/Jobs-Dataset-v2

datasets/scholarweave/Jobs-Dataset-v2/
├── data/
│   ├── changes/minimal/date=YYYY-MM-DD/run_id=.../part-*.parquet   <- daily new/updated jobs, lightweight columns (one or more shards per day)
│   ├── changes/full/date=YYYY-MM-DD/run_id=.../part-*.parquet      <- same, plus raw JSON payload (heavier)
│   ├── closed/minimal|full/date=YYYY-MM-DD/...                     <- jobs detected closed that day (separate from changes/ — see below)
│   └── companies/snapshot_date=YYYY-MM-DD/part-*.parquet           <- company_id -> name/website/industry lookup, dated snapshots (use the latest)
```

**Jobs schema** (`minimal` variant — what this pull uses):
`posting_id` (durable compound id), `company_id` (FK → companies.id), `title`,
`department`, `employment_type`, `workplace_type`, `country`, `is_remote`, `posted_at`
(timezone-aware datetime, ISO8601 — note some values carry milliseconds and some don't,
so parse with `pd.to_datetime(..., format="ISO8601")`, not a fixed-format string),
`apply_url`, `first_seen_at`, `last_seen_at`, `closed_at`, `event_type` (`active_insert`/
`active_update` — always, in this `changes/` folder; there is no `status` column any more).
The `full` variant additionally has `job_id` and swaps `posting_id`'s absence for it as a
secondary id, plus the raw JSON columns (see below).

There is no `status` column, and no need for one: `data/changes/` only ever contains
still-open postings (`event_type` is always `active_insert`/`active_update` there);
closures live entirely in the separate `data/closed/` folder instead. Just reading from
`changes/` already gives you active-only jobs.

**Companies schema**: `id`, `name`, `website`, `ats`, `career_url`, `industry`, `size`,
`locality`, `region`, `country`, `linkedin_url`, and more.

Known gap: not every calendar date has a delta yet (today's, in particular, until the
day's ingest run has happened) — that's a real gap in the source, not a bug in the pull
script. Skip missing dates silently.

There is **no free-text job description** in the minimal schema — only title/company/location/
apply_url. If you need full descriptions, either use the `full` variant (has `normalized_payload`
with clean `description_plain`/`description_html` keys, and a raw `source_payload` fallback —
these were named `job_model_json`/`entire_json` before the 2026-10-11 migration, same inner
structure) or fetch each `apply_url` separately.

**A note on scale and memory, if you paste this into a code-execution AI**: a single day's
`full` variant can be 200K+ rows across multiple shards, and the raw JSON columns are large.
If you hit a `pyarrow`-related memory or crash error, convert `normalized_payload`/
`source_payload` to plain Python objects immediately after reading each shard (not via
`.apply()`/`.iterrows()`/bulk `.values` — read the underlying Arrow array element-by-element
instead), and filter/keep only matched rows before moving to the next shard, rather than
concatenating every shard first. `scripts/openjobdata_common.py` in the TalentOS repo has the
full, hardened version of this if you have repo access — prefer it over re-deriving this logic
from scratch.

---

## 2. The 69 keywords

Three groups, sourced from TalentOS's internal role library. These are **reference titles**
used to build the matcher below — do not match on them as literal exact phrases (see §3 for
why that fails).

### OSP / Fiber (31)
```
OSP Design Engineer, Outside Plant Engineer, OSP Engineer, Fiber Design Engineer,
FTTH Design Engineer, Fiber Optic Design Engineer, Telecom Design Engineer,
OSP Planning Engineer, OSP CAD Designer,
Fiber Network Engineer, Fiber Construction Engineer, Outside Plant Designer,
Telecommunications Engineer, Fiber Route Engineer, Aerial Fiber Design Engineer,
Underground Fiber Design Engineer, Joint Use Engineer, Make Ready Engineer,
Fiber Permitting Engineer, GIS Fiber Design Technician, OSP Project Engineer,
Fiber Design Technician, OSP Field Engineer, Fiber Construction Manager,
OSP Estimator, Telecom Infrastructure Engineer, Broadband Design Engineer,
FTTx Design Engineer, Fiber Network Planner, OSP QC Engineer,
Broadband Network Engineer, Fiber Engineer
```

### CAD / Drafting (19)
```
AutoCAD Drafter, CAD Technician, CAD Designer, Drafter, Drafter I, Design Drafter,
Civil CAD Drafter, Electrical CAD Drafter, Mechanical CAD Drafter, Structural Drafter,
CAD Operator, Engineering Technician CAD, Utility Drafter, Land Surveying Drafter,
Piping Designer, Site Design Technician, BIM Technician, Construction Drafter,
Telecom Drafter, Drafting Technician
```

### GIS / Geospatial (19)
```
GIS Analyst, GIS Technician, GIS Specialist, GIS Coordinator, GIS Developer,
GIS Mapping Technician, Geospatial Analyst, GIS Data Analyst, GIS Analyst I,
GIS Technician I, Utility GIS Analyst, Telecom GIS Analyst, GIS Field Technician,
Cartographer, Remote Sensing Analyst, GIS Database Technician, GIS QA/QC Analyst,
Land Records GIS Analyst, Environmental GIS Analyst, GIS Support Specialist
```

31 + 19 + 19 = **69 titles**.

---

## 3. Critical: how to match titles (read before writing your own matcher)

We tried the obvious approach first — check whether a posting's title contains one of the
69 phrases above verbatim — and it badly under-counted. Real job postings almost never use
the exact templated phrasing ("Manager - OSP Construction", "Fiber Technician - Cedar
Rapids", "GIS Lead" — none of those contain a full 69-list phrase as a substring). Switching
to root-term matching multiplied the real match count by ~3x on the same data.

**Second trap**: naive substring checks on short 3-letter acronyms are unsafe. `"osp"` is a
substring of **"h`osp`ital"**. `"cad"` is a substring of **"a`cad`emic"** and **"de`cad`e"**.
`"gis"` is a substring of **"re`gis`tered"**, **"lo`gis`tics"**, **"methodolo`gis`t"**. If you
naive-substring-match those three letters, you will pull in nurses and academics. **Always
word-boundary-match short acronyms** (regex `\bosp\b`, `\bgis\b`, `\bcad\b`, `\bbim\b`,
`\bftth\b`, `\bfttx\b`), and only plain-substring-match longer, unambiguous words (`fiber`,
`telecom`, `drafter`, `drafting`, `geospatial`, `cartograph`, etc.).

Also exclude `"fiberglass"` explicitly — it contains `"fiber"` as a substring but is an
unrelated field (composites/insulation), not fiber-optic telecom.

The script in §4 already implements this correctly. If you're asked to write your own
matcher from scratch instead of using it, apply these same two rules or you will silently
get either near-zero results (exact-phrase trap) or garbage results (bare-acronym trap).

---

## 4. The script (copy-paste, ready to run)

```python
#!/usr/bin/env python3
"""Standalone OpenJobData pull: OSP / CAD-Drafting / GIS jobs, posted_at >= SINCE_DATE.

pip install huggingface_hub pandas pyarrow openpyxl

Usage:
  python pull_openjobdata.py                  # defaults: since=2026-07-12, no row limit
  python pull_openjobdata.py 2026-07-01        # custom since-date
  python pull_openjobdata.py 2026-07-01 500    # custom since-date + row cap
"""

import re
import sys
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List

import pandas as pd
from huggingface_hub import HfFileSystem

DATASET_PREFIX = "datasets/scholarweave/Jobs-Dataset-v2"

# Short acronyms need \b word boundaries -- naive substring matching hits "hOSPital",
# "aCADemic", "reGIStered", "loGIStics". Longer domain words are safe as plain substrings.
_BOUNDED_ROOTS = ["osp", "gis", "cad", "bim", "ftth", "fttx"]
_SAFE_ROOTS = [
    "fiber optic", "fiber network", "fiber design", "fiber splic", "fiber route",
    "fiber technician", "fiber construction", "fiber engineer", "fiber permit",
    "telecom", "broadband", "splice", "splicing", "outside plant",
    "geospatial", "cartograph", "remote sensing", "drafter", "drafting",
    "autocad", "piping designer", "structural drafter", "utility drafter",
]
_BOUNDED_RE = re.compile(r"\b(?:" + "|".join(_BOUNDED_ROOTS) + r")\b", re.IGNORECASE)


def matches_role(title: Any) -> bool:
    if not isinstance(title, str) or not title:
        return False
    title_lower = title.lower()
    if "fiberglass" in title_lower:
        title_lower = title_lower.replace("fiberglass", "")
    if any(root in title_lower for root in _SAFE_ROOTS):
        return True
    if _BOUNDED_RE.search(title):
        return True
    return False


def load_companies(fs: HfFileSystem) -> Dict[int, Dict[str, Any]]:
    # Companies are dated snapshots now, not one static file — use the latest.
    snapshot_dirs = sorted(fs.glob(f"{DATASET_PREFIX}/data/companies/snapshot_date=*"))
    if not snapshot_dirs:
        print("  WARNING: no company snapshot found, proceeding without company names")
        return {}
    latest_dir = snapshot_dirs[-1]
    company_paths = sorted(fs.glob(f"{latest_dir}/part-*.parquet"))
    print(f"Loading companies lookup from hf://{latest_dir} ({len(company_paths)} shard(s)) ...")
    companies_df = pd.concat(
        [pd.read_parquet(fs.open(p, "rb")) for p in company_paths], ignore_index=True
    )
    lookup = {
        int(row["id"]): {"name": row.get("name"), "career_url": row.get("career_url")}
        for _, row in companies_df.iterrows()
        if pd.notna(row.get("id"))
    }
    print(f"  Loaded {len(lookup):,} companies")
    return lookup


def load_deltas(fs: HfFileSystem, since_date: str, end_date: str) -> pd.DataFrame:
    dates = pd.date_range(start=since_date, end=end_date).strftime("%Y-%m-%d")
    frames: List[pd.DataFrame] = []
    for date_str in dates:
        # A day's delta is a glob of one or more shards under a date+run partition,
        # not a single file (data/changes/minimal/date=YYYY-MM-DD/run_id=.../part-*.parquet).
        shard_paths = sorted(fs.glob(f"{DATASET_PREFIX}/data/changes/minimal/date={date_str}/**/*.parquet"))
        if not shard_paths:
            print(f"  {date_str}: no delta shards (gap in source, skipping)")
            continue
        df = pd.concat([pd.read_parquet(fs.open(p, "rb")) for p in shard_paths], ignore_index=True)
        print(f"  {date_str}: {len(df):,} rows ({len(shard_paths)} shard(s))")
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def main():
    since_date = sys.argv[1] if len(sys.argv) > 1 else "2026-07-12"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else None
    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    print(f"Pulling OpenJobData deltas from {since_date} to {end_date}")
    fs = HfFileSystem()

    df = load_deltas(fs, since_date, end_date)
    if df.empty:
        print("No delta rows found in range.")
        return

    print(f"Total delta rows across range: {len(df):,}")

    # format="ISO8601", not a fixed-format string: posted_at values aren't all the
    # same length (some carry milliseconds, some don't), which breaks pandas' default
    # single-format auto-inference on a bulk column conversion.
    df["posted_at"] = pd.to_datetime(df["posted_at"], utc=True, format="ISO8601", errors="coerce")
    since_ts = pd.Timestamp(since_date, tz="UTC")
    df = df[df["posted_at"].notna() & (df["posted_at"] >= since_ts)]
    print(f"After posted_at >= {since_date} filter: {len(df):,} rows")

    # No status=='active' filter needed: data/changes/ only ever contains
    # active_insert/active_update rows — closures live in the separate data/closed/
    # folder, which this pull never reads.

    df = df[df["title"].apply(matches_role)]
    print(f"After role-title match: {len(df):,} rows")

    if df.empty:
        print("No jobs matched.")
        return

    companies = load_companies(fs)

    seen_ids: set = set()
    seen_sig: set = set()
    rows: List[Dict[str, Any]] = []
    for _, row in df.sort_values("posted_at", ascending=False).iterrows():
        row_id = row.get("posting_id") or row.get("job_id")  # "id" no longer exists
        if row_id and row_id in seen_ids:
            continue

        title = str(row["title"]) if pd.notna(row.get("title")) else ""
        company_info = companies.get(int(row["company_id"])) if pd.notna(row.get("company_id")) else None
        company_name = company_info["name"] if company_info else None

        sig = f"{title.lower()}|{(company_name or '').lower()}"
        sig_hash = hashlib.md5(sig.encode()).hexdigest()
        if sig_hash in seen_sig:
            continue
        seen_sig.add(sig_hash)
        if row_id:
            seen_ids.add(row_id)

        loc_bits = []
        if bool(row.get("is_remote")):
            loc_bits.append("Remote")
        if pd.notna(row.get("workplace_type")):
            loc_bits.append(str(row["workplace_type"]))
        if pd.notna(row.get("country")):
            loc_bits.append(str(row["country"]))

        rows.append({
            "title": title,
            "company": company_name,
            "location": " / ".join(loc_bits) if loc_bits else None,
            "employment_type": row.get("employment_type"),
            "is_remote": bool(row.get("is_remote")) if pd.notna(row.get("is_remote")) else None,
            "posted_at": row["posted_at"].tz_localize(None) if pd.notna(row["posted_at"]) else None,
            "apply_url": row.get("apply_url"),
            "career_url": company_info.get("career_url") if company_info else None,
        })

    if limit and len(rows) > limit:
        rows = rows[:limit]

    out = pd.DataFrame(rows).sort_values("posted_at", ascending=False)
    csv_path = f"openjobdata_pull_{since_date}_to_{end_date}.csv"
    xlsx_path = f"openjobdata_pull_{since_date}_to_{end_date}.xlsx"
    out.to_csv(csv_path, index=False)
    out.to_excel(xlsx_path, index=False, engine="openpyxl")
    print(f"\nDone. {len(out)} unique jobs -> {csv_path} / {xlsx_path}")


if __name__ == "__main__":
    main()
```

---

## 5. Running it

```bash
pip install huggingface_hub pandas pyarrow openpyxl
python pull_openjobdata.py                # since 2026-07-12, no cap
python pull_openjobdata.py 2026-07-01 1000
```

No environment variables, no secrets, no login. Output: an `.xlsx` and `.csv` with one row
per unique job (title, company, location, employment type, remote flag, posted date, apply
URL, career page URL).

Sanity check from a live run of this exact script (2026-07-12 → 2026-07-19 window): **251
unique matching jobs** out of ~132k active postings in that window. If your run returns
close to 0, you likely reintroduced the exact-phrase or bare-acronym trap from §3 — check
your matcher, not the data source.

---

## 6. If your team also has TalentOS access

TalentOS (this org's internal recruiting platform) has this exact pull wired into an
automated pipeline that also QA-scores, deep-fetches full descriptions, and matches jobs to
candidates. If a team member has TalentOS API access, they can skip steps above and instead
run `scripts/openjobdata_ingest.py` on branch `saki-new-agent-layer` of the TalentOS repo
(same matching logic as §3/§4, additionally POSTs into TalentOS's `/api/job-ceo/ingest`
pipeline) — see `docs/handoff-openjobdata-pull.md` in that repo for the full internal
workflow. Everything in this masterprompt works standalone without that access, though.
