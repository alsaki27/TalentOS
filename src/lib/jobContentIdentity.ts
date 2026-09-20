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
// ── What identifies one real requisition, and why (all verified live) ──
//
// Confirmed CROSS-PLATFORM duplicates in production (same job, no shared URL
// identifier, each stored as its own row before this module existed):
// "GIS Technician-Planning" @ Elkhart County Government (linkedin + indeed),
// "CADD Drafter" @ Electrical Consultants, Inc. (linkedin + indeed), "NOC
// Network Analyst (Government)" @ AT&T (indeed + linkedin), "OSP Field
// Engineer" @ Pearce Services (indeed + linkedin + greenhouse + simplyhired),
// and dozens more. In every one, company and title match EXACTLY once
// normalized for case and punctuation - no fuzzy matching is needed, and
// none is done here, because fuzziness is what would cost precision.
//
// Company + title alone is NOT enough, though: employers legitimately reuse
// one title across many genuinely distinct openings. Actalent has 120
// "Electrical Engineer" postings spread over 65 cities; Amazon has 9+
// "Innovation and Design Engineer, Worldwide Design Engineering" across
// Bellevue/Arlington/Nashville. What separates those real openings from each
// other is WHERE they are - so the location bucket is part of the identity
// key (see computeContentIdentityKey below for the measured evidence).
//
// That still leaves one irreducibly ambiguous case: several distinct
// requisitions in the SAME city under the SAME title - real example, 3 ABB
// "Senior Field Service Technician" reqs all in Bland, VA, whose descriptions
// differ by a handful of characters and which only the requisition id in the
// URL distinguishes. No content signal can resolve that, so the guard
// refuses to act there rather than guess. Description-text similarity was
// evaluated against this same data and rejected for exactly that reason.

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

const REMOTE_WORD = /\bremote\b|\bwork from home\b|\banywhere\b|\bnationwide\b/i;

/**
 * The location bucket that participates in the identity key.
 *
 * Three cases, in priority order, each grounded in real production strings:
 *   "remote"  - either side mentions remote/work-from-home/anywhere. Platforms
 *               describe one remote posting wildly differently ("United States
 *               (Remote in VA, MD, PA, ...)" on LinkedIn, a bare "Remote" on
 *               Indeed, "Remote in VA, MD, ...; United States" on DailyRemote),
 *               so they all collapse to one bucket or a remote job could never
 *               be matched across platforms at all.
 *   "<city>"  - the text before the first comma, the near-universal convention
 *               ("Alton, IL" / "Alton, IL, US"; "Bay City, MI" / "Bay City,
 *               Michigan, USA"; "Boise, ID, USA" / "Boise, ID"). This is what
 *               separates an employer's genuinely distinct city openings.
 *   ""        - no city can be read (a bare "United States", "onsite / United
 *               States", or nothing at all). Unknown, deliberately not guessed.
 */
export function computeLocationBucket(location: string | null | undefined): string {
  const raw = (location ?? "").trim();
  if (!raw) return "";
  if (REMOTE_WORD.test(raw)) return "remote";
  const [head, ...rest] = raw.split(",");
  if (rest.length === 0) return "";
  return basicNormalize(head);
}

/**
 * The identity a real requisition is matched on: company + title + location
 * bucket. Returns null when company or title is missing, so a job that
 * cannot be identified never collides with every other such job under an
 * empty key.
 *
 * ── Why the location bucket is part of the KEY, not a separate check ──
 *
 * It was originally a post-filter, with the guard additionally requiring that
 * only ONE other posting shared company+title. Measured against live data,
 * that combination failed in both directions:
 *
 *   * It missed nearly every real duplicate. "OSP Field Engineer" @ Pearce
 *     Services had 11 postings across indeed/linkedin/greenhouse/simplyhired -
 *     really 5 distinct city openings each captured twice ("Alton, IL" +
 *     "Alton, IL, US", "Litchfield, IL" + "Litchfield, IL, US", ...). Because
 *     the company+title group held 11 postings, the one-other-posting gate
 *     refused to act and all 5 duplicate pairs were kept. Same story for
 *     "Distribution Designer" @ Actalent ("Bay City, MI" + "Bay City,
 *     Michigan, USA") and "Outside Plant Engineer" @ Verizon ("Miami, FL" +
 *     "Miami, FL, US").
 *   * It produced false positives. A loose location comparison accepted
 *     "Rushville, IL, US" and "Pittsfield, IL, US" as the same job purely
 *     because both contain the token "il" - two different branch openings.
 *
 * Putting the city in the key fixes both at once: Actalent's 120 "Electrical
 * Engineer" postings spread over 65 cities become 65 single-posting identities
 * with nothing to merge, while the two captures of the Alton, IL opening land
 * on one identity. The remaining group-size gate in the guard then only has to
 * handle the genuinely hard case - several distinct requisitions in the SAME
 * city under the SAME title (real: 3 ABB "Senior Field Service Technician"
 * reqs in Bland, VA) - where it correctly refuses to guess.
 */
export function computeContentIdentityKey(input: {
  title?: string | null;
  company?: string | null;
  location?: string | null;
}): string | null {
  const title = normalizeJobTitle(input.title);
  const company = normalizeCompanyName(input.company);
  if (!title || !company) return null;
  return `${company}::${title}::${computeLocationBucket(input.location)}`;
}
