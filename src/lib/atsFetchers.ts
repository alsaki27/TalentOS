// src/lib/atsFetchers.ts
// Pulls live job postings from public, no-auth ATS job-board APIs and normalizes
// them onto the same JobRow shape used by the LinkedIn mapper.

import { JobRow } from "@/lib/linkedinMapper";

export async function fetchGreenhouseJobs(boardToken: string): Promise<JobRow[]> {
  const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs?content=true`);
  if (!res.ok) throw new Error(`Greenhouse board "${boardToken}" not found`);
  const data = await res.json();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs
    .filter((j: any) => j.title)
    .map((j: any) => ({
      title: j.title,
      company: boardToken,
      location: j.location?.name ?? null,
      source: "greenhouse",
      source_url: j.absolute_url ?? null,
      seniority_level: null,
      employment_type: null,
      applicants_count: null,
      company_employees_count: null,
      company_website: null,
      posted_at: j.updated_at ? j.updated_at.slice(0, 10) : null,
    }));
}

export async function fetchLeverJobs(company: string): Promise<JobRow[]> {
  const res = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json`);
  if (!res.ok) throw new Error(`Lever company "${company}" not found`);
  const data = await res.json();
  const postings = Array.isArray(data) ? data : [];

  return postings
    .filter((p: any) => p.text)
    .map((p: any) => ({
      title: p.text,
      company,
      location: p.categories?.location ?? null,
      source: "lever",
      source_url: p.hostedUrl ?? null,
      seniority_level: null,
      employment_type: p.categories?.commitment ?? null,
      applicants_count: null,
      company_employees_count: null,
      company_website: null,
      posted_at: p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : null,
    }));
}

export async function fetchAshbyJobs(boardName: string): Promise<JobRow[]> {
  const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${boardName}`);
  if (!res.ok) throw new Error(`Ashby board "${boardName}" not found`);
  const data = await res.json();
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];

  return jobs
    .filter((j: any) => j.title)
    .map((j: any) => ({
      title: j.title,
      company: boardName,
      location: j.location ?? null,
      source: "ashby",
      source_url: j.jobUrl ?? null,
      seniority_level: null,
      employment_type: j.employmentType ?? null,
      applicants_count: null,
      company_employees_count: null,
      company_website: null,
      posted_at: j.publishedDate ? j.publishedDate.slice(0, 10) : null,
    }));
}

export async function fetchAtsJobs(provider: "greenhouse" | "lever" | "ashby", token: string): Promise<JobRow[]> {
  switch (provider) {
    case "greenhouse": return fetchGreenhouseJobs(token);
    case "lever": return fetchLeverJobs(token);
    case "ashby": return fetchAshbyJobs(token);
  }
}
