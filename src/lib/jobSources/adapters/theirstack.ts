// src/lib/jobSources/adapters/theirstack.ts
// TheirStack Jobs API adapter. Confirmed against public docs as of this
// writing: https://theirstack.com/en/docs/api-reference/jobs/search_jobs_v1
//   - POST https://api.theirstack.com/v1/jobs/search
//   - Auth: Authorization: Bearer <api_key>
//   - Rate limit: 4 requests/second — respect this in the dispatcher, not here.
//   - Billing: 1 credit per job returned (i.e. cap `limit` deliberately).
//   - Request must include at least one of: posted_at_max_age_days,
//     posted_at_gte, posted_at_lte, company_domain_or, company_linkedin_url_or,
//     company_name_or — we always send posted_at_max_age_days.
//
// VERIFY BEFORE PRODUCTION: re-check the current field list against
// https://api.theirstack.com/ (OpenAPI spec) — TheirStack's schema has
// changed in prior product updates and this adapter was written from docs
// review, not a live test call with a real API key.

import type { JobSourceAdapter, JobSourceFetchParams, JobSourceFetchResult, NormalizedJob } from "../types";

const BASE_URL = "https://api.theirstack.com/v1/jobs/search";

// Response shape per TheirStack's documented schema — adjust field names
// here first if a live test call comes back different.
interface TheirStackJob {
  job_title: string;
  company_object?: { name?: string; domain?: string; industry?: string };
  location?: string;
  country_code?: string;
  remote?: boolean;
  employment_statuses?: string[];
  date_posted?: string;
  url?: string;
  final_url?: string;
  id?: string | number;
  description?: string;
  salary_string?: string;
  min_salary?: number;
  max_salary?: number;
}

interface TheirStackSearchResponse {
  data: TheirStackJob[];
  metadata?: { total_results?: number };
}

function normalize(raw: TheirStackJob): NormalizedJob {
  return {
    title: raw.job_title ?? "",
    company: raw.company_object?.name ?? null,
    companyWebsite: raw.company_object?.domain ? `https://${raw.company_object.domain}` : null,
    industry: raw.company_object?.industry ?? null,
    location: raw.location ?? null,
    country: raw.country_code ?? null,
    employmentType: raw.employment_statuses?.[0] ?? null,
    isRemote: raw.remote ?? null,
    postedAt: raw.date_posted ?? null,
    applyUrl: raw.final_url ?? raw.url ?? null,
    sourceUrl: raw.url ?? null,
    externalJobId: raw.id != null ? String(raw.id) : null,
    descriptionText: raw.description ?? null,
    salaryMin: raw.min_salary ?? null,
    salaryMax: raw.max_salary ?? null,
    salaryRange: raw.salary_string ?? null,
  };
}

export const theirStackAdapter: JobSourceAdapter = {
  id: "theirstack",

  async fetchJobs(params: JobSourceFetchParams, apiKey: string): Promise<JobSourceFetchResult> {
    const limit = Math.max(1, Math.min(params.maxResults, 500));

    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        job_title_or: params.queries,
        job_country_code_or: ["US"],
        posted_at_max_age_days: params.postedWithinDays,
        limit,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`TheirStack API error (${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as TheirStackSearchResponse;
    const jobs = (data.data ?? []).map(normalize);

    return {
      jobs,
      recordsFetched: jobs.length,
      // 1 credit per job returned; convert credits->USD once you know your
      // plan's $/credit rate and set job_sources.cost_per_record_usd instead
      // of hardcoding it here.
      estimatedCostUsd: 0,
    };
  },
};
