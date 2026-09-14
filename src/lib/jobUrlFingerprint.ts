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

export function normalizeUrlFingerprint(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";

  const canonical = extractCanonicalJobKey(url);
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
