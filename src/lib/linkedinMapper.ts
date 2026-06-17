// src/lib/linkedinMapper.ts
// Maps raw LinkedIn jobs-scraper output (camelCase) onto the jobs table row shape (snake_case).

export interface LinkedInScrapedJob {
  title?: string;
  companyName?: string;
  location?: string;
  link?: string;
  postedAt?: string;
  seniorityLevel?: string;
  employmentType?: string;
  applicantsCount?: string | number;
  companyWebsite?: string;
  companyEmployeesCount?: string | number;
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
}

function toInt(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseInt(value.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

export function mapLinkedInJob(raw: LinkedInScrapedJob): JobRow | null {
  if (!raw.title || !raw.title.trim()) return null;

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
  };
}
