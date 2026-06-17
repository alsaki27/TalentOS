// src/lib/linkedinMapper.ts
// Maps raw LinkedIn jobs-scraper output (camelCase) onto the jobs table row shape (snake_case).

import { categorizeJob } from "@/lib/jobCategorizer";

export interface LinkedInScrapedJob {
  id?: string;
  trackingId?: string;
  refId?: string;
  title?: string;
  companyName?: string;
  companyLinkedinUrl?: string;
  companyLogo?: string;
  location?: string;
  link?: string;
  applyUrl?: string;
  salary?: string;
  postedAt?: string;
  benefits?: unknown;
  descriptionHtml?: string;
  descriptionText?: string;
  seniorityLevel?: string;
  employmentType?: string;
  jobFunction?: string;
  industries?: string;
  inputUrl?: string;
  companyAddress?: unknown;
  companySlogan?: string;
  companyDescription?: string;
  applicantsCount?: string | number;
  companyWebsite?: string;
  companyEmployeesCount?: string | number;
  jobPosterName?: string;
  jobPosterTitle?: string;
  jobPosterProfileUrl?: string;
  jobPosterPhoto?: string;
  [key: string]: unknown;
}

export interface JobRow {
  title: string;
  company: string | null;
  location: string | null;
  source: string;
  source_url: string | null;
  seniority_level: string | null;
  employment_type: string | null;
  applicants_count: number | null;
  company_employees_count: number | null;
  company_website: string | null;
  posted_at: string | null;
  external_job_id?: string | null;
  tracking_id?: string | null;
  ref_id?: string | null;
  apply_url?: string | null;
  description_html?: string | null;
  description_text?: string | null;
  benefits?: unknown;
  job_function?: string | null;
  industries?: string | null;
  input_url?: string | null;
  company_linkedin_url?: string | null;
  company_logo_url?: string | null;
  company_address?: unknown;
  company_slogan?: string | null;
  company_description?: string | null;
  job_poster_name?: string | null;
  job_poster_title?: string | null;
  job_poster_profile_url?: string | null;
  job_poster_photo_url?: string | null;
  raw_source_payload?: LinkedInScrapedJob;
  job_category?: string | null;
  category_tags?: string[];
  category_relevance_score?: number | null;
}

function toInt(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function mapLinkedInJob(raw: LinkedInScrapedJob): JobRow | null {
  if (!raw.title || !raw.title.trim()) return null;
  const category = categorizeJob([
    raw.title,
    raw.descriptionText,
    raw.jobFunction,
    raw.industries,
    raw.companyDescription,
  ]);

  return {
    title: raw.title.trim(),
    company: raw.companyName?.trim() || null,
    location: raw.location?.trim() || null,
    source: "linkedin",
    source_url: raw.link?.trim() || null,
    seniority_level: raw.seniorityLevel?.trim() || null,
    employment_type: raw.employmentType?.trim() || null,
    applicants_count: toInt(raw.applicantsCount),
    company_employees_count: toInt(raw.companyEmployeesCount),
    company_website: raw.companyWebsite?.trim() || null,
    posted_at: raw.postedAt?.trim() || null,
    external_job_id: raw.id?.trim() || null,
    tracking_id: raw.trackingId?.trim() || null,
    ref_id: raw.refId?.trim() || null,
    apply_url: raw.applyUrl?.trim() || null,
    description_html: raw.descriptionHtml?.trim() || null,
    description_text: raw.descriptionText?.trim() || null,
    benefits: raw.benefits ?? null,
    job_function: raw.jobFunction?.trim() || null,
    industries: raw.industries?.trim() || null,
    input_url: raw.inputUrl?.trim() || null,
    company_linkedin_url: raw.companyLinkedinUrl?.trim() || null,
    company_logo_url: raw.companyLogo?.trim() || null,
    company_address: raw.companyAddress ?? null,
    company_slogan: raw.companySlogan?.trim() || null,
    company_description: raw.companyDescription?.trim() || null,
    job_poster_name: raw.jobPosterName?.trim() || null,
    job_poster_title: raw.jobPosterTitle?.trim() || null,
    job_poster_profile_url: raw.jobPosterProfileUrl?.trim() || null,
    job_poster_photo_url: raw.jobPosterPhoto?.trim() || null,
    raw_source_payload: raw,
    ...category,
  };
}
