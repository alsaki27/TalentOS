#!/usr/bin/env python3
"""OpenJobData ingest script for TalentOS JOB CEO pipeline.

Sources from the real, public OpenJobData Hugging Face bucket
(hf://buckets/Invicto69/Jobs-Dataset-bucket, see https://openjobdata.com/documentation).
No dataset id / HF token is needed — the bucket is public and its path is fixed.

Reads the daily minimal-schema delta files (data/minimal/changes/YYYY-MM-DD.parquet)
for every date in [SINCE_DATE, today], joins company names from data/companies/companies.parquet,
filters titles against the 72 OSP/CAD/GIS role keywords (docs/keywords-osp-gis-cad.md,
sourced from src/lib/jobAgentRoleLibrary.ts groups A-C), dedupes, and POSTs batches to
/api/job-ceo/ingest.

Environment variables:
  INGEST_SECRET  - JOB_CEO_INGEST_SECRET bearer token (required)
  BASE_URL       - TalentOS base URL (default: https://skarion-talent-os.skarion-talentos.workers.dev)
  SINCE_DATE     - earliest posted_at date to include, YYYY-MM-DD (default: 2026-07-12)
  LIMIT          - max jobs to ingest (default: 2000)
"""

import os
import sys
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pandas as pd
import requests
from huggingface_hub import HfFileSystem

BUCKET_PREFIX = "buckets/Invicto69/Jobs-Dataset-bucket"
COMPANIES_PATH = f"{BUCKET_PREFIX}/data/companies/companies.parquet"

ROLE_KEYWORDS = [
    # OSP / Fiber (34)
    "OSP Design Engineer", "Outside Plant Engineer", "OSP Engineer", "Fiber Design Engineer",
    "FTTH Design Engineer", "Fiber Optic Design Engineer", "Telecom Design Engineer",
    "Splice Engineer", "Fiber Splicing Engineer", "OSP Planning Engineer", "OSP CAD Designer",
    "Fiber Network Engineer", "Fiber Construction Engineer", "Outside Plant Designer",
    "Telecommunications Engineer", "Fiber Route Engineer", "Aerial Fiber Design Engineer",
    "Underground Fiber Design Engineer", "Joint Use Engineer", "Make Ready Engineer",
    "Fiber Permitting Engineer", "GIS Fiber Design Technician", "OSP Project Engineer",
    "Fiber Design Technician", "OSP Field Engineer", "Fiber Construction Manager",
    "OSP Estimator", "Telecom Infrastructure Engineer", "Broadband Design Engineer",
    "FTTx Design Engineer", "Fiber Network Planner", "OSP QC Engineer",
    "Fiber Splice Technician", "Broadband Network Engineer", "Fiber Engineer",
    # CAD / Drafting (19)
    "AutoCAD Drafter", "CAD Technician", "CAD Designer", "Drafter", "Drafter I", "Design Drafter",
    "Civil CAD Drafter", "Electrical CAD Drafter", "Mechanical CAD Drafter", "Structural Drafter",
    "CAD Operator", "Engineering Technician CAD", "Utility Drafter", "Land Surveying Drafter",
    "Piping Designer", "Site Design Technician", "BIM Technician", "Construction Drafter",
    "Telecom Drafter", "Drafting Technician",
    # GIS / Geospatial (19)
    "GIS Analyst", "GIS Technician", "GIS Specialist", "GIS Coordinator", "GIS Developer",
    "GIS Mapping Technician", "Geospatial Analyst", "GIS Data Analyst", "GIS Analyst I",
    "GIS Technician I", "Utility GIS Analyst", "Telecom GIS Analyst", "GIS Field Technician",
    "Cartographer", "Remote Sensing Analyst", "GIS Database Technician", "GIS QA/QC Analyst",
    "Land Records GIS Analyst", "Environmental GIS Analyst", "GIS Support Specialist",
]


def matches_role(title: Any) -> bool:
    if not isinstance(title, str) or not title:
        return False
    title_lower = title.lower()
    return any(kw.lower() in title_lower for kw in ROLE_KEYWORDS)


def load_companies(fs: HfFileSystem) -> Dict[int, Dict[str, Any]]:
    print(f"Loading companies lookup from hf://{COMPANIES_PATH} ...")
    if not fs.exists(COMPANIES_PATH):
        print("  WARNING: companies.parquet not found, proceeding without company names")
        return {}
    with fs.open(COMPANIES_PATH, "rb") as f:
        companies_df = pd.read_parquet(f)
    lookup = {
        int(row["id"]): {"name": row.get("name"), "career_url": row.get("career_url")}
        for _, row in companies_df.iterrows()
        if pd.notna(row.get("id"))
    }
    print(f"  Loaded {len(lookup):,} companies")
    return lookup


def load_deltas(fs: HfFileSystem, since_date: str, end_date: str) -> pd.DataFrame:
    dates = pd.date_range(start=since_date, end=end_date).strftime("%Y-%m-%d")
    remote_dir = f"{BUCKET_PREFIX}/data/minimal/changes"
    frames: List[pd.DataFrame] = []
    for date_str in dates:
        remote_path = f"{remote_dir}/{date_str}.parquet"
        if not fs.exists(remote_path):
            print(f"  {date_str}: no delta file")
            continue
        with fs.open(remote_path, "rb") as f:
            df = pd.read_parquet(f)
        print(f"  {date_str}: {len(df):,} rows")
        frames.append(df)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def main():
    base_url = os.environ.get(
        "BASE_URL",
        "https://skarion-talent-os.skarion-talentos.workers.dev",
    )
    ingest_secret = os.environ.get("INGEST_SECRET")
    if not ingest_secret:
        print("ERROR: INGEST_SECRET environment variable is required")
        sys.exit(1)

    since_date = os.environ.get("SINCE_DATE") or (sys.argv[2] if len(sys.argv) > 2 else "2026-07-12")
    limit = int(os.environ.get("LIMIT") or (sys.argv[1] if len(sys.argv) > 1 else 2000))
    end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    print(f"Pulling OpenJobData deltas from {since_date} to {end_date} (bucket: hf://{BUCKET_PREFIX})")
    fs = HfFileSystem()

    df = load_deltas(fs, since_date, end_date)
    if df.empty:
        print("No delta rows found in range. Nothing to ingest.")
        return

    print(f"Total delta rows across range: {len(df):,}")

    # posted_at may include rows updated within the window but originally posted earlier
    # (deltas cover new + modified/closed jobs) -- enforce the actual posted_at cutoff.
    df["posted_at"] = pd.to_datetime(df["posted_at"], utc=True, errors="coerce")
    since_ts = pd.Timestamp(since_date, tz="UTC")
    df = df[df["posted_at"].notna() & (df["posted_at"] >= since_ts)]
    print(f"After posted_at >= {since_date} filter: {len(df):,} rows")

    if "status" in df.columns:
        df = df[df["status"] == "active"]
        print(f"After status=active filter: {len(df):,} rows")

    df = df[df["title"].apply(matches_role)]
    print(f"After title match against {len(ROLE_KEYWORDS)} role keywords: {len(df):,} rows")

    if df.empty:
        print("No jobs matched the role keywords in this date range.")
        return

    companies = load_companies(fs)

    # Dedupe on the bucket's own compound id first, then title+company signature.
    seen_ids: set = set()
    seen_sig: set = set()
    jobs: List[Dict[str, Any]] = []
    for _, row in df.sort_values("posted_at", ascending=False).iterrows():
        row_id = row.get("id")
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

        location_bits = []
        if bool(row.get("is_remote")):
            location_bits.append("Remote")
        if pd.notna(row.get("workplace_type")):
            location_bits.append(str(row["workplace_type"]))
        if pd.notna(row.get("country")):
            location_bits.append(str(row["country"]))
        location = " / ".join(location_bits) if location_bits else None

        posted_at = row["posted_at"]
        job: Dict[str, Any] = {
            "title": title,
            "company": company_name,
            "location": location,
            "source_url": str(row["apply_url"]) if pd.notna(row.get("apply_url")) else None,
            "external_job_id": str(row_id) if row_id else None,
            "snippet": None,
            "description_text": None,
            "raw": {
                "job_id": str(row.get("job_id")) if pd.notna(row.get("job_id")) else None,
                "company_id": int(row["company_id"]) if pd.notna(row.get("company_id")) else None,
                "employment_type": str(row.get("employment_type")) if pd.notna(row.get("employment_type")) else None,
                "workplace_type": str(row.get("workplace_type")) if pd.notna(row.get("workplace_type")) else None,
                "is_remote": bool(row.get("is_remote")) if pd.notna(row.get("is_remote")) else None,
                "posted_at": posted_at.isoformat() if pd.notna(posted_at) else None,
                "career_url": company_info.get("career_url") if company_info else None,
                "source": "openjobdata",
            },
        }
        jobs.append(job)

    if limit and len(jobs) > limit:
        jobs = jobs[:limit]

    print(f"After dedup: {len(jobs)} jobs ready to ingest (capped at {limit})")

    # POST batches to ingest endpoint
    batch_size = 200
    total_posted = 0
    run_id: Optional[str] = None

    for i in range(0, len(jobs), batch_size):
        batch = jobs[i : i + batch_size]
        payload: Dict[str, Any] = {"jobs": batch}
        if run_id:
            payload["runId"] = run_id

        try:
            resp = requests.post(
                f"{base_url}/api/job-ceo/ingest",
                json=payload,
                headers={
                    "Authorization": f"Bearer {ingest_secret}",
                    "Content-Type": "application/json",
                },
                timeout=60,
            )
            if resp.status_code == 200:
                data = resp.json()
                run_id = data.get("runId", run_id)
                staged = data.get("staged", 0)
                total_posted += staged
                print(f"  Batch {i // batch_size + 1}: posted {staged} jobs (run {run_id[:8] if run_id else '?'})")
            else:
                print(f"  ERROR: Batch {i // batch_size + 1} HTTP {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"  ERROR: Batch {i // batch_size + 1} failed: {e}")

    print(f"\nDone. Total jobs posted: {total_posted}")


if __name__ == "__main__":
    main()
