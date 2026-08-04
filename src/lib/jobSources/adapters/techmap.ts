// src/lib/jobSources/adapters/techmap.ts
// Techmap / jobdatafeeds.com — job data feeds + historical datasets back to
// 2020, ~6.7M new postings/month, priced at $1/1,000 jobs.
// https://jobdatafeeds.com/job-api
// STUB. Before implementing:
//   1. Confirm whether delivery is a pull API or a scheduled feed/file drop
//      — "data feeds" in their name suggests this may be closer to
//      adapter_type = 'bulk_csv' than 'rest_api', similar to how openjobdata
//      is ingested today via scripts/openjobdata_ingest.py rather than a
//      live API call. If so, model this adapter after that script's pattern
//      instead of a fetchJobs() HTTP call.
//   2. $1/1,000 records is cheap enough that this is a good volume-filler
//      once the pilot (TheirStack + LinkUp) proves the pipeline out.

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult } from "../types";

export const techmapAdapter: JobSourceAdapter = {
  id: "techmap",
  async fetchJobs(_params: JobSourceFetchParams, _credentials: string): Promise<JobSourceFetchResult> {
    throw new Error("techmapAdapter.fetchJobs is a stub — see comment at top of this file.");
  },
};
