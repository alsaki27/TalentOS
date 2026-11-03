import { queryOne } from "@/server/db/neon";
import { isSiteNameNotEmployer } from "@/lib/jobContentIdentity";

export interface CaptureJobRecord {
  id: string;
  title: string;
  company: string | null;
  is_active?: boolean | null;
  content_duplicate_of?: string | null;
  [key: string]: any;
}

/** Follow hidden duplicate records without treating a hidden copy as a closed posting. */
export async function resolveJobCaptureTarget(id: string) {
  const seen = new Set<string>();
  let job: CaptureJobRecord | null = null;
  let next: string | null = id;
  while (next && !seen.has(next) && seen.size < 20) {
    seen.add(next);
    const row: CaptureJobRecord | null = await queryOne<CaptureJobRecord>("SELECT * FROM jobs WHERE id = $1", [next]);
    if (!row) break;
    job = row;
    if (row.is_active !== false || !row.content_duplicate_of) break;
    next = row.content_duplicate_of;
  }
  return {
    job,
    jobStatus: {
      state: !job ? "missing" : job.is_active === false ? "inactive" : "active",
      requestedJobId: id,
      canonicalJobId: job?.id ?? null,
      redirected: !!job && job.id !== id,
      // is_active is an internal visibility flag, not a live availability check.
      sourceAvailability: "unverified",
    },
  };
}

export function cleanCapturedCompany(value: unknown, url: string, signals?: string[] | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const company = value.replace(/\s+/g, " ").trim();
  if (/^(home|sign in|log in|login|menu|jobs?|job search|search jobs|apply now|careers?|skip to (?:main )?content)$/i.test(company)) return null;
  if (isSiteNameNotEmployer(company, url, signals)) return null;
  try {
    const host = new URL(url).hostname;
    const board = host.match(/(?:^|\.)(indeed|glassdoor|linkedin|ziprecruiter|simplyhired|dice)\./i)?.[1];
    if (board && company.replace(/\W/g, "").toLowerCase() === board.toLowerCase()) return null;
  } catch { /* URL validation belongs to the caller. */ }
  return company;
}
