// Shared apply-link normalization for job duplicate detection.
//
// Promoted out of jobAgentService.ts (the Apify scraper's in-batch dedup),
// which is the only place this logic existed before - every other
// ingestion path either didn't check apply_url at all, or did its own
// un-normalized exact-string match. This is the single source of truth so
// every path (scrapers, manual entry, imports, the browser extension, a
// future developer's own insert) normalizes the same way.
//
// ── Why canonical platform job keys exist (added 2026-09-14) ──────────────
//
// Normalizing the whole URL string is not enough, because the same job
// reached twice produces different URLs. Confirmed against live production
// data, not assumed:
//
//   * Indeed appends a per-view tracking key. The SAME posting
//     (jk=f2645064e02dfc3a, "OSP Designer" at Aquila Corporation) was stored
//     5 separate times because each capture carried a different `tk=` value
//     (1k29mp61jjccu800, 1k277sd0giju6801, 1k25bhanpiq50800, ...). Across
//     the table this accounted for 53 redundant Indeed rows.
//   * Indeed also serves two URL shapes for one job - `/viewjob?jk=<key>`
//     and `/job/<slug>-<key>` - and different ingestion paths capture
//     different ones (the extension stores the former, the Apify actor the
//     latter, sometimes both on the same row).
//   * LinkedIn appends position/pageNum/refId/trackingId, and serves both
//     `/jobs/view/<id>` and `/jobs/view/<slug>-<id>`. Same job id 4331177628
//     was stored under multiple fingerprints for exactly this reason; 35
//     redundant LinkedIn rows across the table.
//
// A platform's own job id is the authoritative identity of a posting on that
// platform, so extracting it makes all of the above collapse to one key with
// no false-positive risk whatsoever: two URLs carrying the same Indeed `jk`
// are the same Indeed posting, by definition.
//
// Deliberately NOT done here: matching on company+title+location to catch
// the same role cross-posted to different platforms. That was measured
// against this same production data first and is genuinely unsafe as an
// automatic block - large employers legitimately run several distinct
// requisitions under an identical title in one city (5 separate real Amazon
// "Innovation and Design Engineer" postings in Bellevue WA; 4 separate ABB
// "Senior Field Service Technician" postings in Bland VA, each with its own
// platform job id). Blocking on content alone would silently discard real,
// distinct openings. See findLikelyCrossPlatformDuplicates() below, which
// surfaces those candidates for review instead of dropping them.

/** Query params that identify a *view* of a posting, never the posting itself. */
const TRACKING_PARAMS = new Set([
  // Generic campaign/analytics
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "ref", "referrer", "source", "src", "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid",
  // Indeed
  "tk", "from", "vjs", "advn", "adid", "sjdu", "acatk", "xkcb", "xpse", "xfps", "alid",
  // LinkedIn
  "trackingid", "refid", "position", "pagenum", "alternatechannel", "trk", "trkinfo",
  "originalsubdomain", "eblc", "ebp",
  // Greenhouse / Lever / SmartRecruiters / misc ATS
  "gh_src", "gh_jid", "lever-source", "lever-origin", "sr_source",
]);

function stripTrackingParams(u: URL): void {
  // Collect first: deleting while iterating searchParams skips entries.
  const doomed: string[] = [];
  u.searchParams.forEach((_value, key) => {
    if (TRACKING_PARAMS.has(key.toLowerCase())) doomed.push(key);
  });
  for (const key of doomed) u.searchParams.delete(key);
}

function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * The platform's own identifier for a posting, as "<platform>:<id>", or null
 * when the URL isn't a recognized platform job page.
 *
 * Only platforms whose real URL shapes were verified against live production
 * data are handled here - guessing at a format would risk collapsing two
 * genuinely different postings onto one key, which is the one failure mode
 * this module must never have.
 */
export function extractCanonicalJobKey(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = hostOf(u);
  const path = u.pathname;

  // ── Indeed ──────────────────────────────────────────────────────────────
  // /viewjob?jk=<16-hex>  and  /job/<slug>-<16-hex> both identify one posting.
  if (host === "indeed.com" || host.endsWith(".indeed.com")) {
    const jk = u.searchParams.get("jk") || u.searchParams.get("vjk");
    if (jk && /^[a-f0-9]{8,}$/i.test(jk)) return `indeed:${jk.toLowerCase()}`;
    const slugged = path.match(/\/job\/(?:.*-)?([a-f0-9]{12,})\/?$/i);
    if (slugged) return `indeed:${slugged[1].toLowerCase()}`;
  }

  // ── LinkedIn ────────────────────────────────────────────────────────────
  // /jobs/view/<id> and /jobs/view/<slug>-<id>; also ?currentJobId=<id>.
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const viewed = path.match(/\/jobs\/view\/(?:.*-)?(\d{6,})\/?$/);
    if (viewed) return `linkedin:${viewed[1]}`;
    const current = u.searchParams.get("currentJobId");
    if (current && /^\d{6,}$/.test(current)) return `linkedin:${current}`;
  }

  // ── Greenhouse ──────────────────────────────────────────────────────────
  // job-boards.greenhouse.io/<board>/jobs/<id>  (gh_src is tracking only)
  if (host.endsWith("greenhouse.io")) {
    const gh = path.match(/\/([^/]+)\/jobs\/(\d+)\/?$/);
    if (gh) return `greenhouse:${gh[1].toLowerCase()}:${gh[2]}`;
  }

  // ── Lever ───────────────────────────────────────────────────────────────
  // jobs.lever.co/<company>/<uuid> with an optional /apply suffix.
  if (host.endsWith("lever.co")) {
    const lv = path.match(/\/([^/]+)\/([0-9a-f-]{20,})(?:\/apply)?\/?$/i);
    if (lv) return `lever:${lv[1].toLowerCase()}:${lv[2].toLowerCase()}`;
  }

  // ── SmartRecruiters ─────────────────────────────────────────────────────
  // jobs.smartrecruiters.com/<Company>/<numeric-id>-<slug>
  if (host.endsWith("smartrecruiters.com")) {
    const sr = path.match(/\/([^/]+)\/(\d{6,})(?:-|\/|$)/);
    if (sr) return `smartrecruiters:${sr[1].toLowerCase()}:${sr[2]}`;
  }

  // ── hiring.cafe ─────────────────────────────────────────────────────────
  // /job/<id> and /viewjob/<id> are the same posting.
  if (host === "hiring.cafe" || host.endsWith(".hiring.cafe")) {
    const hc = path.match(/\/(?:job|viewjob)\/([^/?#]+)\/?$/);
    if (hc) return `hiringcafe:${hc[1].toLowerCase()}`;
  }

  return null;
}

// ── Generic per-posting identity, for platforms with no dedicated matcher ──
//
// extractCanonicalJobKey above only knows six platforms. Everything else fell
// straight through to whole-URL normalization, which is a weaker identity than
// it looks: it keeps the slug, so one posting reached via two URL shapes (or
// after the employer edits the title) produces two different fingerprints.
// Real example - DailyRemote serves
// /remote-job/application-security-engineer-mid-atlantic-region-...-5163929,
// where only the trailing 5163929 is the posting's actual id.
//
// These two extractors find that id on ANY host without per-site code, which is
// what makes duplicate detection work for a platform nobody has written a
// matcher for yet. Both are deliberately conservative: collapsing two genuinely
// different postings onto one key is the single failure mode this module must
// never have, so an id is only accepted when its SHAPE says it is an id.

/** Query params that name a posting's id on some site. Value shape is still checked. */
const ID_PARAMS = new Set([
  "jobid", "job_id", "jid", "id", "requisitionid", "requisition_id", "reqid", "req_id",
  "vacancyid", "vacancy_id", "postingid", "posting_id", "jk", "vjk", "gh_jid", "offerid",
  // UKG Pro / UltiPro's job-board URL shape is
  // recruiting2.ultipro.com/<company-slug>/JobBoard/<company-board-uuid>/OpportunityDetail?opportunityId=<uuid>.
  // Verified live and dangerous to get wrong: the board uuid in the PATH is
  // shared across every one of that employer's postings (confirmed against real
  // data - one company had 35 distinct job titles all under the identical board
  // uuid), so it must never be treated as a posting id. opportunityId is the
  // part that actually varies per posting, and was unrecognized by every rule
  // here - not this list, not a tracking param to strip - so it fell through to
  // whole-URL normalization and every capture became a "new" job. Real
  // production impact: 555+ rows across 208 companies used this exact URL
  // shape, with real duplicates (a Fleet Farm "Auto Service Technician"
  // posting captured 8 times over 6 days, one per crawl) going completely
  // undetected under the old fingerprint.
  "opportunityid", "opportunity_id",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id-shaped query-param VALUE: a long digit run, long hex, or a UUID. */
function isIdLikeParamValue(value: string): boolean {
  return /^\d{5,}$/.test(value) || /^[0-9a-f]{12,}$/i.test(value) || UUID_RE.test(value);
}

/**
 * The posting id embedded in an arbitrary job URL, as "<host>:<id>", or null.
 *
 * Strictly shape-based, in priority order:
 *   1. An id-shaped value on a param whose NAME means "job id".
 *   2. A final path segment that is a UUID, >=12 hex chars, or ends in a run of
 *      >=5 digits (which is how slugged urls carry their id).
 * Anything else returns null and the caller falls back to normalizing the whole
 * URL, exactly as before - so this can only ever add precision, never remove it.
 */
export function extractGenericJobKey(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || !rawUrl.trim()) return null;
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = hostOf(u);

  for (const [key, value] of u.searchParams.entries()) {
    if (!ID_PARAMS.has(key.toLowerCase())) continue;
    const v = value.trim();
    if (isIdLikeParamValue(v)) return `${host}:${v.toLowerCase()}`;
  }

  const segments = u.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (last) {
    const seg = decodeURIComponent(last);
    if (UUID_RE.test(seg)) return `${host}:${seg.toLowerCase()}`;
    if (/^[0-9a-f]{12,}$/i.test(seg)) return `${host}:${seg.toLowerCase()}`;
    // Trailing digit run, e.g. "...-mid-atlantic-region-5163929" -> 5163929.
    // The optional "-\d{1,3}" tolerates Workday's own revision suffix
    // ("..._JR00030949-1") without it: unmodified, this pattern required the
    // digit run to end the string, so a real ABB slug
    // "Senior-Field-Service-Technician_JR00030949-1" matched nothing at all,
    // falling through to whole-URL normalization. Two captures of the SAME
    // requisition that differ only in whether Workday appended that suffix
    // would then never be recognized as one job. Bounded to 1-3 digits
    // specifically so a real 4-digit year suffix in a slug is never mistaken
    // for a revision number.
    const trailing = seg.match(/(?:^|[^0-9])(\d{5,})(?:-\d{1,3})?$/);
    if (trailing) return `${host}:${trailing[1]}`;
  }

  return null;
}

/**
 * The platform a fingerprint belongs to - "indeed", "linkedin", "greenhouse",
 * or a host's brand label for anything else.
 *
 * Answers exactly one question: are two postings on the SAME platform? If they
 * are and their fingerprints still differ, that platform has issued two
 * different ids for them, which is the platform itself asserting they are two
 * different postings. That assertion is authoritative and content matching must
 * never override it (see jobContentDuplicateGuard.ts).
 *
 * Reducing a host to its brand label is required for correctness, not tidiness:
 * a LinkedIn job page yields the canonical key "linkedin:4414040634" while a
 * LinkedIn feed post yields the normalized-URL form
 * "linkedin.com/feed/update/urnliactivity7497664327231909888". Both are
 * LinkedIn, and the same-platform rule can only fire if they agree. A real pair
 * of Bowman Consulting rows slipped through before this existed.
 */
export function extractPlatformNamespace(fingerprint: string | null | undefined): string | null {
  if (!fingerprint || !fingerprint.trim()) return null;
  const fp = fingerprint.trim();

  const brandLabel = (host: string): string => {
    const cleaned = host.replace(/:\d+$/, "");
    const labels = cleaned.split(".").filter(Boolean);
    return labels.length >= 2 ? labels[labels.length - 2] : cleaned;
  };

  const colon = fp.indexOf(":");
  if (colon > 0) {
    const prefix = fp.slice(0, colon);
    // A canonical platform key's prefix is a bare token ("indeed", "greenhouse").
    // A generic key's prefix is a hostname ("dailyremote.com:5163929").
    if (!prefix.includes(".") && !prefix.includes("/")) return prefix;
    return brandLabel(prefix);
  }

  // A normalized-URL fingerprint has no colon (they are stripped): host + path.
  const slash = fp.indexOf("/");
  return brandLabel(slash > 0 ? fp.slice(0, slash) : fp) || null;
}

export function normalizeUrlFingerprint(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";

  const canonical = extractCanonicalJobKey(url) ?? extractGenericJobKey(url);
  if (canonical) return canonical;

  try {
    const u = new URL(url.trim());
    stripTrackingParams(u);
    u.hash = "";

    // The character class below lists "-" last on purpose. It was previously
    // written "[^a-z0-9/.-=?&]", where ".-=" is parsed as a RANGE (0x2E-0x3D)
    // rather than three literals - so it silently kept ":", ";" and "<" while
    // stripping every literal hyphen out of the path. Harmless for matching
    // (it applied uniformly) but wrong, and it made slugged URLs unreadable
    // in the stored column.
    const cleaned = (u.hostname + u.pathname + u.search)
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .replace(/[^a-z0-9/.=?&-]/g, "");
    return cleaned;
  } catch {
    // Not a valid URL — use a normalized version of the raw string
    return url.toLowerCase().replace(/[^a-z0-9/.=?&-]/g, "").substring(0, 200);
  }
}

/**
 * The one apply-link fingerprint every job-creation path should compute and
 * store. Prefers apply_url (the actual application link) over source_url
 * (where the posting was found) since two different postings can share a
 * source aggregator page while having distinct apply links, but the reverse
 * - the same apply link reached via two different source pages - is the
 * real duplicate case this exists to catch.
 *
 * A canonical platform key found on EITHER url wins over a merely-normalized
 * one, because it is the stronger identity: a row whose apply_url is an
 * employer ATS link but whose source_url is the Indeed posting it was found
 * on should still match a second capture of that same Indeed posting.
 *
 * Returns null (never "") when neither URL yields anything, so a
 * nullable/partial-unique-index column stays clean: "no link to check" and
 * "link normalized to empty" are never confused with each other.
 */
export function computeApplyLinkFingerprint(input: {
  applyUrl?: string | null;
  sourceUrl?: string | null;
}): string | null {
  const canonical = extractCanonicalJobKey(input.applyUrl) ?? extractCanonicalJobKey(input.sourceUrl);
  if (canonical) return canonical;

  const fingerprint = normalizeUrlFingerprint(input.applyUrl) || normalizeUrlFingerprint(input.sourceUrl);
  return fingerprint || null;
}

/**
 * Whether a URL is a search/listing page rather than one posting.
 *
 * This matters because a listing URL is not an identity: several different jobs
 * can be captured from one search page and would then share a fingerprint,
 * making the hard-block duplicate check reject a real, distinct job. Confirmed
 * in production - a row for "Construction Integration Manager" @ Electronic
 * Environments was fingerprinted as
 * "ziprecruiter.com/jobs-search?search=telecommunications manager&location=..."
 * which identifies a query, not a posting.
 *
 * Only consulted when no posting id could be extracted, so a real posting URL
 * that merely happens to sit under a /search/ path is unaffected.
 */
export function looksLikeSearchOrListingUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || !rawUrl.trim()) return false;
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return false;
  }
  if (/(^|\/)(jobs-search|search|jobs-in|browse|results)(\/|$)/i.test(u.pathname)) return true;
  for (const key of u.searchParams.keys()) {
    if (/^(q|query|search|keywords?|searchterm|l|location)$/i.test(key)) return true;
  }
  return false;
}

export type JobIdentityKind = "platform" | "generic";

export interface JobIdentity {
  identity: string;
  kind: JobIdentityKind;
}

/**
 * Every per-posting identity derivable from a set of URLs belonging to ONE
 * capture (its apply link, the page it was found on, and any employer-ATS link
 * the page exposed).
 *
 * Why this exists: computeApplyLinkFingerprint returns a single winner, so a row
 * whose apply_url is an aggregator but whose source_url is the employer's real
 * ATS requisition stores only the aggregator key and DISCARDS the requisition
 * identity. Confirmed live - a row with apply_url=indeed.com/viewjob?jk=... and
 * source_url=grnh.se/... was stored as "indeed:..." with the Greenhouse identity
 * thrown away. A shared requisition id is the one authoritative cross-platform
 * signal there is, so all of them are kept and matched on overlap.
 *
 * Deliberately EXCLUDES normalized-whole-URL fingerprints. Those are not
 * per-posting ids and would make two jobs captured from one search page look
 * identical (see looksLikeSearchOrListingUrl).
 */
export function extractAllIdentities(urls: (string | null | undefined)[]): JobIdentity[] {
  const byIdentity = new Map<string, JobIdentityKind>();
  for (const url of urls) {
    if (!url || !url.trim()) continue;
    const platform = extractCanonicalJobKey(url);
    if (platform) {
      byIdentity.set(platform, "platform");
      continue;
    }
    if (looksLikeSearchOrListingUrl(url)) continue;
    const generic = extractGenericJobKey(url);
    // "platform" already recorded for this string wins over a weaker kind.
    if (generic && !byIdentity.has(generic)) byIdentity.set(generic, "generic");
  }
  return [...byIdentity.entries()].map(([identity, kind]) => ({ identity, kind }));
}
