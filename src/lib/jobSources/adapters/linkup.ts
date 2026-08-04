// src/lib/jobSources/adapters/linkup.ts
// LinkUp (getlinkup / LinkUp Technologies — the labor-market data company
// with direct-from-employer postings back to 2007, NOT the unrelated
// "linkupapi.com" LinkedIn-automation product of the same name — confirm
// you're talking to the right vendor before signing anything).
//
// STUB — do not enable until a dev has done this:
//   1. LinkUp is enterprise/contract-based, not a self-serve signup. There
//      is no public API-key page — this requires a sales conversation to
//      get: (a) an account rep, (b) actual API base URL + auth scheme,
//      (c) which delivery mechanism you're on (some clients get a REST API,
//      others get bulk SFTP/file drops instead).
//   2. Once you have real docs from your rep, replace this stub's fetchJobs
//      body with the real request/response shape — do NOT guess at it.
//   3. Update job_sources.credentials_ref and adapter_type (this may need
//      to be 'bulk_csv' instead of 'rest_api' if you're on file delivery).

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult } from "../types";

export const linkUpAdapter: JobSourceAdapter = {
  id: "linkup",

  async fetchJobs(_params: JobSourceFetchParams, _credentials: string): Promise<JobSourceFetchResult> {
    throw new Error(
      "linkupAdapter.fetchJobs is a stub — LinkUp requires an enterprise contract with " +
        "vendor-provided API docs. See the comment at the top of this file before implementing."
    );
  },
};
