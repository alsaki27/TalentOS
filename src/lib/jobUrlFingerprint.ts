// Shared apply-link normalization for job duplicate detection.
//
// Promoted out of jobAgentService.ts (the Apify scraper's in-batch dedup),
// which is the only place this logic existed before - every other
// ingestion path either didn't check apply_url at all, or did its own
// un-normalized exact-string match. This is the single source of truth so
// every path (scrapers, manual entry, imports, the browser extension, a
// future developer's own insert) normalizes the same way.

export function normalizeUrlFingerprint(url: string | null | undefined): string {
  if (!url || !url.trim()) return "";
  try {
    const u = new URL(url.trim());
    // Strip common tracking query params but keep the rest (like jk= for Indeed)
    u.searchParams.delete("utm_source");
    u.searchParams.delete("utm_medium");
    u.searchParams.delete("utm_campaign");
    u.searchParams.delete("ref");
    u.hash = "";

    const cleaned = (u.hostname + u.pathname + u.search)
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/\/+$/, "")
      .replace(/[^a-z0-9/.-=?&]/g, "");
    return cleaned;
  } catch {
    // Not a valid URL — use a normalized version of the raw string
    return url.toLowerCase().replace(/[^a-z0-9/.-=?&]/g, "").substring(0, 200);
  }
}

/**
 * The one apply-link fingerprint every job-creation path should compute and
 * store. Prefers apply_url (the actual application link) over source_url
 * (where the posting was found) since two different postings can share a
 * source aggregator page while having distinct apply links, but the reverse
 * - the same apply link reached via two different source pages - is the
 * real duplicate case this exists to catch. Returns null (never "") when
 * neither URL is present, so a nullable/partial-unique-index column stays
 * clean: "no link to check" and "link normalized to empty" are never
 * confused with each other.
 */
export function computeApplyLinkFingerprint(input: {
  applyUrl?: string | null;
  sourceUrl?: string | null;
}): string | null {
  const fingerprint = normalizeUrlFingerprint(input.applyUrl) || normalizeUrlFingerprint(input.sourceUrl);
  return fingerprint || null;
}
