// Cross-platform duplicate detection by job CONTENT, for postings that share no
// URL or id across platforms - see src/lib/jobContentIdentity.ts for the live
// evidence behind the identity key and why exact normalized matching (never
// fuzzy) is what keeps it precise.
//
// This is deliberately NOT a hard insert-time block like jobDuplicateGuard.ts.
// A wrong content match would silently discard a real, distinct job forever,
// with no URL/id disagreement to notice the mistake by later - unlike a
// fingerprint or requisition-id collision, which is exact by construction. So
// the caller (jobsRepository.ts) always inserts the row; this guard only says
// whether to also mark it is_active = false with content_duplicate_of pointing
// at the earlier posting. That is fully reversible and auditable: the row stays
// in the table and one UPDATE restores it.
//
// Precision comes from requiring ALL of:
//   1. An exact match on the content identity key - normalized company +
//      normalized title + location bucket (jobContentIdentity.ts documents why
//      the location belongs in the key and the data that proved it).
//   2. Exactly ONE existing distinct posting under that identity. Two or more
//      means several real requisitions share one company+title+city and nothing
//      in the content can say which this duplicates, so the guard refuses.
//   3. The candidate and the match are NOT on the same platform. Two ids on one
//      platform is that platform asserting they are different postings, and that
//      assertion is never overridden here.
//
// Captures whose employer name is unusable (the scraping site's own name) have
// no primary key at all and are resolved through a separate, weaker fallback
// path that demands independent corroboration - see checkTitleLocationFallback.

import { query, execute } from "@/server/db/neon";
import {
  computeContentIdentityKey,
  computeTitleLocationKey,
  companyNameAppearsInText,
} from "@/lib/jobContentIdentity";
import { extractPlatformNamespace } from "@/lib/jobUrlFingerprint";

/**
 * Records a detected duplicate pair in `job_duplicates` - a table that already
 * existed in the schema with exactly this shape (canonical_job_id /
 * duplicate_job_id / similarity_score / resolved) but was never written to by
 * any code path. It is the review trail for this system: every automatic hide is
 * listed here so it can be audited and reversed, which is what makes acting
 * automatically acceptable at all.
 *
 * Best-effort on purpose: failing to write the audit row must never fail a job
 * insert that already succeeded. A missing review row degrades auditability,
 * whereas throwing here would lose a real job.
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
 * Confidence recorded on a match. Not a fuzzy-similarity number - this detector
 * is an exact normalized match under a gate, so it emits one of two tiers. They
 * exist because job_duplicates.similarity_score is NOT NULL and because the
 * weaker fallback path should be distinguishable in the queue.
 */
export const CONTENT_IDENTITY_MATCH_SCORE = 0.95;
export const TITLE_LOCATION_MATCH_SCORE = 0.85;

// Same window as jobDuplicateGuard.ts's checks - a posting that is still the
// same live job is one every layer should agree on, and postings older than this
// are almost always expired.
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
  | { isContentDuplicate: false; contentIdentityKey: string | null; titleLocationKey: string | null }
  | {
      isContentDuplicate: true;
      contentIdentityKey: string | null;
      titleLocationKey: string | null;
      existing: ContentDuplicateMatch;
      score: number;
    };

export interface ContentDuplicateCandidate {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  /** The posting's url - lets a site name masquerading as the employer be rejected. */
  url?: string | null;
  /** The extension's provenance signals for the extracted company, when present. */
  signals?: string[] | null;
  isRemote?: boolean | null;
  /** The posting's description, used only to corroborate a fallback-path match. */
  descriptionText?: string | null;
  /**
   * The candidate's own apply-link fingerprint. Used only to establish which
   * PLATFORM it came from - see resolveMatch for why a same-platform match is
   * always refused.
   */
  fingerprint?: string | null;
}

type MatchRow = ContentDuplicateMatch & { apply_link_fingerprint: string };

/**
 * Decides whether a candidate matches exactly one existing posting, applying the
 * two precision rules that cannot be expressed in the identity key itself.
 * Shared by the primary and fallback paths so they can never drift apart on what
 * counts as a safe match.
 */
function resolveMatch(candidate: ContentDuplicateCandidate, rows: MatchRow[]): MatchRow | null {
  // Collapse to DISTINCT existing postings: several rows can share one
  // fingerprint (the same posting captured twice), and that is one posting.
  const distinctByFingerprint = new Map<string, MatchRow>();
  for (const row of rows) {
    if (!distinctByFingerprint.has(row.apply_link_fingerprint)) {
      distinctByFingerprint.set(row.apply_link_fingerprint, row);
    }
  }
  const distinctPostings = [...distinctByFingerprint.values()];

  // RULE 1 - exactly one candidate to match, or refuse.
  //   0  -> nothing to match yet.
  //   2+ -> several distinct requisitions share this identity (real: 3 ABB
  //         "Senior Field Service Technician" reqs in Bland, VA). Nothing in the
  //         content can say which one this duplicates, so the only correct
  //         action is none.
  if (distinctPostings.length !== 1) return null;

  const only = distinctPostings[0];

  // RULE 2 - never contradict the platform. If the existing posting and this
  // candidate come from the SAME platform yet carry different fingerprints, then
  // that platform has issued two different job ids for them, which is the
  // platform itself asserting they are two different postings. Real case this
  // rejects: two Indeed postings for "Information Technology Support Technician"
  // @ Prairieland FS with different jk values.
  const candidateNamespace = extractPlatformNamespace(candidate.fingerprint);
  const existingNamespace = extractPlatformNamespace(only.apply_link_fingerprint);
  if (candidateNamespace && existingNamespace && candidateNamespace === existingNamespace) {
    return null;
  }

  return only;
}

const MATCH_COLUMNS =
  "id, title, company, location, apply_url, source_url, source, created_at, apply_link_fingerprint";

export async function checkContentDuplicate(
  candidate: ContentDuplicateCandidate
): Promise<ContentDuplicateCheckResult> {
  const contentIdentityKey = computeContentIdentityKey({
    title: candidate.title,
    company: candidate.company,
    location: candidate.location,
    url: candidate.url,
    signals: candidate.signals,
    isRemote: candidate.isRemote,
  });
  const titleLocationKey = computeTitleLocationKey({
    title: candidate.title,
    location: candidate.location,
    isRemote: candidate.isRemote,
  });

  // No usable employer name - only the corroborated fallback can resolve this.
  if (!contentIdentityKey) {
    return checkTitleLocationFallback(candidate, titleLocationKey);
  }

  // Only rows that are themselves independently identifiable (have their own
  // apply-link fingerprint) count toward the group - otherwise two rows with no
  // URL at all would each look like "a distinct posting" purely for lacking one.
  const rows = await query<MatchRow>(
    `SELECT ${MATCH_COLUMNS}
     FROM jobs
     WHERE content_identity_key = $1
       AND apply_link_fingerprint IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $2)
     ORDER BY created_at ASC`,
    [contentIdentityKey, CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
  );

  const matched = resolveMatch(candidate, rows);
  if (!matched) return { isContentDuplicate: false, contentIdentityKey, titleLocationKey };
  return {
    isContentDuplicate: true,
    contentIdentityKey,
    titleLocationKey,
    existing: matched,
    score: CONTENT_IDENTITY_MATCH_SCORE,
  };
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
 * right there in the text and the two are provably one posting. Two genuinely
 * different employers hiring the same title in the same city do not name each
 * other in their descriptions, so they stay separate.
 */
async function checkTitleLocationFallback(
  candidate: ContentDuplicateCandidate,
  titleLocationKey: string | null
): Promise<ContentDuplicateCheckResult> {
  if (!titleLocationKey || !candidate.descriptionText) {
    return { isContentDuplicate: false, contentIdentityKey: null, titleLocationKey };
  }

  // content_identity_key IS NOT NULL restricts corroborators to postings whose
  // own employer name was trustworthy - a second site-name row cannot vouch for
  // this one.
  const rows = await query<MatchRow>(
    `SELECT ${MATCH_COLUMNS}
     FROM jobs
     WHERE title_location_key = $1
       AND apply_link_fingerprint IS NOT NULL
       AND content_identity_key IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $2)
     ORDER BY created_at ASC`,
    [titleLocationKey, CONTENT_DUPLICATE_CHECK_WINDOW_DAYS]
  );

  const corroborated = rows.filter((row) =>
    companyNameAppearsInText(row.company, candidate.descriptionText)
  );
  const matched = resolveMatch(candidate, corroborated);
  if (!matched) return { isContentDuplicate: false, contentIdentityKey: null, titleLocationKey };
  return {
    isContentDuplicate: true,
    contentIdentityKey: null,
    titleLocationKey,
    existing: matched,
    score: TITLE_LOCATION_MATCH_SCORE,
  };
}

/**
 * Batch variant for bulk-import paths - one query for the whole batch instead of
 * one per row. Does not resolve collisions BETWEEN rows in the same batch (see
 * jobsRepository.ts's createJobs for why that is an accepted, documented
 * non-goal); it only checks each row against postings already committed.
 *
 * Rows needing the fallback path are resolved individually, since that path needs
 * each row's own description text. Those are a small minority (5.5% of recent
 * rows lack a usable company), so the batch win is preserved.
 */
export async function checkContentDuplicatesBatch(
  candidates: ContentDuplicateCandidate[]
): Promise<ContentDuplicateCheckResult[]> {
  const primaryKeys = candidates.map((c) =>
    computeContentIdentityKey({
      title: c.title,
      company: c.company,
      location: c.location,
      url: c.url,
      signals: c.signals,
      isRemote: c.isRemote,
    })
  );
  const uniqueKeys = [...new Set(primaryKeys.filter((k): k is string => k !== null))];

  const byKey = new Map<string, MatchRow[]>();
  if (uniqueKeys.length > 0) {
    const rows = await query<MatchRow & { content_identity_key: string }>(
      `SELECT ${MATCH_COLUMNS}, content_identity_key
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

  const results: ContentDuplicateCheckResult[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const contentIdentityKey = primaryKeys[i];
    const titleLocationKey = computeTitleLocationKey({
      title: candidate.title,
      location: candidate.location,
      isRemote: candidate.isRemote,
    });

    if (!contentIdentityKey) {
      results.push(await checkTitleLocationFallback(candidate, titleLocationKey));
      continue;
    }
    const matched = resolveMatch(candidate, byKey.get(contentIdentityKey) ?? []);
    results.push(
      matched
        ? {
            isContentDuplicate: true,
            contentIdentityKey,
            titleLocationKey,
            existing: matched,
            score: CONTENT_IDENTITY_MATCH_SCORE,
          }
        : { isContentDuplicate: false, contentIdentityKey, titleLocationKey }
    );
  }
  return results;
}
