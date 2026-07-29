#!/usr/bin/env python3
"""OpenJobData ingest script for TalentOS JOB CEO pipeline.

Downloads daily delta parquet files from the public HuggingFace bucket
(Invicto69/Jobs-Dataset-bucket) — no token or account needed.
Filters job titles using word-boundary-safe keyword matching from the
MASTERPROMPT role library, then POSTs matched jobs to the Job CEO ingest API.

Environment variables:
  INGEST_SECRET  - JOB_CEO_INGEST_SECRET bearer token (required)
  BASE_URL       - TalentOS base URL (default: production worker URL)
  HF_TOKEN       - Optional HuggingFace token (bucket is public, not needed)
  DRY_RUN        - If 'true', scan and print counts but don't POST

CLI arguments (for GitHub Actions workflow_dispatch):
  --role-group   - Role group id (A-L) or 'all' (default: all)
  --days         - Number of trailing days to scan (default: 1)
  --dry-run      - Scan only, do not POST
  --keywords     - Comma-separated custom keywords to filter by
"""

import argparse
import hashlib
import math
import os
import re
import sys
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

# ─── Word-boundary-safe keyword matcher (from MASTERPROMPT §3) ────────────────
# Short acronyms MUST use \b boundaries to avoid:
#   "osp" hitting "hOSPital", "cad" hitting "aCADemic",
#   "gis" hitting "loGIStics" / "reGIStered"
_BOUNDED_ROOTS = ["osp", "gis", "cad", "bim", "ftth", "fttx"]

# Longer, unambiguous words are safe as plain substrings.
# "fiberglass" is explicitly excluded (composites, not telecom).
_SAFE_ROOTS = [
    "fiber optic", "fiber network", "fiber design", "fiber splic", "fiber route",
    "fiber technician", "fiber construction", "fiber engineer", "fiber permit",
    "outside plant", "telecom", "broadband", "splice", "splicing",
    "geospatial", "cartograph", "remote sensing", "drafter", "drafting",
    "autocad", "piping designer", "structural drafter", "utility drafter",
]

_BOUNDED_RE = re.compile(
    r"\b(?:" + "|".join(re.escape(r) for r in _BOUNDED_ROOTS) + r")\b",
    re.IGNORECASE,
)

# Role group definitions (matches TalentOS jobAgentRoleLibrary)
ROLE_GROUPS: Dict[str, Dict[str, Any]] = {
    "A": {
        "label": "OSP / Fiber",
        "bounded": ["osp", "ftth", "fttx"],
        "safe": [
            "fiber optic", "fiber network", "fiber design", "fiber splic", "fiber route",
            "fiber technician", "fiber construction", "fiber engineer", "fiber permit",
            "outside plant", "broadband", "splice", "splicing",
        ],
    },
    "B": {
        "label": "CAD / Drafting",
        "bounded": ["cad", "bim"],
        "safe": ["autocad", "drafter", "drafting", "piping designer", "structural drafter", "utility drafter"],
    },
    "C": {
        "label": "GIS / Geospatial",
        "bounded": ["gis"],
        "safe": ["geospatial", "cartograph", "remote sensing"],
    },
    "D": {"label": "Telecom General", "bounded": [], "safe": ["telecom"]},
}


def build_group_matcher(group_id: str):
    """Build a compiled regex for a specific role group."""
    g = ROLE_GROUPS.get(group_id)
    if not g:
        return None, []
    bounded = re.compile(
        r"\b(?:" + "|".join(re.escape(b) for b in g["bounded"]) + r")\b",
        re.IGNORECASE,
    ) if g["bounded"] else None
    return bounded, g["safe"]


def matches_role(title: Any, role_group: str = "all", custom_keywords: Optional[List[str]] = None) -> bool:
    """
    Returns True if this job title matches the requested role group(s).
    Always strips 'fiberglass' to avoid false-positive hits on fiber roots.
    """
    if not isinstance(title, str) or not title:
        return False

    title_lower = title.lower().replace("fiberglass", "")

    # Custom keyword filter takes priority if provided
    if custom_keywords:
        return any(kw.lower() in title_lower for kw in custom_keywords)

    if role_group == "all":
        # Full matcher — same as _BOUNDED_RE + all _SAFE_ROOTS
        if any(root in title_lower for root in _SAFE_ROOTS):
            return True
        return bool(_BOUNDED_RE.search(title))

    # Single group
    bounded_re, safe_roots = build_group_matcher(role_group.upper())
    if any(root in title_lower for root in safe_roots):
        return True
    if bounded_re and bounded_re.search(title):
        return True
    return False


def load_companies(fs, bucket_prefix: str) -> Dict[Any, Dict[str, Any]]:
    """Load company lookup table from the bucket."""
    companies_path = f"{bucket_prefix}/data/companies/companies.parquet"
    try:
        if not fs.exists(companies_path):
            print("  WARNING: companies.parquet not found, proceeding without company names")
            return {}
        import pandas as pd
        with fs.open(companies_path, "rb") as f:
            df = pd.read_parquet(f)
        lookup: Dict[Any, Dict[str, Any]] = {}
        for _, row in df.iterrows():
            cid = row.get("id")
            if pd.notna(cid):
                try:
                    lookup[int(cid)] = {
                        "name": row.get("name"),
                        "career_url": row.get("career_url"),
                        "website": row.get("website"),
                        "industry": row.get("industry"),
                    }
                except (ValueError, TypeError):
                    pass
        print(f"  Loaded {len(lookup):,} companies")
        return lookup
    except Exception as e:
        print(f"  WARNING: Failed to load companies: {e}")
        return {}


def load_deltas(fs, bucket_prefix: str, days_back: int) -> "pd.DataFrame":
    """Download daily delta parquet files for the last N days."""
    import pandas as pd

    end_date = datetime.now(timezone.utc).date()
    dates = [end_date - timedelta(days=i) for i in range(days_back)]
    dates.sort()

    remote_dir = f"{bucket_prefix}/data/minimal/changes"
    frames: List["pd.DataFrame"] = []

    for date in dates:
        date_str = date.strftime("%Y-%m-%d")
        remote_path = f"{remote_dir}/{date_str}.parquet"
        try:
            if not fs.exists(remote_path):
                print(f"  {date_str}: no delta file (source gap, skipping)")
                continue
            with fs.open(remote_path, "rb") as f:
                df = pd.read_parquet(f)
            print(f"  {date_str}: {len(df):,} rows downloaded")
            frames.append(df)
        except Exception as e:
            print(f"  {date_str}: ERROR — {e}")

    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def sanitize_payload(obj: Any) -> Any:
    """Recursively replace NaN/Inf float values with None so JSON serialisation works."""
    if isinstance(obj, dict):
        return {k: sanitize_payload(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_payload(v) for v in obj]
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def build_job_payload(row: "pd.Series", companies: Dict[Any, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Convert a raw parquet row to the Job CEO ingest payload format."""
    import pandas as pd

    title = str(row["title"]) if pd.notna(row.get("title")) else ""
    if not title:
        return None

    company_info: Optional[Dict[str, Any]] = None
    company_id = row.get("company_id")
    if pd.notna(company_id):
        try:
            company_info = companies.get(int(company_id))
        except (ValueError, TypeError):
            pass

    company_name = (company_info or {}).get("name") or None
    apply_url = row.get("apply_url") or (company_info or {}).get("career_url") or None

    loc_parts: List[str] = []
    if row.get("is_remote"):
        loc_parts.append("Remote")
    wt = row.get("workplace_type")
    if pd.notna(wt) and str(wt) not in ("", "nan", "None"):
        loc_parts.append(str(wt))
    country = row.get("country")
    if pd.notna(country) and str(country) not in ("", "nan", "None"):
        loc_parts.append(str(country))

    posted_at = None
    if pd.notna(row.get("posted_at")):
        try:
            posted_at = str(row["posted_at"])
        except Exception:
            pass

    external_id = str(row.get("id") or row.get("job_id") or "")

    return {
        "title": title,
        "company": company_name,
        "location": " / ".join(loc_parts) if loc_parts else None,
        "source_url": apply_url,
        "apply_url": apply_url,
        "external_job_id": external_id or None,
        "snippet": None,
        "raw": {
            "source": "openjobdata",
            "posted_at": posted_at,
            "employment_type": str(row.get("employment_type") or ""),
            "is_remote": bool(row.get("is_remote")) if pd.notna(row.get("is_remote")) else None,
            "company_website": (company_info or {}).get("website"),
            "industry": (company_info or {}).get("industry"),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="OpenJobData → TalentOS Job CEO ingest")
    parser.add_argument("--role-group", default=None,
                        help="Role group id (A, B, C, D, or 'all'). Default: all")
    parser.add_argument("--days", type=int, default=None,
                        help="Number of trailing days to scan. Default: 1")
    parser.add_argument("--dry-run", action="store_true", default=None,
                        help="Scan and print counts but do NOT POST to TalentOS")
    parser.add_argument("--keywords", default=None,
                        help="Comma-separated custom keywords (overrides role-group filter)")
    parser.add_argument("--limit", type=int, default=None,
                        help="Max jobs to send per run (0 = no limit)")
    args = parser.parse_args()

    # Environment overrides
    dry_run = args.dry_run if args.dry_run is not None else (os.environ.get("DRY_RUN", "").lower() == "true")
    role_group = args.role_group if args.role_group is not None else os.environ.get("ROLE_GROUP", "all")
    days_back = args.days if args.days is not None else int(os.environ.get("DAYS", "1"))
    custom_keywords_raw = args.keywords if args.keywords is not None else os.environ.get("KEYWORDS", "")
    custom_keywords = [k.strip() for k in custom_keywords_raw.split(",") if k.strip()]
    limit = args.limit if args.limit is not None else int(os.environ.get("LIMIT", "0"))

    base_url = (os.environ.get("BASE_URL") or "https://skarion-talent-os.skarion-talentos.workers.dev").strip()
    ingest_secret = os.environ.get("INGEST_SECRET") or os.environ.get("JOB_CEO_INGEST_SECRET")

    if not dry_run and not ingest_secret:
        print("ERROR: INGEST_SECRET environment variable is required (or set --dry-run)")
        sys.exit(1)

    print(f"OpenJobData Ingest — role_group={role_group}, days={days_back}, dry_run={dry_run}")
    if custom_keywords:
        print(f"  Custom keywords: {custom_keywords}")

    try:
        from huggingface_hub import HfFileSystem
        import pandas as pd
    except ImportError:
        print("ERROR: Run: pip install huggingface_hub pandas pyarrow requests")
        sys.exit(1)

    # HF_TOKEN is optional (bucket is public) but speeds up rate limits if provided
    hf_token = os.environ.get("HF_TOKEN")
    fs = HfFileSystem(token=hf_token) if hf_token else HfFileSystem()
    bucket_prefix = "buckets/Invicto69/Jobs-Dataset-bucket"

    print(f"\nDownloading last {days_back} day(s) of delta files...")
    df = load_deltas(fs, bucket_prefix, days_back)

    if df.empty:
        print("No delta rows found. Either no delta files exist for these dates, or the bucket is unavailable.")
        sys.exit(0)

    print(f"\nTotal raw rows: {len(df):,}")

    # Filter active jobs only
    if "status" in df.columns:
        df = df[df["status"] == "active"]
        print(f"After status=active filter: {len(df):,}")

    # ── US-ONLY FILTER (strict) ───────────────────────────────────────────────
    # The OpenJobData minimal schema has a 'country' column with ISO-2 codes
    # (e.g. "US", "GB", "CA"). Reject every row that is not explicitly in the
    # United States. Remote-only rows that have country=US are kept.
    if "country" in df.columns:
        before_us = len(df)
        df = df[df["country"].str.upper().isin(["US", "USA", "UNITED STATES"])]
        print(f"After US-only filter: {len(df):,} (dropped {before_us - len(df):,} non-US rows)")
    else:
        print("  WARNING: 'country' column not found in dataset — US filter skipped")
    # ─────────────────────────────────────────────────────────────────────────

    # Apply role-title keyword filter
    df = df[df["title"].apply(lambda t: matches_role(t, role_group, custom_keywords or None))]
    print(f"After keyword filter (role_group={role_group}): {len(df):,} matched")

    if df.empty:
        print("No jobs matched the keyword filter.")
        sys.exit(0)

    # Load company lookup for enriching job data
    print("\nLoading company data...")
    companies = load_companies(fs, bucket_prefix)

    # Deduplicate within this batch (title|company signature)
    seen_sig: set = set()
    seen_ext_ids: set = set()
    jobs: List[Dict[str, Any]] = []

    for _, row in df.iterrows():
        payload = build_job_payload(row, companies)
        if not payload:
            continue

        # In-batch dedup
        sig = f"{(payload['title'] or '').lower()}|{(payload['company'] or '').lower()}"
        sig_hash = hashlib.md5(sig.encode()).hexdigest()
        if sig_hash in seen_sig:
            continue

        ext_id = payload.get("external_job_id") or ""
        if ext_id and ext_id in seen_ext_ids:
            continue

        seen_sig.add(sig_hash)
        if ext_id:
            seen_ext_ids.add(ext_id)
        jobs.append(payload)

    print(f"\nUnique jobs after in-batch dedup: {len(jobs):,}")

    if limit > 0 and len(jobs) > limit:
        jobs = jobs[:limit]
        print(f"Capped to {limit} jobs per --limit flag")

    if dry_run:
        print(f"\n[DRY RUN] Would POST {len(jobs)} jobs to {base_url}/api/job-ceo/ingest")
        if jobs:
            print("Sample (first 3):")
            for j in jobs[:3]:
                print(f"  • {j['title']} @ {j['company']} ({j['location']})")
        sys.exit(0)

    # POST to TalentOS in batches of 100
    BATCH_SIZE = 100
    total_staged = 0
    total_skipped = 0

    for i in range(0, len(jobs), BATCH_SIZE):
        batch = [sanitize_payload(j) for j in jobs[i : i + BATCH_SIZE]]
        url = f"{base_url}/api/job-ceo/ingest"
        try:
            resp = requests.post(
                url,
                json={"jobs": batch},
                headers={"Authorization": f"Bearer {ingest_secret}", "Content-Type": "application/json"},
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()
            staged = data.get("staged", len(batch))
            skipped = data.get("skipped", 0)
            total_staged += staged
            total_skipped += skipped
            print(f"  Batch {i // BATCH_SIZE + 1}: sent {len(batch)}, staged={staged}, skipped_dup={skipped}")
        except requests.RequestException as e:
            print(f"  Batch {i // BATCH_SIZE + 1}: FAILED — {e}")
            if hasattr(e, "response") and e.response is not None:
                print(f"    Response: {e.response.text[:500]}")
            sys.exit(1)

    print(f"\n[DONE] Sent {len(jobs)} jobs → staged={total_staged}, skipped_dup={total_skipped}")


if __name__ == "__main__":
    main()
