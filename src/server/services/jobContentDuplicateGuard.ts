// Cross-platform duplicate detection by job content (title + company),
// for postings that share no URL/ID at all across platforms - see
// src/lib/jobContentIdentity.ts for why exact-normalized title+company
// match is used, and why it alone is NOT enough to act on.
//
// This is deliberately NOT a hard insert-time block like jobDuplicateGuard.ts
// (the apply-link fingerprint check). A wrong content match here would mean
// silently discarding a real, distinct job forever - there is no URL/ID
// disagreement to fall back on to notice the mistake later, unlike a
// fingerprint collision which is definitionally exact. So the caller
// (jobsRepository.ts's createJob/createJobs) always inserts the row - this
// guard only tells it whether to also mark the new row is_active = false
// and point content_duplicate_of at the earlier posting, which is a fully
// reversible, auditable, non-destructive action: the row stays in the
// table, an admin can re-activate it with one UPDATE if this was wrong.
//
// Precision comes from requiring ALL of:
//   1. Exact match on normalized company + normalized title.
//   2. Exactly ONE other existing distinct posting (by apply_link_fingerprint)
//      shares that identity within the lookback window - two or more means
//      this employer demonstrably reuses the title across real distinct
//      requisitions (confirmed in production: Amazon, ABB - see module doc
//      in jobContentIdentity.ts) and this guard backs off entirely rather
//      than guess which one, if any, the new posting duplicates.
//   3. The two postings' locations are not an obvious mismatch (see
//      areLocationsCompatible - biased toward "compatible" on purpose).

import { query, execute } from "@/server/db/neon";
import { computeContentIdentityKey, areLocationsCompatible } from "@/lib/jobContentIdentity";

/**
 * Records a detected cross-platform duplicate pair in `job_duplicates` - a
 * table that already existed in the schema with exactly this shape
 * (canonical_job_id / duplicate_job_id / similarity_score / resolved) but
 * was never written to by any code path. It is the review trail for this
 * system: every automatic hide is listed here so it can be audited and
 * reversed, which is what makes acting automatically acceptable at all.
 *
 * Best-effort on purpose: failing to write the audit row must never fail
 * the job insert that already succeeded. A missing review row degrades
 * auditability, whereas a thrown error here would lose a real job.
 */
export async function recordDuplicateForReview(
  canonicalJobId: string,
  duplicateJobId: string,
  similarityScore: number
): Promise<void> {
  if (canonicalJobId === duplicateJobId) return;
  await execute(
    `INSERT INTO job_duplicates (canonical_job_id, duplicate_job_id, similarity_score, resolved)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (canonical_job_id, duplicate_job_id) DO NOTHING`,
    [canonicalJobId, duplicateJobId, similarityScore]
  ).catch((err) => {
    console.error("[jobContentDuplicateGuard] could not record duplicate for review:", (err as Error).message ?? String(err));
  });
}

/**
 * Confidence attached to a content-identity match. Not a fuzzy-similarity
 * number - this detector is an exact normalized match gated by group size,
 * so there is only one tier it can emit. It exists because
 * `job_duplicates.similarity_score` is NOT NULL and because a future
 * stronger/weaker signal should be distinguishable in the same queue.
 */
export const CONTENT_IDENTITY_MATCH_SCORE = 0.95;

// Same window as jobDuplicateGuard.ts's fingerprint check - a posting that
// is still the same "live" job is one both checks should agree on, and
// postings from that far back are almost always expired.
export const CONTENT_DUPLICATE_CHECK_WINDOW_DAYS = 15;

export interface ContentDuplicateMatch {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  apply_url: string | null;
  source_url: string | null;
  source: string | null;
  created_at: string | null;
}

export type ContentDuplicateCheckResult =
  | { isContentDuplicate: false; contentIdentityKey: string | null }
  | { isContentDuplicate: true; contentIdentityKey: string; existing: ContentDuplicateMatch };

export async function checkContentDuplicate(candidate: {
  title?: string | null;
  company?: string | null;
  location?: string | null;
}): Promise<ContentDuplicateCheckResult> {
  const contentIdentityKey = computeContentIdentityKey({ title: candidate.title, company: candidate.company });
  if (!contentIdentityKey) return { isContentDuplicate: false, contentIdentityKey: null };

  // Only rows that are themselves independently identifiable (have their
  // own apply-link fingerprint) count toward the group - otherwise two rows
  // with no URL at all would each look like "a distinct posting" purely for
  // lacking one.
  const rows = await query<ContentDuplicateMatch & { apply_link_fingerprint: string }>(
    `SELECT id, title, company, location, apply_url, source_url, source, created_at, apply_link_fingerprint
     FROM jobs
     WHERE content_identity_key = $1
       AND apply_link_fingerprint IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $2)
     ORDER BY created_at ASC`,
    [contentIdentityKey, CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
  );

  const distinctByFingerprint = new Map<string, ContentDuplicateMatch>();
  for (const row of rows) {
    if (!distinctByFingerprint.has(row.apply_link_fingerprint)) distinctByFingerprint.set(row.apply_link_fingerprint, row);
  }
  const distinctPostings = [...distinctByFingerprint.values()];

  if (distinctPostings.length !== 1) {
    // 0 -> nothing to match yet. 2+ -> this title+company is reused across
    // genuinely different requisitions; never guess which one to merge into.
    return { isContentDuplicate: false, contentIdentityKey };
  }

  const only = distinctPostings[0];
  if (!areLocationsCompatible(candidate.location, only.location)) {
    return { isContentDuplicate: false, contentIdentityKey };
  }

  return { isContentDuplicate: true, contentIdentityKey, existing: only };
}

/**
 * Batch variant for bulk-import paths - one query for the whole batch
 * instead of one per row. Does not resolve collisions BETWEEN rows in the
 * same batch (see the caller, jobsRepository.ts's createJobs, for why that
 * is an accepted, documented non-goal here) - only checks each row against
 * postings already committed to the table.
 */
export async function checkContentDuplicatesBatch(
  candidates: { title?: string | null; company?: string | null; location?: string | null }[]
): Promise<ContentDuplicateCheckResult[]> {
  const keys = candidates.map((c) => computeContentIdentityKey({ title: c.title, company: c.company }));
  const uniqueKeys = [...new Set(keys.filter((k): k is string => k !== null))];

  const byKey = new Map<string, Map<string, ContentDuplicateMatch>>();
  if (uniqueKeys.length > 0) {
    const rows = await query<ContentDuplicateMatch & { apply_link_fingerprint: string; content_identity_key: string }>(
      `SELECT id, title, company, location, apply_url, source_url, source, created_at, apply_link_fingerprint, content_identity_key
       FROM jobs
       WHERE content_identity_key = ANY($1)
         AND apply_link_fingerprint IS NOT NULL
         AND created_at >= NOW() - make_interval(days => $2)
       ORDER BY created_at ASC`,
      [uniqueKeys, CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
    );
    for (const row of rows) {
      if (!byKey.has(row.content_identity_key)) byKey.set(row.content_identity_key, new Map());
      const group = byKey.get(row.content_identity_key)!;
      if (!group.has(row.apply_link_fingerprint)) group.set(row.apply_link_fingerprint, row);
    }
  }

  return candidates.map((candidate, i) => {
    const contentIdentityKey = keys[i];
    if (!contentIdentityKey) return { isContentDuplicate: false, contentIdentityKey: null };

    const distinctPostings = [...(byKey.get(contentIdentityKey)?.values() ?? [])];
    if (distinctPostings.length !== 1) return { isContentDuplicate: false, contentIdentityKey };

    const only = distinctPostings[0];
    if (!areLocationsCompatible(candidate.location, only.location)) {
      return { isContentDuplicate: false, contentIdentityKey };
    }
    return { isContentDuplicate: true, contentIdentityKey, existing: only };
  });
}
