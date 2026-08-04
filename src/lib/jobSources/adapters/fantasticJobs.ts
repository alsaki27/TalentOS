// src/lib/jobSources/adapters/fantasticJobs.ts
// Fantastic.jobs — AI-enriched postings from 200k+ career sites + 54 ATS
// platforms. https://fantastic.jobs/article/best-job-posting-apis
// STUB. Before implementing:
//   1. Confirm current signup flow, base URL, and auth scheme from the
//      vendor — this one is API-key self-serve per public info, but verify.
//   2. Note this vendor is aimed at job-board/job-search products
//      specifically (same use case as TalentOS), so its normalized fields
//      may map unusually cleanly onto NormalizedJob — worth checking their
//      sample response against src/lib/jobSources/types.ts first.

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult } from "../types";

export const fantasticJobsAdapter: JobSourceAdapter = {
  id: "fantasticjobs",
  async fetchJobs(_params: JobSourceFetchParams, _credentials: string): Promise<JobSourceFetchResult> {
    throw new Error("fantasticJobsAdapter.fetchJobs is a stub — see comment at top of this file.");
  },
};
