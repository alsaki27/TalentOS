// src/lib/jobDedup.ts
// Prevents duplicate job rows when re-importing from any source (CSV, LinkedIn, ATS).
// Matches first on source_url, then on title + company + posted_at + applicants_count.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";
import {
  findJobsBySourceUrls,
  updateJobsLastSeenAtByUrls,
  findJobsForSignatureDedupe,
  findJobsBySourceUrlWithId,
  findPotentialDuplicateJobs as findPotentialDuplicateJobsRepo,
  listAllJobsForFuzzyDedupe,
} from "@/server/repositories/jobsRepository";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";

type DedupeCandidate = {
  source_url?: string | null;
  title?: string | null;
  company?: string | null;
  posted_at?: string | null;
  applicants_count?: number | null;
};

export function jobDuplicateSignature(row: DedupeCandidate): string | null {
  const title = normalizeForMatch(row.title);
  const company = normalizeForMatch(row.company);
  const postedAt = normalizeDateForMatch(row.posted_at);
  const applicants = toFiniteNumber(row.applicants_count);

  if (!title || !company || !postedAt || applicants === null) {
    return null;
  }

  return `${title}|${company}|${postedAt}|${applicants}`;
}

export async function filterNewJobs<T extends DedupeCandidate>(
  rows: T[]
): Promise<{ newRows: T[]; duplicates: number }> {
  const urls = rows.map((r) => r.source_url).filter((u): u is string => !!u);
  const existingByUrl = urls.length > 0 ? await findJobsBySourceUrls(urls) : [];

  const existingUrls = new Set((existingByUrl ?? []).map((j: any) => j.source_url as string));

  if (existingUrls.size > 0) {
    await updateJobsLastSeenAtByUrls(Array.from(existingUrls));
  }

  const incomingSignatures = rows.map(jobDuplicateSignature).filter((key): key is string => !!key);
  const existingJobs = incomingSignatures.length > 0 ? await findJobsForSignatureDedupe() : [];

  const existingSignatures = new Set(
    (existingJobs ?? [])
      .map((job: any) => jobDuplicateSignature(job))
      .filter((key: any): key is string => !!key)
  );
  const acceptedSignatures = new Set<string>();

  const newRows = rows.filter((r) => {
    if (r.source_url && existingUrls.has(r.source_url)) return false;

    const signature = jobDuplicateSignature(r);
    if (!signature) return true;
    if (existingSignatures.has(signature) || acceptedSignatures.has(signature)) return false;

    acceptedSignatures.add(signature);
    return true;
  });
  return { newRows, duplicates: rows.length - newRows.length };
}

export async function enrichExistingJobsBySourceUrl<T extends { source_url?: string | null }>(
  rows: T[]
): Promise<number> {
  const rowsWithUrl = rows.filter((r) => r.source_url);
  if (rowsWithUrl.length === 0) return 0;

  const urls = rowsWithUrl.map((r) => r.source_url).filter((u): u is string => !!u);
  const existing = await findJobsBySourceUrlWithId(urls);

  const existingByUrl = new Map((existing ?? []).map((j: any) => [j.source_url as string, j.id as string]));
  const existingUrls = new Set(existingByUrl.keys());
  let updated = 0;
  const syncedRows: Array<T & { id: string }> = [];

  for (const row of rowsWithUrl) {
    if (!row.source_url || !existingUrls.has(row.source_url)) continue;
    const id = existingByUrl.get(row.source_url) as string | undefined;
    if (id) syncedRows.push({ ...row, id });
  }

  if (existingUrls.size > 0) {
    await updateJobsLastSeenAtByUrls(Array.from(existingUrls));
    updated = existingUrls.size;
  }

  if (syncedRows.length > 0) await syncCompanyDirectoryFromJobs(syncedRows);
  return updated;
}

function normalizeForMatch(s: unknown): string {
  const str = typeof s === "string" ? s : String(s ?? "");
  return str.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeDateForMatch(s: unknown): string {
  if (s instanceof Date) {
    return isNaN(s.getTime()) ? "" : s.toISOString().slice(0, 10);
  }
  if (typeof s === "number") {
    const d = new Date(s);
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const t = typeof s === "string" ? s.trim() : String(s ?? "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const parsed = new Date(t);
  return isNaN(parsed.getTime()) ? t : parsed.toISOString().slice(0, 10);
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function matchKey(title: unknown, company?: unknown, location?: unknown): string {
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

function fieldMatches(a: string, b: string, threshold = 0.88): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b || similarity(a, b) >= threshold;
}

function fuzzyJobMatch(
  row: { title: string; company?: string | null; location?: string | null },
  existing: { title: string; company?: string | null; location?: string | null }
): boolean {
  const title = normalizeForMatch(row.title);
  const existingTitle = normalizeForMatch(existing.title);
  const company = normalizeForMatch(row.company);
  const existingCompany = normalizeForMatch(existing.company);
  const location = normalizeForMatch(row.location);
  const existingLocation = normalizeForMatch(existing.location);

  return (
    fieldMatches(title, existingTitle, 0.9) &&
    fieldMatches(company, existingCompany, 0.86) &&
    fieldMatches(location, existingLocation, 0.86)
  );
}

interface DuplicateCheckInput {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  sourceUrl?: string | null;
}

interface DuplicateCheckResult {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  source_url: string | null;
  matchType: "exact_url" | "exact_match" | "fuzzy";
  matchScore: number;
}

export async function findPotentialDuplicateJobs(
  input: DuplicateCheckInput
): Promise<DuplicateCheckResult[]> {
  return findPotentialDuplicateJobsRepo(input);
}

// Used only by the normalizer pipeline (src/lib/normalizer), where rows commonly have no
// source_url to dedupe on. Falls back to a normalized title+company+location match for
// those rows. This is normalized-exact rather than true edit-distance fuzzy matching —
// comparing every new row against every existing job with Levenshtein would be expensive
// at current data volumes (1000+ jobs); revisit if real near-duplicates slip through.
export async function filterNewJobsWithFuzzyFallback<
  T extends { source_url?: string | null; title: string; company?: string | null; location?: string | null }
>(rows: T[]): Promise<{ newRows: T[]; duplicates: number }> {
  const withUrl = rows.filter((r) => r.source_url);
  const withoutUrl = rows.filter((r) => !r.source_url);

  const { newRows: newWithUrl, duplicates: urlDuplicates } = await filterNewJobs(withUrl);

  if (withoutUrl.length === 0) {
    return { newRows: newWithUrl, duplicates: urlDuplicates };
  }

  const existingJobs = await listAllJobsForFuzzyDedupe();
  const existing = existingJobs ?? [];
  const existingKeys = new Set(existing.map((j: any) => matchKey(j.title as string, j.company as string, j.location as string)));
  const acceptedKeys = new Set<string>();

  const newWithoutUrl = withoutUrl.filter((r: any) => {
    const key = matchKey(r.title, r.company, r.location);
    if (existingKeys.has(key) || acceptedKeys.has(key)) return false;
    if (existing.some((j: any) => fuzzyJobMatch(r, j))) return false;
    acceptedKeys.add(key);
    return true;
  });
  const fuzzyDuplicates = withoutUrl.length - newWithoutUrl.length;

  return {
    newRows: [...newWithUrl, ...newWithoutUrl],
    duplicates: urlDuplicates + fuzzyDuplicates,
  };
}
