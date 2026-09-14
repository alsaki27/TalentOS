// Cross-platform job identity: catches the case jobUrlFingerprint.ts
// deliberately does NOT handle - the same real posting captured from
// several platforms that share no identifier at all (a LinkedIn listing, an
// Indeed listing, and a small remote-job aggregator's mirror of it, for
// example), where apply_link_fingerprint is structurally useless since
// there is no shared URL/ID to normalize. Every job-creation path already
// has title/company/location on hand, so this module only normalizes that
// text - the actual decision of whether a match is safe to act on lives in
// jobContentDuplicateGuard.ts, which is where the real precision work
// (avoiding false positives) is done and documented.
//
// ── Why "same normalized title + same normalized company" alone is NOT
//    used as a duplicate signal (verified against live production data) ──
//
// Real, confirmed CROSS-PLATFORM duplicates in production (same job, no
// shared URL identifier, both still sitting in the table as separate rows
// before this module existed): "GIS Technician-Planning" @ Elkhart County
// Government (linkedin.com + indeed.com), "CADD Drafter" @ Electrical
// Consultants, Inc. (linkedin.com + indeed.com), "NOC Network Analyst
// (Government)" @ AT&T (indeed.com + linkedin.com), and ~27 more pairs
// across indeed/linkedin/glassdoor/ziprecruiter/simplyhired/careerbuilder/
// monster - in every one of these, company and title match EXACTLY once
// normalized (case/punctuation only - no fuzzy matching was needed).
//
// But identical normalized title+company is also produced by employers who
// legitimately post many DISTINCT openings under one reused title - equally
// real production data: Amazon has 9+ separate LinkedIn postings titled
// "Innovation and Design Engineer, Worldwide Design Engineering" across
// Bellevue/Arlington/Nashville - different real requisitions, not one job
// echoed 9 times. ABB has 10 separate Workday postings titled "Senior Field
// Service Technician" (several even in the identical city, e.g. Bland, VA)
// whose descriptions differ from each other by only a handful of characters
// - a human reading two of them side by side could not tell they're
// different jobs without the distinct requisition ID in the URL. So content
// similarity, including description-text similarity, cannot safely
// distinguish "cross-posted duplicate" from "templated distinct requisition"
// on its own - this is why the guard (not this module) additionally
// requires that the employer has exactly ONE other existing posting under
// this identity, never merging when a company demonstrably reuses a title.

const COMPANY_LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "ltd", "limited", "corp", "corporation",
  "co", "company", "plc", "gmbh", "group", "holdings", "holding", "lp",
]);

/** lowercase, strip punctuation to single spaces, collapse whitespace. */
function basicNormalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Normalizes a company name for identity matching: case/punctuation-
 * insensitive, and drops one trailing legal-entity suffix word (Inc, LLC,
 * Corp, ...) so "Acme Inc" and "Acme, Inc." and "ACME" agree. Only the
 * TRAILING word is ever dropped - a legal-suffix word appearing mid-name
 * (e.g. a company literally named "Group Health") is left alone.
 */
export function normalizeCompanyName(company: string | null | undefined): string {
  if (!company || !company.trim()) return "";
  const words = basicNormalize(company).split(" ").filter(Boolean);
  while (words.length > 1 && COMPANY_LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/** Normalizes a job title for identity matching: case/punctuation-insensitive only - no fuzzy rewriting, see module doc for why exact match is deliberate. */
export function normalizeJobTitle(title: string | null | undefined): string {
  if (!title || !title.trim()) return "";
  return basicNormalize(title);
}

/**
 * A stable "same real requisition, most likely" key. Returns null when
 * either side is missing/empty after normalization - a job with no title or
 * no company can't be identity-matched, and must never silently collide
 * with every other such job under an empty-string key.
 */
export function computeContentIdentityKey(input: {
  title?: string | null;
  company?: string | null;
}): string | null {
  const title = normalizeJobTitle(input.title);
  const company = normalizeCompanyName(input.company);
  if (!title || !company) return null;
  return `${company}::${title}`;
}

const REMOTE_WORD = /\bremote\b|\bwork from home\b|\banywhere\b|\bnationwide\b/i;

/**
 * Whether two location strings are plausibly the SAME job's location,
 * rather than proof two postings are different jobs. Deliberately biased
 * toward "compatible": location text varies wildly by platform for the
 * identical posting (LinkedIn's "United States (Remote in VA, MD, ...)" vs
 * a bare "Remote" vs "IN, US" vs a full "City, ST, USA"), so this only
 * returns false on a genuine, unambiguous mismatch between two fully
 * specified, non-remote locations that share no common token - it is a
 * safety check to catch obvious mismatches, not a strict equality test.
 */
export function areLocationsCompatible(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const na = basicNormalize(a ?? "");
  const nb = basicNormalize(b ?? "");
  if (!na || !nb) return true; // an absent location is never grounds to call two postings different
  if (REMOTE_WORD.test(a ?? "") || REMOTE_WORD.test(b ?? "")) return true;
  if (na === nb) return true;
  const tokensA = new Set(na.split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(nb.split(" ").filter((t) => t.length > 1));
  for (const t of tokensA) {
    if (tokensB.has(t)) return true; // shares a city/state/country token, e.g. "fairfax" or "va"
  }
  return false;
}
