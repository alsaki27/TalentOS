// src/lib/jobSources/adapters/coresignal.ts
// Coresignal Jobs Data API — https://coresignal.com/solutions/jobs-data-api/
// STUB. Before implementing:
//   1. Sign up and get an API key + confirm current base URL/auth scheme —
//      Coresignal's plans and endpoint paths have changed across tiers
//      (search vs. bulk-collect), verify against your actual account.
//   2. Coresignal pricing runs up to ~$800/mo on higher tiers — confirm
//      which plan you're on before setting job_sources.cost_per_record_usd
//      and monthly_budget_limit_usd, since it may be a flat monthly fee
//      rather than per-record.
//   3. Fill in normalize() once you have a real response sample.

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult } from "../types";

export const coresignalAdapter: JobSourceAdapter = {
  id: "coresignal",
  async fetchJobs(_params: JobSourceFetchParams, _credentials: string): Promise<JobSourceFetchResult> {
    throw new Error("coresignalAdapter.fetchJobs is a stub — see comment at top of this file.");
  },
};
