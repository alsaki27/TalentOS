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
//   1. An exact match on the content identity key - normalized company +
//      normalized title + location bucket (see jobContentIdentity.ts, which
//      documents why the location belongs in the key and the live data that
//      proved it).
//   2. Exactly ONE existing distinct posting (by apply_link_fingerprint)
//      under that identity. Two or more means several real requisitions share
//      one company+title+city and nothing in the content can say which this
//      duplicates, so the guard refuses to act.
//   3. The candidate and the match are NOT on the same platform. Two ids on
//      one platform is that platform asserting they are different postings,
//      and that assertion is never overridden here.

import { query, execute } from "@/server/db/neon";
import {
  computeContentIdentityKey,
  computeTitleLocationKey,
  companyNameAppearsInText,
} from "@/lib/jobContentIdentity";
import { extractPlatformNamespace } from "@/lib/jobUrlFingerprint";

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

export interface ContentDuplicateCandidate {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  /** The posting's url - lets a site name masquerading as the employer be rejected. */
  url?: string | null;
  /** The posting's description, used only to corroborate a fallback-path match. */
  descriptionText?: string | null;
  /**
   * The candidate's own apply-link fingerprint. Used only to establish which
   * PLATFORM it came from - see resolveMatch for why a same-platform match is
   * always refused.
   */
  fingerprint?: string | null;
}

/**
 * Decides whether a candidate matches exactly one existing posting under the
 * same content identity, applying the two precision rules that cannot be
 * expressed in the identity key itself.
 */
function resolveMatch(
  candidate: ContentDuplicateCandidate,
  contentIdentityKey: string,
  rows: (ContentDuplicateMatch & { apply_link_fingerprint: string })[]
): ContentDuplicateCheckResult {
  // Collapse to DISTINCT existing postings. Several rows can share one
  // fingerprint (the same posting captured twice); that is one posting.
  const distinctByFingerprint = new Map<string, ContentDuplicateMatch & { apply_link_fingerprint: string }>();
  for (const row of rows) {
    if (!distinctByFingerprint.has(row.apply_link_fingerprint)) distinctByFingerprint.set(row.apply_link_fingerprint, row);
  }
  const distinctPostings = [...distinctByFingerprint.values()];

  // RULE 1 - exactly one candidate to match, or refuse.
  //   0  -> nothing to match yet.
  //   2+ -> several distinct requisitions share this company+title+city (real:
  //         3 ABB "Senior Field Service Technician" reqs in Bland, VA). Nothing
  //         in the content can say which one, if any, this posting duplicates,
  //         so the only correct action is none.
  if (distinctPostings.length !== 1) return { isContentDuplicate: false, contentIdentityKey };

  const only = distinctPostings[0];

  // RULE 2 - never contradict the platform. If the existing posting and this
  // candidate come from the SAME platform yet carry different fingerprints,
  // then that platform has issued two different job ids for them, which is the
  // platform itself asserting they are two different postings. That assertion
  // is authoritative and a content match must not override it. Real example
  // this rule rejects: two Indeed postings for "Information Technology Support
  // Technician" @ Prairieland FS with different jk values.
  const candidateNamespace = extractPlatformNamespace(candidate.fingerprint);
  const existingNamespace = extractPlatformNamespace(only.apply_link_fingerprint);
  if (candidateNamespace && existingNamespace && candidateNamespace === existingNamespace) {
    return { isContentDuplicate: false, contentIdentityKey };
  }

  return { isContentDuplicate: true, contentIdentityKey, existing: only };
}

export async function checkContentDuplicate(
  candidate: ContentDuplicateCandidate
): Promise<ContentDuplicateCheckResult> {
  const contentIdentityKey = computeContentIdentityKey({
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    url: candidate.url,
  });
  if (!contentIdentityKey) return checkTitleLocationFallback(candidate);

  // Only rows that are themselves independently identifiable (have their own
  // apply-link fingerprint) count toward the group - otherwise two rows with
  // no URL at all would each look like "a distinct posting" purely for
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

  return resolveMatch(candidate, contentIdentityKey, rows);
}

/**
 * Fallback path for captures whose employer name is unusable - absent, or the
 * scraping site's own name (see isSiteNameNotEmployer). Matches on title +
 * location bucket, then demands independent corroboration before believing it:
 * the matched posting's employer name must literally appear in THIS posting's
 * description text.
 *
 * That corroboration is what keeps the weaker key precise. The real case it
 * resolves: a GuidePoint Security posting captured from Indeed arrives with
 * company "Indeed.com", but its description opens "GuidePoint Security provides
 * trusted cybersecurity expertise..." - so the LinkedIn row's employer name is
 * right there in the text, and the two are provably the same posting. Two
 * genuinely different employers hiring the same title in the same city do not
 * name each other in their descriptions, so they stay separate.
 */
async function checkTitleLocationFallback(
  candidate: ContentDuplicateCandidate
): Promise<ContentDuplicateCheckResult> {
  const titleLocationKey = computeTitleLocationKey({ title: candidate.title, location: candidate.location });
  if (!titleLocationKey || !candidate.descriptionText) {
    return { isContentDuplicate: false, contentIdentityKey: null };
  }

  const rows = await query<ContentDuplicateMatch & { apply_link_fingerprint: string }>(
    `SELECT id, title, company, location, apply_url, source_url, source, created_at, apply_link_fingerprint
     FROM jobs
     WHERE title_location_key = $1
       AND apply_link_fingerprint IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $2)
     ORDER BY created_at ASC`,
    [titleLocationKey, CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
  );

  // Only postings whose OWN employer name is trustworthy can corroborate, and
  // that name has to appear in this posting's description.
  const corroborated = rows.filter((row) => companyNameAppearsInText(row.company, candidate.descriptionText));
  const outcome = resolveMatch(candidate, titleLocationKey, corroborated);
  // The fallback never claims the primary identity key; that column stays null
  // for this row precisely because its company is unusable.
  return outcome.isContentDuplicate
    ? { isContentDuplicate: true, contentIdentityKey: outcome.contentIdentityKey, existing: outcome.existing }
    : { isContentDuplicate: false, contentIdentityKey: null };
}

/**
 * Batch variant for bulk-import paths - one query for the whole batch
 * instead of one per row. Does not resolve collisions BETWEEN rows in the
 * same batch (see the caller, jobsRepository.ts's createJobs, for why that
 * is an accepted, documented non-goal here) - only checks each row against
 * postings already committed to the table.
 */
export async function checkContentDuplicatesBatch(
  candidates: ContentDuplicateCandidate[]
): Promise<ContentDuplicateCheckResult[]> {
  const keys = candidates.map((c) =>
    computeContentIdentityKey({ title: c.title, company: c.company, location: c.location })
  );
  const uniqueKeys = [...new Set(keys.filter((k): k is string => k !== null))];

  const byKey = new Map<string, (ContentDuplicateMatch & { apply_link_fingerprint: string })[]>();
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
      if (!byKey.has(row.content_identity_key)) byKey.set(row.content_identity_key, []);
      byKey.get(row.content_identity_key)!.push(row);
    }
  }

  // Same decision function as the single-row path, so the two can never drift
  // apart on which matches are considered safe.
  return candidates.map((candidate, i) => {
    const contentIdentityKey = keys[i];
    if (!contentIdentityKey) return { isContentDuplicate: false, contentIdentityKey: null };
    return resolveMatch(candidate, contentIdentityKey, byKey.get(contentIdentityKey) ?? []);
  });
}

