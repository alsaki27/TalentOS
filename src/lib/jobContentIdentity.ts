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

const REMOTE_WORD = /\bremote\b|\bwork from home\b|\banywhere\b|\bnationwide\b|\btelecommute\b/i;

// US states/territories plus the country names that appear in production
// location strings. Reference data, not tuning: it answers one question - does
// the part after the comma name a real region? - which is what separates a
// genuine "City, ST" from a fragment of description prose that happens to
// contain a comma.
const REGION_NAMES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me","md",
  "ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa","ri","sc",
  "sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc","pr","vi","gu","as","mp",
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida",
  "georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine",
  "maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska",
  "nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio",
  "oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas",
  "utah","vermont","virginia","washington","west virginia","wisconsin","wyoming",
  "district of columbia","puerto rico",
  "us","usa","united states","united states of america","canada","uk","united kingdom","india",
  "australia","germany","france","ireland","mexico","netherlands","spain","poland","brazil","japan",
  "singapore","philippines","remote",
]);

/**
 * Whether a supplied company name is really the name of the SITE it was scraped
 * from rather than the employer.
 *
 * A real, observed corruption, not a hypothetical: the browser extension's
 * generic extractor falls back to og:site_name (and then to the last segment of
 * document.title) when it cannot find the employer, so a capture from Indeed
 * arrived with company "Indeed.com" and one from hiring.cafe with "HiringCafe".
 * Such a value must never form an identity - every job captured from that site
 * would otherwise share one "employer".
 *
 * Two independent checks, either sufficient:
 *   1. `signals` - the extension already reports which source produced the
 *      company ("og:site_name" / "title:last" are the untrustworthy ones). This
 *      arrives today and was simply being discarded server-side.
 *   2. The name matches the capture URL's own host/brand. Derived from the
 *      posting's url rather than a list of known job boards, so it holds for any
 *      site, including ones added later.
 */
export function isSiteNameNotEmployer(
  company: string | null | undefined,
  url: string | null | undefined,
  signals?: string[] | null
): boolean {
  const normalizedCompany = normalizeCompanyName(company);
  if (!normalizedCompany) return false;

  if (Array.isArray(signals) && signals.some((s) => s === "og:site_name" || s === "title:last")) {
    return true;
  }

  if (!url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  // Only the STRONG form: the company value is the domain itself, including its
  // TLD ("Indeed.com" on indeed.com). That is unambiguously a site name.
  //
  // Matching the bare brand label is deliberately NOT enough, because on an
  // employer's own careers domain the company name matching the brand is the
  // expected, correct case and the best confirmation available - "Acme" captured
  // from careers.acme.com is right, not corrupt. Rejecting it there would strip
  // the identity from every job imported from a company's own site or ATS, which
  // is a large share of all ingestion.
  //
  // Site names that do not carry a TLD ("HiringCafe", "ZipRecruiter") are caught
  // by the `signals` check above instead: they only ever arise from the
  // extension's og:site_name / title:last fallbacks, which report themselves.
  const collapsed = normalizedCompany.replace(/ /g, "");
  return normalizedCompany === basicNormalize(host) || collapsed === host.replace(/\./g, "");
}

/**
 * The location component of the identity key.
 *
 * Takes the title and an explicit remote flag as well as the location string,
 * because the location string is the least reliable thing a capture supplies and
 * the title is among the most reliable. Confirmed live: capturing one GuidePoint
 * Security posting from Indeed produced location "GitLab Runners, Azure" - a
 * fragment of the description's CI/CD tool list - while the LinkedIn capture of
 * the same posting produced an empty location. Both titles read
 * "...(Remote in VA, MD, PA, NC, DE, NJ, or DC)", so the title is what correctly
 * identifies it as remote.
 *
 * Resolution order:
 *   "remote"  - the explicit flag, the title, or the location says remote.
 *               Platforms phrase one remote posting wildly differently
 *               ("United States (Remote in VA, MD, ...)", a bare "Remote",
 *               "Remote in VA, MD, ...; United States"), so they must collapse
 *               to one bucket or a remote job can never match across platforms.
 *   "<city>"  - text before the first comma, but ONLY when a later component
 *               names a real region. This keeps "Alton, IL, US" and "Bay City,
 *               Michigan, USA" while rejecting the real junk captures
 *               "GitLab Runners, Azure" and "GIS, Mapping".
 *   ""        - nothing trustworthy. Unknown, deliberately not guessed.
 */
export function computeLocationBucket(
  location: string | null | undefined,
  title?: string | null,
  isRemote?: boolean | null
): string {
  if (isRemote === true) return "remote";
  if (REMOTE_WORD.test(title ?? "")) return "remote";
  const raw = (location ?? "").trim();
  if (!raw) return "";
  if (REMOTE_WORD.test(raw)) return "remote";

  const parts = raw.split(",").map((p) => basicNormalize(p)).filter(Boolean);
  if (parts.length < 2) return "";
  const regionFollows = parts.slice(1).some((p) => REGION_NAMES.has(p));
  return regionFollows ? parts[0] : "";
}

/**
 * The identity a real requisition is matched on: company + title + location
 * bucket. Null when the company or title is unusable, so a job that cannot be
 * identified never collides with every other such job under an empty key.
 *
 * ── Why the location belongs in the KEY, not in a separate comparison ──
 *
 * It was originally a post-filter, with the guard additionally requiring that
 * only ONE other posting share company+title. Measured against live data, that
 * combination failed in both directions:
 *
 *   * It missed nearly every real duplicate. "OSP Field Engineer" @ Pearce
 *     Services had 11 postings across indeed/linkedin/greenhouse/simplyhired -
 *     really 5 distinct city openings each captured twice ("Alton, IL" +
 *     "Alton, IL, US", "Litchfield, IL" + "Litchfield, IL, US", ...). Because the
 *     company+title group held 11 postings, the one-other-posting gate refused to
 *     act and all 5 duplicate pairs were kept. Same for "Distribution Designer"
 *     @ Actalent ("Bay City, MI" + "Bay City, Michigan, USA") and "Outside Plant
 *     Engineer" @ Verizon ("Miami, FL" + "Miami, FL, US").
 *   * It produced false positives. A loose location comparison accepted
 *     "Rushville, IL, US" and "Pittsfield, IL, US" as one job purely because both
 *     contain the token "il" - two different branch openings.
 *
 * Putting the city in the key fixes both at once: Actalent's 120 "Electrical
 * Engineer" postings spread over 65 cities become 65 single-posting identities
 * with nothing to merge, while the two captures of the Alton, IL opening land on
 * one identity. The group-size gate in the guard then only has to handle the
 * genuinely hard case - several distinct requisitions in the SAME city under the
 * SAME title (real: 3 ABB "Senior Field Service Technician" reqs in Bland, VA) -
 * where it correctly refuses to guess.
 */
export function computeContentIdentityKey(input: {
  title?: string | null;
  company?: string | null;
  location?: string | null;
  /** The posting's own url, used to reject a site name masquerading as the employer. */
  url?: string | null;
  /** The extension's provenance signals for the extracted company, when present. */
  signals?: string[] | null;
  isRemote?: boolean | null;
}): string | null {
  const title = normalizeJobTitle(input.title);
  const company = normalizeCompanyName(input.company);
  if (!title || !company) return null;
  if (isSiteNameNotEmployer(input.company, input.url, input.signals)) return null;
  return `${company}::${title}::${computeLocationBucket(input.location, input.title, input.isRemote)}`;
}

/**
 * The deliberately weaker fallback identity for captures whose employer name is
 * unusable (absent, or the scraping site's own name): title + location bucket.
 *
 * NOT sufficient evidence of a duplicate on its own - two employers can post the
 * same title in the same city. The guard pairs it with independent corroboration:
 * the matched posting's employer name must literally appear in the candidate's
 * description text. See jobContentDuplicateGuard.ts.
 */
export function computeTitleLocationKey(input: {
  title?: string | null;
  location?: string | null;
  isRemote?: boolean | null;
}): string | null {
  const title = normalizeJobTitle(input.title);
  if (!title) return null;
  return `${title}::${computeLocationBucket(input.location, input.title, input.isRemote)}`;
}

/** Whether an employer name occurs in a description, used only as corroboration. */
export function companyNameAppearsInText(
  company: string | null | undefined,
  text: string | null | undefined
): boolean {
  const name = normalizeCompanyName(company);
  if (!name || name.length < 3 || !text) return false;
  return basicNormalize(text).includes(name);
}
