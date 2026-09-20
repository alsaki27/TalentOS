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

// US states/territories plus the country names that show up in production
// location strings. This is reference data, not tuning: it answers the single
// question "does the part after the comma name a real region?", which is what
// separates a genuine "City, ST" location from a fragment of description text
// that merely happens to contain a comma.
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
 * Whether an extension-supplied company name is actually the name of the SITE
 * it was scraped from rather than the employer.
 *
 * This is a real, observed corruption, not a hypothetical: the browser
 * extension's generic extractor falls back to `og:site_name` / the last
 * segment of `document.title` when it cannot find the employer, so a capture
 * from Indeed arrives with company "Indeed.com" and one from hiring.cafe with
 * "HiringCafe". Such a value must never participate in identity matching -
 * every job captured from that site would otherwise share one "employer".
 *
 * Deliberately derived from the posting's OWN url rather than a list of known
 * job boards, so it holds for any site, including ones added later.
 */
export function isSiteNameNotEmployer(
  company: string | null | undefined,
  url: string | null | undefined
): boolean {
  const normalizedCompany = normalizeCompanyName(company);
  if (!normalizedCompany || !url) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  // Compare against the host and against its registrable-ish brand segment, so
  // "Indeed.com" matches indeed.com and "HiringCafe" matches hiringcafe.com.
  const hostNormalized = basicNormalize(host);
  const labels = host.split(".").filter((l) => l.length > 1);
  const brand = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  const collapsed = normalizedCompany.replace(/ /g, "");
  return (
    normalizedCompany === hostNormalized ||
    collapsed === host.replace(/\./g, "") ||
    (!!brand && collapsed === brand)
  );
}

const REMOTE_WORD = /\bremote\b|\bwork from home\b|\banywhere\b|\bnationwide\b/i;

/**
 * The location bucket that participates in the identity key.
 *
 * Takes the TITLE as well as the location field, because the location field is
 * the least reliable thing the browser extension sends and the title is the
 * most reliable. Confirmed live: capturing one GuidePoint Security posting from
 * Indeed produced location "GitLab Runners, Azure" - a fragment of the
 * description's CI/CD tool list - while the LinkedIn capture of the same
 * posting produced an empty location. Both titles, however, read "...(Remote in
 * VA, MD, PA, NC, DE, NJ, or DC)", so the title is what correctly identifies it
 * as remote.
 *
 * Resolution order:
 *   "remote"  - the title or the location says remote/work-from-home/anywhere.
 *               Platforms phrase one remote posting wildly differently
 *               ("United States (Remote in VA, MD, ...)", a bare "Remote",
 *               "Remote in VA, MD, ...; United States"), so they must collapse
 *               to one bucket or a remote job can never match across platforms.
 *   "<city>"  - text before the first comma, but ONLY when what follows names a
 *               real region (see REGION_NAMES). This is what separates a true
 *               "Alton, IL" / "Bay City, Michigan, USA" from scraped junk like
 *               "GitLab Runners, Azure" or "GIS, Mapping", both real captures.
 *   ""        - nothing trustworthy. Deliberately not guessed.
 */
export function computeLocationBucket(
  location: string | null | undefined,
  title?: string | null
): string {
  if (REMOTE_WORD.test(title ?? "")) return "remote";
  const raw = (location ?? "").trim();
  if (!raw) return "";
  if (REMOTE_WORD.test(raw)) return "remote";

  const parts = raw.split(",").map((p) => basicNormalize(p)).filter(Boolean);
  if (parts.length < 2) return "";
  // Any following component naming a real region validates the first as a city.
  const regionFollows = parts.slice(1).some((p) => REGION_NAMES.has(p));
  return regionFollows ? parts[0] : "";
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
  /** The posting's own url, used to reject a site name masquerading as the employer. */
  url?: string | null;
}): string | null {
  const title = normalizeJobTitle(input.title);
  const company = normalizeCompanyName(input.company);
  if (!title || !company) return null;
  // A site name is not an employer, so it must not form an identity - every
  // job captured from that site would otherwise share one "company".
  if (isSiteNameNotEmployer(input.company, input.url)) return null;
  return `${company}::${title}::${computeLocationBucket(input.location, input.title)}`;
}

/**
 * The weaker identity used when the employer name is unusable (absent, or the
 * site's own name - see isSiteNameNotEmployer). Title plus location bucket
 * only.
 *
 * On its own this is NOT sufficient evidence of a duplicate - two employers can
 * post the same title in the same city. The guard therefore pairs it with a
 * separate corroboration: the matched posting's employer name must literally
 * appear in the candidate's description text. See jobContentDuplicateGuard.ts.
 */
export function computeTitleLocationKey(input: {
  title?: string | null;
  location?: string | null;
}): string | null {
  const title = normalizeJobTitle(input.title);
  if (!title) return null;
  return `${title}::${computeLocationBucket(input.location, input.title)}`;
}

/** Whether an employer name occurs in a job description, used as corroboration. */
export function companyNameAppearsInText(
  company: string | null | undefined,
  text: string | null | undefined
): boolean {
  const name = normalizeCompanyName(company);
  if (!name || name.length < 3 || !text) return false;
  return basicNormalize(text).includes(name);
}
