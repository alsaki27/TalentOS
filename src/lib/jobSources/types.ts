// src/lib/jobSources/types.ts
// Canonical shape every job-source adapter must normalize into. This is
// intentionally the same field set as OpenJobDataIngestJob
// (src/app/api/job-agent/openjobdata-ingest/route.ts) — that contract
// already flows cleanly through insertStagedJobs -> classifyJob ->
// jobAgentImporter, so new sources reuse it instead of inventing a new shape.

export interface NormalizedJob {
  title: string;
  company: string | null;
  companyWebsite: string | null;
  industry: string | null;
  location: string | null;
  country: string | null;
  employmentType: string | null;
  isRemote: boolean | null;
  postedAt: string | null; // "YYYY-MM-DD"
  applyUrl: string | null;
  sourceUrl: string | null;
  externalJobId: string | null;
  descriptionText: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryRange: string | null;
}

export interface JobSourceFetchParams {
  /** Free-text role queries, e.g. from jobAgentRoleLibrary's role groups. */
  queries: string[];
  roleGroup: string;
  roleGroupLabel: string;
  maxResults: number;
  /** How far back to look, in days. */
  postedWithinDays: number;
}

export interface JobSourceFetchResult {
  jobs: NormalizedJob[];
  recordsFetched: number;
  estimatedCostUsd: number;
}

export interface JobSourceAdapter {
  /** Matches job_sources.id in sql/neon_fixes/043_job_sources.sql */
  id: string;
  fetchJobs(params: JobSourceFetchParams, credentials: string): Promise<JobSourceFetchResult>;
}
