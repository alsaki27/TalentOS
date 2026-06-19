// src/server/repositories/jobsRepository.ts
// Data-access abstraction for the jobs table.
// Implementation uses Supabase today; the interface is designed to be portable
// to Neon Postgres or any other SQL-compatible backend.
// Rule for future chunks: new feature routes should call this repository, not
// supabase.from("jobs") directly.

import { supabase } from "@/lib/supabase";

export interface JobRow {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  source: string | null;
  raw_description: string | null;
  parsed_description: Record<string, unknown> | null;
  ai_extracted_at: string | null;
  ai_confidence_score: number | null;
  employment_type: string | null;
  seniority_level: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: string | null;
  salary_range: string | null;
  notes: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface CreateJobInput {
  title: string | null;
  company?: string | null;
  location?: string | null;
  source?: string;
  source_url?: string | null;
  raw_description?: string | null;
  parsed_description?: Record<string, unknown> | null;
  ai_extracted_at?: string | null;
  ai_confidence_score?: number | null;
  employment_type?: string | null;
  seniority_level?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
  salary_range?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface DuplicateCheckInput {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  sourceUrl?: string | null;
}

export interface DuplicateCheckResult {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  matchType: "exact_url" | "exact_match" | "fuzzy";
  matchScore: number;
}

function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchKey(title: string, company?: string | null, location?: string | null): string {
  return `${normalizeForMatch(title)}|${normalizeForMatch(company)}|${normalizeForMatch(location)}`;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Find a job by its primary key.
 */
export async function findJobById(id: string): Promise<JobRow | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as JobRow;
}

/**
 * Create a new job row from parsed JD data.
 */
export async function createJobFromParsedJD(input: CreateJobInput): Promise<JobRow> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({
      title: input.title,
      company: input.company ?? null,
      location: input.location ?? null,
      source: input.source ?? "manual",
      source_url: input.source_url ?? null,
      raw_description: input.raw_description ?? null,
      parsed_description: input.parsed_description ?? null,
      ai_extracted_at: input.ai_extracted_at ?? null,
      ai_confidence_score: input.ai_confidence_score ?? null,
      employment_type: input.employment_type ?? null,
      seniority_level: input.seniority_level ?? null,
      salary_min: input.salary_min ?? null,
      salary_max: input.salary_max ?? null,
      salary_currency: input.salary_currency ?? null,
      salary_period: input.salary_period ?? null,
      salary_range: input.salary_range ?? null,
      notes: input.notes ?? null,
      is_active: input.is_active ?? true,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as JobRow;
}

/**
 * Three-pass duplicate detection for jobs.
 * 1. Exact source_url match
 * 2. Exact normalized title+company+location match
 * 3. Fuzzy Levenshtein match (title >= 0.90, company >= 0.86, location >= 0.86)
 */
export async function findPotentialDuplicateJobs(
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult[]> {
  const results: DuplicateCheckResult[] = [];

  // 1. Exact URL match
  if (input.sourceUrl) {
    const { data: urlMatches } = await supabase
      .from("jobs")
      .select("id, title, company, location, source_url")
      .eq("source_url", input.sourceUrl);
    if (urlMatches) {
      for (const job of urlMatches) {
        results.push({
          id: job.id as string,
          title: job.title as string,
          company: job.company ?? null,
          location: job.location ?? null,
          source_url: job.source_url ?? null,
          matchType: "exact_url",
          matchScore: 1.0,
        });
      }
    }
  }

  // 2. Exact normalized title+company+location match
  const nTitle = normalizeForMatch(input.title);
  const nCompany = normalizeForMatch(input.company);
  const nLocation = normalizeForMatch(input.location);

  if (nTitle && nCompany) {
    const { data: exactMatches } = await supabase
      .from("jobs")
      .select("id, title, company, location, source_url")
      .not("title", "is", null);

    if (exactMatches) {
      for (const job of exactMatches) {
        if (results.some((r) => r.id === job.id)) continue;
        const jobKey = matchKey(job.title ?? "", job.company, job.location);
        const inputKey = matchKey(input.title ?? "", input.company, input.location);
        if (jobKey === inputKey) {
          results.push({
            id: job.id as string,
            title: job.title as string,
            company: job.company ?? null,
            location: job.location ?? null,
            source_url: job.source_url ?? null,
            matchType: "exact_match",
            matchScore: 1.0,
          });
        }
      }
    }
  }

  // 3. Fuzzy match against all existing jobs
  if (nTitle && nCompany) {
    const { data: allJobs } = await supabase
      .from("jobs")
      .select("id, title, company, location, source_url")
      .not("title", "is", null);

    if (allJobs) {
      for (const job of allJobs) {
        if (results.some((r) => r.id === job.id)) continue;
        const existingTitle = normalizeForMatch(job.title);
        const existingCompany = normalizeForMatch(job.company);
        const existingLocation = normalizeForMatch(job.location);

        const titleSim = existingTitle ? similarity(nTitle, existingTitle) : 0;
        const companySim = nCompany && existingCompany ? similarity(nCompany, existingCompany) : 1;
        const locationSim = nLocation && existingLocation ? similarity(nLocation, existingLocation) : 1;

        const score = (titleSim + companySim + locationSim) / 3;

        if (titleSim >= 0.9 && companySim >= 0.86 && locationSim >= 0.86) {
          results.push({
            id: job.id as string,
            title: job.title as string,
            company: job.company ?? null,
            location: job.location ?? null,
            source_url: job.source_url ?? null,
            matchType: "fuzzy",
            matchScore: Math.round(score * 1000) / 1000,
          });
        }
      }
    }
  }

  return results.sort((a, b) => b.matchScore - a.matchScore);
}

/**
 * List all active jobs for listing/dedup purposes.
 * Minimal fields: id, title, company, location, source_url.
 */
export async function listJobsForDedupe(): Promise<
  Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">[]
> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, title, company, location, source_url")
    .not("title", "is", null)
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pick<JobRow, "id" | "title" | "company" | "location" | "source_url">[];
}
