// src/lib/jobDedup.ts
// Prevents duplicate job rows when re-importing from any source (CSV, LinkedIn, ATS).
// Matches first on source_url, then on title + company + posted_at + applicants_count.

import { supabase } from "@/lib/supabase";
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
  const applicants = row.applicants_count;

  if (!title || !company || !postedAt || applicants === null || applicants === undefined || !Number.isFinite(applicants)) {
    return null;
  }

  return `${title}|${company}|${postedAt}|${applicants}`;
}

export async function filterNewJobs<T extends DedupeCandidate>(
  rows: T[]
): Promise<{ newRows: T[]; duplicates: number }> {
  const urls = rows.map((r) => r.source_url).filter((u): u is string => !!u);
  const { data: existingByUrl } = urls.length > 0 ? await supabase
    .from("jobs")
    .select("source_url")
    .in("source_url", urls) : { data: [] };

  const existingUrls = new Set((existingByUrl ?? []).map((j) => j.source_url as string));

  if (existingUrls.size > 0) {
    await supabase
      .from("jobs")
      .update({ last_seen_at: new Date().toISOString() })
      .in("source_url", Array.from(existingUrls));
  }

  const incomingSignatures = rows.map(jobDuplicateSignature).filter((key): key is string => !!key);
  const { data: existingJobs } = incomingSignatures.length > 0 ? await supabase
    .from("jobs")
    .select("title, company, posted_at, applicants_count")
    .not("posted_at", "is", null)
    .not("applicants_count", "is", null) : { data: [] };

  const existingSignatures = new Set(
    (existingJobs ?? [])
      .map((job) => jobDuplicateSignature(job))
      .filter((key): key is string => !!key)
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
  const { data: existing } = await supabase
    .from("jobs")
    .select("id, source_url")
    .in("source_url", urls);

  const existingByUrl = new Map((existing ?? []).map((j) => [j.source_url as string, j.id as string]));
  const existingUrls = new Set(existingByUrl.keys());
  let updated = 0;
  const syncedRows: Array<T & { id: string }> = [];

  for (const row of rowsWithUrl) {
    if (!row.source_url || !existingUrls.has(row.source_url)) continue;

    const updates: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || key === "created_at") continue;
      if (value !== null && value !== undefined && value !== "") updates[key] = value;
    }

    const { error } = await supabase
      .from("jobs")
      .update(updates)
      .eq("source_url", row.source_url);
    if (!error) {
      updated++;
      const id = existingByUrl.get(row.source_url);
      if (id) syncedRows.push({ ...row, id });
    }
  }

  if (syncedRows.length > 0) await syncCompanyDirectoryFromJobs(syncedRows);
  return updated;
}

function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeDateForMatch(s: string | null | undefined): string {
  const t = s?.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const parsed = new Date(t);
  return isNaN(parsed.getTime()) ? t : parsed.toISOString().slice(0, 10);
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

  const { data: existingJobs } = await supabase.from("jobs").select("title, company, location");
  const existing = existingJobs ?? [];
  const existingKeys = new Set(existing.map((j) => matchKey(j.title, j.company, j.location)));
  const acceptedKeys = new Set<string>();

  const newWithoutUrl = withoutUrl.filter((r) => {
    const key = matchKey(r.title, r.company, r.location);
    if (existingKeys.has(key) || acceptedKeys.has(key)) return false;
    if (existing.some((j) => fuzzyJobMatch(r, j))) return false;
    acceptedKeys.add(key);
    return true;
  });
  const fuzzyDuplicates = withoutUrl.length - newWithoutUrl.length;

  return {
    newRows: [...newWithUrl, ...newWithoutUrl],
    duplicates: urlDuplicates + fuzzyDuplicates,
  };
}
