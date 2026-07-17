#!/usr/bin/env python3
"""OpenJobData ingest script for TalentOS JOB CEO pipeline.

Fetches the latest Scout terms from the TalentOS API, downloads the daily
OpenJobData parquet from HuggingFace, pre-filters on Scout queries and role
keywords, deduplicates, and POSTs batches to the /api/job-ceo/ingest endpoint.

Environment variables:
  HF_DATASET     - HuggingFace dataset ID (required)
  HF_TOKEN       - HuggingFace API token (optional, for gated datasets)
  INGEST_SECRET  - JOB_CEO_INGEST_SECRET bearer token (required)
  BASE_URL       - TalentOS base URL (default: https://skarion-talent-os.skarion-talentos.workers.dev)
"""

import os
import re
import sys
import json
import hashlib
import requests
from typing import Any, Dict, List, Optional


def main(limit: int = 500):
    base_url = os.environ.get(
        "BASE_URL",
        "https://skarion-talent-os.skarion-talentos.workers.dev",
    )
    ingest_secret = os.environ.get("INGEST_SECRET")
    if not ingest_secret:
        print("ERROR: INGEST_SECRET environment variable is required")
        sys.exit(1)

    hf_dataset = os.environ.get("HF_DATASET")
    if not hf_dataset:
        print("ERROR: HF_DATASET environment variable is not set")
        print("       Set the GitHub variable OPENJOBDATA_HF_DATASET in your repo settings.")
        sys.exit(1)

    hf_token = os.environ.get("HF_TOKEN") or None

    # Step 1: Get Scout terms
    print(f"Fetching Scout terms from {base_url}/api/job-ceo/scout-terms ...")
    scout_terms: Dict[str, Any] = {"queries": [], "booleanStrings": []}
    try:
        resp = requests.get(
            f"{base_url}/api/job-ceo/scout-terms",
            headers={"Authorization": f"Bearer {ingest_secret}"},
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            if data.get("scoutTerms"):
                scout_terms = data["scoutTerms"]
                print(f"  Got {len(scout_terms.get('queries', []))} queries, "
                      f"{len(scout_terms.get('booleanStrings', []))} Boolean strings")
        else:
            print(f"  Scout terms unavailable (HTTP {resp.status_code}), using defaults")
    except Exception as e:
        print(f"  Scout terms fetch failed: {e}, using defaults")

    # Step 2: Download parquet from HuggingFace
    print(f"Downloading latest parquet from {hf_dataset} ...")
    try:
        from huggingface_hub import list_repo_files, hf_hub_download

        # Optional HF token for gated datasets
        token_kwargs = {"token": hf_token} if hf_token else {}
        files = list_repo_files(hf_dataset, repo_type="dataset", **token_kwargs)
        parquet_files = sorted([f for f in files if f.endswith(".parquet")], reverse=True)
        if not parquet_files:
            print(f"ERROR: No parquet files found in dataset {hf_dataset}")
            sys.exit(1)

        latest = parquet_files[0]
        print(f"  Found latest: {latest}")
        path = hf_hub_download(hf_dataset, latest, repo_type="dataset", **token_kwargs)
        print(f"  Downloaded to {path}")

        import pandas as pd

        df = pd.read_parquet(path)
        print(f"  Loaded {len(df)} rows")
    except Exception as e:
        print(f"ERROR: Failed to download/load parquet: {e}")
        sys.exit(1)

    # Step 3: Pre-filter on Scout queries + role keywords
    queries = scout_terms.get("queries", [])
    boolean_patterns: List[str] = []
    for bs in scout_terms.get("booleanStrings", []):
        terms = re.findall(r'"([^"]+)"', bs)
        boolean_patterns.extend(terms)

    target_patterns = queries + boolean_patterns
    if not target_patterns:
        target_patterns = [
            "OSP", "Fiber", "Telecom", "Utility", "GIS",
            "Civil", "Drafting", "Construction", "Broadband",
            "Network Design", "Outside Plant", "Cable", "Splicing",
        ]
        print(f"  Using default target patterns: {target_patterns}")

    def matches_patterns(text: Any) -> bool:
        if not isinstance(text, str):
            return False
        text_lower = text.lower()
        for pat in target_patterns:
            if pat.lower() in text_lower:
                return True
        return False

    # Expected column names from OpenJobData
    title_col = next((c for c in df.columns if c.lower() in ("title", "job_title", "name")), None)
    company_col = next((c for c in df.columns if c.lower() in ("company", "employer", "organization")), None)
    location_col = next((c for c in df.columns if c.lower() in ("location", "city", "region")), None)
    url_col = next((c for c in df.columns if c.lower() in ("url", "link", "apply_url", "source_url")), None)
    desc_col = next((c for c in df.columns if c.lower() in ("description", "description_text", "job_description", "body", "snippet")), None)
    id_col = next((c for c in df.columns if c.lower() in ("id", "job_id", "external_id")), None)

    if not title_col:
        print("ERROR: Could not identify title column in parquet. Found columns:", list(df.columns))
        sys.exit(1)

    print(f"  Mapped columns: title={title_col}, company={company_col}, location={location_col}, "
          f"url={url_col}, desc={desc_col}, id={id_col}")

    # Filter
    before = len(df)
    df = df[df[title_col].notna()]
    df = df[df[title_col].astype(str).apply(matches_patterns) |
            (desc_col and df[desc_col].notna() and df[desc_col].astype(str).apply(matches_patterns))]
    print(f"  Filtered: {before} -> {len(df)} rows")

    # Limit
    if limit and len(df) > limit:
        df = df.head(limit)

    # Step 4: Build ingest payload
    seen: set = set()
    jobs: List[Dict[str, Any]] = []
    for _, row in df.iterrows():
        title = str(row[title_col]) if pd.notna(row[title_col]) else ""
        company = str(row[company_col]) if company_col and pd.notna(row[company_col]) else ""
        sig = f"{title.lower()}|{company.lower()}" if title and company else ""
        sig_hash = hashlib.md5(sig.encode()).hexdigest() if sig else ""
        if sig_hash and sig_hash in seen:
            continue
        if sig_hash:
            seen.add(sig_hash)

        job: Dict[str, Any] = {
            "title": title,
            "company": company if company else None,
            "location": str(row[location_col]) if location_col and pd.notna(row.get(location_col)) else None,
            "source_url": str(row[url_col]) if url_col and pd.notna(row.get(url_col)) else None,
            "external_job_id": str(row[id_col]) if id_col and pd.notna(row.get(id_col)) else None,
            "snippet": str(row[desc_col])[:1000] if desc_col and pd.notna(row.get(desc_col)) else None,
            "description_text": str(row[desc_col]) if desc_col and pd.notna(row.get(desc_col)) else None,
            "raw": {k: str(v) if pd.notna(v) else None for k, v in row.items()},
        }
        jobs.append(job)

    print(f"  After dedup: {len(jobs)} jobs ready to ingest")

    if not jobs:
        print("No jobs to ingest after filtering and dedup.")
        return

    # Step 5: POST batches to ingest endpoint
    batch_size = 200
    total_posted = 0
    run_id: Optional[str] = None

    for i in range(0, len(jobs), batch_size):
        batch = jobs[i : i + batch_size]
        payload = {"jobs": batch}
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
    limit_arg = int(sys.argv[1]) if len(sys.argv) > 1 else 500
    main(limit_arg)
