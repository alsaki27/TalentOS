#!/usr/bin/env python3
"""OpenJobData ingest script for TalentOS JOB CEO pipeline.

NOTE: The original Hugging Face dataset (Invicto69/Jobs-Dataset-bucket) was deleted
or made private and the URL format broke the hf_hub_library. 
To keep the pipeline functional and allow end-to-end testing, this script now 
generates 10 realistic, dynamic test jobs that match the OSP/Telecom criteria
and pushes them to the Job CEO pipeline.

Environment variables:
  INGEST_SECRET  - JOB_CEO_INGEST_SECRET bearer token (required)
  BASE_URL       - TalentOS base URL (default: https://skarion-talent-os.skarion-talentos.workers.dev)
"""

import os
import sys
import requests
from datetime import datetime, timezone
import random

def generate_mock_jobs(num_jobs=10):
    """Generates realistic OSP/Telecom jobs with dynamic IDs based on the current date."""
    companies = ["AT&T", "Verizon", "Lumen Technologies", "Crown Castle", "Comcast", 
                 "Zayo Group", "Google Fiber", "Ting Internet", "Frontier Communications", "Charter Spectrum"]
    
    titles = [
        "OSP Design Engineer", "Outside Plant Engineer", "Fiber Design Engineer",
        "FTTH Design Engineer", "Telecom Design Engineer", "Splice Engineer",
        "Fiber Splicing Engineer", "OSP CAD Designer", "Fiber Network Engineer",
        "Outside Plant Designer"
    ]
    
    locations = ["Remote / USA", "Dallas, TX", "Denver, CO", "Atlanta, GA", "Remote / Canada", 
                 "Charlotte, NC", "Phoenix, AZ", "Austin, TX", "Seattle, WA", "Chicago, IL"]

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y%m%d_%H%M%S")
    iso_time = now.isoformat()

    jobs = []
    for i in range(num_jobs):
        company = companies[i % len(companies)]
        title = titles[i % len(titles)]
        location = locations[i % len(locations)]
        
        # Make the ID dynamic so the pipeline sees it as a "new" job every run
        job_id = f"test_job_{date_str}_{i+1}"
        
        jobs.append({
            "title": title,
            "company": company,
            "location": location,
            "source_url": f"https://example.com/careers/{company.lower().replace(' ', '-')}/{job_id}",
            "external_job_id": job_id,
            "snippet": f"We are looking for an experienced {title} to join our fast-growing network deployment team.",
            "raw": {
                "source": "openjobdata_mock",
                "posted_at": iso_time
            }
        })
    
    return jobs

def main():
    base_url = os.environ.get(
        "BASE_URL",
        "https://skarion-talent-os.skarion-talentos.workers.dev",
    )
    ingest_secret = os.environ.get("INGEST_SECRET")
    if not ingest_secret:
        print("ERROR: INGEST_SECRET environment variable is required")
        sys.exit(1)

    print("Generating 10 realistic sample jobs for testing...")
    jobs = generate_mock_jobs(10)
    
    payload = {"jobs": jobs}
    url = f"{base_url}/api/job-ceo/ingest"
    print(f"POSTing {len(jobs)} jobs to {url}")
    
    try:
        resp = requests.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {ingest_secret}"},
            timeout=30
        )
        resp.raise_for_status()
        print(f"Success! Status: {resp.status_code}")
        print(f"Response: {resp.text}")
    except requests.RequestException as e:
        print(f"Failed to post jobs: {e}")
        if e.response is not None:
            print(f"Response text: {e.response.text}")
        sys.exit(1)

if __name__ == "__main__":
    main()
