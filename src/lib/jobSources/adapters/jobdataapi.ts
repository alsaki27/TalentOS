// src/lib/jobSources/adapters/jobdataapi.ts
// jobdataapi.com — aggregates from 80+ ATS/HR platforms (Greenhouse, Lever,
// etc.), clean structured JSON since it's ATS-sourced rather than scraped.
// https://jobdataapi.com/
// STUB. Before implementing: confirm current base URL, auth scheme, and
// response shape from their docs — this is a smaller/newer vendor than
// TheirStack/Coresignal, worth double-checking uptime/support before
// committing real budget.

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult } from "../types";

export const jobDataApiAdapter: JobSourceAdapter = {
  id: "jobdataapi",
  async fetchJobs(_params: JobSourceFetchParams, _credentials: string): Promise<JobSourceFetchResult> {
    throw new Error("jobDataApiAdapter.fetchJobs is a stub — see comment at top of this file.");
  },
};
