// The single authoritative duplicate check for the jobs table, keyed on the
// apply-link fingerprint (see src/lib/jobUrlFingerprint.ts). Replaces the
// title/company/source_url checks previously scattered across ~13
// independent implementations (admin add-job form, Job CEO's matchmaker,
// the Apify importer, ATS/career-page/CSV bulk import, the browser
// extension, etc.) with one query every job-creation path goes through via
// jobsRepository.ts's createJob()/createJobs().
//
// Deliberately queries jobs directly (not through jobsRepository.ts) to
// avoid a circular import - jobsRepository's createJob/createJobs call this
// module, so this module cannot import back from jobsRepository.
//
// Checks against jobs from the last DUPLICATE_CHECK_WINDOW_DAYS only (not
// active-only - a duplicate of a deactivated/archived posting from within
// the window is still the same real-world job). Older postings are almost
// always expired by then and excluded on purpose - keeps the check cheap
// and precise as the table grows, instead of matching against years of
// dead listings.
const DUPLICATE_CHECK_WINDOW_DAYS = 15;

import { query, queryOne, execute } from "@/server/db/neon";
import { computeApplyLinkFingerprint } from "@/lib/jobUrlFingerprint";

export interface JobDuplicateCandidate {
  applyUrl?: string | null;
  sourceUrl?: string | null;
}

export interface JobDuplicateMatch {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  apply_url: string | null;
  source_url: string | null;
  source: string | null;
  created_at: string | null;
}

export type DuplicateCheckResult =
  | { isDuplicate: false; fingerprint: string | null }
  | { isDuplicate: true; fingerprint: string; existing: JobDuplicateMatch };

const MATCH_COLUMNS = "id, title, company, location, apply_url, source_url, source, created_at";

/**
 * Checks one candidate job against every job already in TalentOS by
 * apply-link fingerprint. A job with neither apply_url nor source_url
 * cannot be fingerprinted and is reported as not-a-duplicate here (no DB
 * call) - see docs/jobDuplicateNotify or the plan for why this is a
 * deliberate precision choice, not an oversight: matching on title/company
 * alone was explicitly rejected as unreliable.
 */
export async function checkJobDuplicate(candidate: JobDuplicateCandidate): Promise<DuplicateCheckResult> {
  const fingerprint = computeApplyLinkFingerprint({ applyUrl: candidate.applyUrl, sourceUrl: candidate.sourceUrl });
  if (!fingerprint) return { isDuplicate: false, fingerprint: null };

  const existing = await queryOne<JobDuplicateMatch>(
    `SELECT ${MATCH_COLUMNS} FROM jobs
     WHERE apply_link_fingerprint = $1 AND created_at >= NOW() - make_interval(days => $2)
     ORDER BY created_at ASC LIMIT 1`,
    [fingerprint, DUPLICATE_CHECK_WINDOW_DAYS]
  );
  if (!existing) return { isDuplicate: false, fingerprint };

  // A duplicate re-surfacing (e.g. a scraper re-crawling the same live
  // posting) is evidence the original is still live - bump its freshness
  // marker, preserving the behavior the older per-path checks
  // (updateJobsLastSeenAtByUrls) already provided before consolidation.
  await execute("UPDATE jobs SET last_seen_at = NOW() WHERE id = $1", [existing.id]).catch(() => {});

  return { isDuplicate: true, fingerprint, existing };
}

/**
 * Batch variant for bulk-import paths (ATS pulls, CSV/Excel import, Job CEO
 * batches) - one query for the whole batch instead of one per row.
 */
export async function checkJobDuplicatesBatch(
  candidates: JobDuplicateCandidate[]
): Promise<DuplicateCheckResult[]> {
  const fingerprints = candidates.map((c) => computeApplyLinkFingerprint({ applyUrl: c.applyUrl, sourceUrl: c.sourceUrl }));
  const uniqueFingerprints = [...new Set(fingerprints.filter((f): f is string => f !== null))];

  const existingByFingerprint = new Map<string, JobDuplicateMatch>();
  if (uniqueFingerprints.length > 0) {
    const rows = await query<JobDuplicateMatch & { apply_link_fingerprint: string }>(
      `SELECT ${MATCH_COLUMNS}, apply_link_fingerprint FROM jobs
       WHERE apply_link_fingerprint = ANY($1) AND created_at >= NOW() - make_interval(days => $2)
       ORDER BY created_at ASC`,
      [uniqueFingerprints, DUPLICATE_CHECK_WINDOW_DAYS]
    );
    for (const row of rows) {
      // ORDER BY created_at ASC + only-set-if-absent keeps the earliest
      // existing job as the canonical match, consistent with checkJobDuplicate.
      if (!existingByFingerprint.has(row.apply_link_fingerprint)) {
        existingByFingerprint.set(row.apply_link_fingerprint, row);
      }
    }
    const matchedIds = [...existingByFingerprint.values()].map((j) => j.id);
    if (matchedIds.length > 0) {
      await execute("UPDATE jobs SET last_seen_at = NOW() WHERE id = ANY($1)", [matchedIds]).catch(() => {});
    }
  }

  return fingerprints.map((fingerprint) => {
    if (!fingerprint) return { isDuplicate: false, fingerprint: null };
    const existing = existingByFingerprint.get(fingerprint);
    return existing
      ? { isDuplicate: true, fingerprint, existing }
      : { isDuplicate: false, fingerprint };
  });
}
