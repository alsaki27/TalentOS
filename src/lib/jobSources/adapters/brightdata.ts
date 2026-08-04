// src/lib/jobSources/adapters/brightdata.ts
// Bright Data — proxy/scraper infrastructure + dataset marketplace, NOT a
// licensed job-postings dataset like the others in this directory.
// https://brightdata.com/blog/web-data/best-job-posting-data-providers
//
// STUB, and lowest priority in the rollout order. Before implementing:
//   1. This is infrastructure for building your OWN scraper, not a vendor
//      who has already cleared ToS/licensing on job board data for you —
//      that compliance burden sits on TalentOS if this is enabled. Get
//      legal/product sign-off before wiring this one in, separately from
//      the other 6 sources.
//   2. Expect the highest noise/QA-failure rate of any source here — plan
//      to compare its job_source_usage + per-source QA pass-rate against
//      the others before spending real budget on it.

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult } from "../types";

export const brightDataAdapter: JobSourceAdapter = {
  id: "brightdata",
  async fetchJobs(_params: JobSourceFetchParams, _credentials: string): Promise<JobSourceFetchResult> {
    throw new Error("brightDataAdapter.fetchJobs is a stub — see comment at top of this file.");
  },
};
