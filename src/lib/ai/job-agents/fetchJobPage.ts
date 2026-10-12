const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localdomain"];

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return false;
  const [a, b] = parts.map(Number);
  if (parts.some((p) => Number(p) > 255)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1") return true;
  if (h === "::" || h === "0:0:0:0:0:0:0:0") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true;
  return false;
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return false;
  if (isPrivateIPv4(hostname)) return false;
  if (hostname.includes(":") && isPrivateIPv6(hostname)) return false;

  return true;
}

// Some ATS platforms give OpenJobData (and other sources) an application-FORM url for a
// posting, not the job-detail page itself. A form page has little to no extractable prose
// (input fields, not paragraphs), so Deep Fetch can succeed technically and still return
// ~0 usable characters — the exact shape of jobs stuck at stage "no_description" despite the
// description being visible when a person opens the same posting in a browser. Each rule
// below was verified live (fetched both the original and transformed URL, confirmed the
// transformed one returns the real job-detail content) before being added — not a guess:
//   - Lever (jobs.lever.co/{company}/{postingId}/apply): the identical URL with the
//     trailing "/apply" segment removed is the job-detail page.
//   - Paylocity (recruiting.paylocity.com/Recruiting/Jobs/Apply/{id}): the identical URL
//     with "Apply" replaced by "Details" in the path is the job-detail page.
// Applied once, before the fetch cascade starts, so the FIRST attempt already targets the
// real content instead of wasting a fetch on a form page that was always going to be ~empty.
// Falls back to the original URL untouched for every other host — this is an allow-list of
// verified transforms, not a blind "strip trailing /apply" rule that could mis-handle a
// platform where /apply is the only valid page.
export function normalizeJobDetailUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const hostname = url.hostname.toLowerCase();

  if (hostname === "jobs.lever.co") {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length > 0 && segments[segments.length - 1].toLowerCase() === "apply") {
      segments.pop();
      url.pathname = "/" + segments.join("/");
      return url.toString();
    }
  }

  if (hostname === "recruiting.paylocity.com" && /\/Recruiting\/Jobs\/Apply\//i.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/Recruiting\/Jobs\/Apply\//i, "/Recruiting/Jobs/Details/");
    return url.toString();
  }

  return rawUrl;
}

var JINA_MIN_QUALITY_CHARS = 500;
// Trailing \b on each alternative matters: without it, "sign\s*(in|up|on)" matches
// the literal substring "sign"+"in" inside ordinary words like "Signing" (as in "$500
// Signing Bonus", a real, common perk line in legitimate job descriptions) - confirmed
// live against real data: every current production match of this pattern turned out to
// be exactly this false positive, none a real login wall. Same reasoning for "account"
// (would otherwise prefix-match "accounting").
var KNOWN_LOGIN_PATTERNS = /sign\s*(in|up|on)\b|log\s*in\b|create\s*(an\s*)?account\b|agree\s*&?\s*join|you\s*must\s*be\s*signed\s*in/i;

export function looksLikeLoginWall(text: string): boolean {
  var first500 = text.substring(0, 500).toLowerCase();
  return KNOWN_LOGIN_PATTERNS.test(first500) && text.length < 8000;
}

// A posting whose apply_url is an application-FORM link (not a job-detail page) can
// scrape back a browser/application error page instead of real content. These pages
// are often LONGER than the Description Enricher's 500-char "too thin to trust" cutoff,
// so without this check a long garbage page looks "complete" and is saved verbatim as
// description_text, never revisited. Deliberately no length ceiling here (unlike
// looksLikeLoginWall's <8000 check) — long garbage is exactly the shape this catches.
var KNOWN_ERROR_PAGE_PATTERNS =
  /application\s*(has\s*)?expired|no\s*longer\s*(accepting|available|active)|position\s*(has\s*been\s*|is\s*)?(filled|closed)|job\s*(posting\s*)?(is\s*)?(no\s*longer|not)\s*available|page\s*not\s*found|\b404\b|access\s*denied|\bforbidden\b|verify\s*(that\s*)?you(?:'re|\s*are)\s*(a\s*)?human|\bcaptcha\b|something\s*went\s*wrong|unexpected\s*error\s*(has\s*)?occurred/i;

export function looksLikeErrorPage(text: string): boolean {
  var prefix = text.substring(0, 3000);
  return KNOWN_ERROR_PAGE_PATTERNS.test(prefix);
}

export function isContentUseless(text: string): boolean {
  if (text.length < 200) return true;
  if (looksLikeLoginWall(text)) return true;
  if (looksLikeErrorPage(text)) return true;
  return false;
}

export function cleanJobPageText(raw: string): string {
  if (!raw || raw.length < 50) return raw;

  var text = raw;

  text = text.replace(/^Title:\s*[^\n]*\n+URL Source:\s*[^\n]*(?:\n+Published Time:[^\n]*)?\n+Markdown Content:\s*/i, "");
  text = text.replace(/\[Skip to main content[^\]]*\]\([^)]*\)/gi, "");
  text = text.replace(/!\[Image \d+\]\([^)]*\)/g, "");
  text = text.replace(/^\s*[•\-\*]\s*\[(Careers Home|Our Culture|Hiring Process|Our Companies|Career Awareness|Contact Us|Privacy|Terms|Sustainability|Our Community|View More Jobs)\]\([^)]*\)\s*$/gim, "");
  text = text.replace(/\[I am an employee[^\]]*\]\([^)]*\)/gi, "");
  text = text.replace(/\[Candidate Profile\]\([^)]*\)/gi, "");
  text = text.replace(/\[sitemap\]\([^)]*\)/gi, "");

  var similarJobsIdx = text.search(/^(?:#+\s*)?Similar\s+Jobs\b/gim);
  if (similarJobsIdx >= 0) text = text.substring(0, similarJobsIdx).trim();

  var sessionIdx = text.search(/^(?:#+\s*)?Are\s+You\s+Still\s+With\s+Us\?/gim);
  if (sessionIdx >= 0) text = text.substring(0, sessionIdx).trim();

  text = text.replace(/^Page[^\n]*loaded\s*$/gim, "");

  text = text.replace(/^\s*https?:\/\/[^\s]+\s*$/gim, "");
  text = text.replace(/^Apply\s+Now\s*$/gim, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLd(html: string): string | null {
  var matches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!matches) return null;

  var parts: string[] = [];
  for (var i = 0; i < matches.length; i++) {
    var jsonStr = matches[i].replace(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi, "").replace(/<\/script>/gi, "");
    try {
      var parsed = JSON.parse(jsonStr);
      if (parsed["@type"] === "JobPosting" || parsed["@type"] === "ListItem") {
        parts.push(JSON.stringify(parsed, null, 2));
      }
    } catch (_) {}
  }
  return parts.length > 0 ? parts.join("\n-----\n") : null;
}

async function tryDirectFetch(url: string): Promise<string | null> {
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, 55000); // 55s — the scrape cascade runs unbounded by the (separate, later) AI-call timeout

  try {
    var response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) return null;

    var html = await response.text();
    if (!html || html.length < 200) return null;

    var jsonLd = extractJsonLd(html);
    if (jsonLd) {
      console.log(`[Deep Fetch] Direct fetch found JSON-LD (${jsonLd.length} chars) from: ${url.substring(0, 100)}`);
      return jsonLd;
    }

    var text = stripHtml(html);
    if (text.length < 100) return null;

    if (looksLikeLoginWall(text)) {
      console.warn(`[Deep Fetch] Direct fetch returned login/authentication wall for: ${url.substring(0, 100)}`);
      return null;
    }

    if (looksLikeErrorPage(text)) {
      console.warn(`[Deep Fetch] Direct fetch returned an error/expired/unavailable page for: ${url.substring(0, 100)}`);
      return null;
    }

    console.log(`[Deep Fetch] Direct fetch success — extracted ${text.length} chars from HTML at: ${url.substring(0, 100)}`);
    return text.length > 24000 ? text.slice(0, 24000) : text;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryJinaFetch(url: string, requestTimeoutMs: number, noCache = false): Promise<string | null> {
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, requestTimeoutMs);

  try {
    var encodedUrl = encodeURIComponent(url);
    var jinaUrl = `https://r.jina.ai/${encodedUrl}`;

    var headers: Record<string, string> = {
      "Accept": "text/plain",
      "X-Return-Format": "markdown",
      "X-Timeout": "25",           // Tell Jina to wait up to 25s for JS-rendered pages (ATS platforms)
      "X-Remove-Selector": "nav, footer, header, .nav, .footer, .header, #nav, #footer, [role='navigation']",
      "User-Agent": "TalentOS-JobCEO/1.0",
    };
    if (noCache) {
      headers["X-No-Cache"] = "true"; // Force Jina to re-fetch instead of serving cached stale response
    }

    var response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers,
    });

    if (response.status === 429) {
      console.warn(`[Deep Fetch] Jina rate-limited (429) for: ${url.substring(0, 100)}`);
      return null;
    }

    if (response.status >= 500) {
      console.warn(`[Deep Fetch] Jina upstream error (${response.status}) for: ${url.substring(0, 100)}`);
      return null;
    }

    if (!response.ok) {
      console.warn(`[Deep Fetch] Jina returned HTTP ${response.status} for: ${url.substring(0, 100)}`);
      return null;
    }

    var text = await response.text();

    if (!text || text.trim().length === 0) {
      console.warn(`[Deep Fetch] Jina returned empty body for: ${url.substring(0, 100)}`);
      return null;
    }

    if (looksLikeLoginWall(text)) {
      console.warn(`[Deep Fetch] Jina returned login/authentication wall for: ${url.substring(0, 100)}`);
      return null;
    }

    if (isContentUseless(text)) {
      console.warn(`[Deep Fetch] Jina returned useless content (${text.length} chars) — will retry or fall back for: ${url.substring(0, 100)}`);
      return null;
    }

    console.log(`[Deep Fetch] Jina success — fetched ${text.length} chars from: ${url.substring(0, 100)}`);
    var cleaned = cleanJobPageText(text);
    return cleaned.length > 24000 ? cleaned.slice(0, 24000) : cleaned;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJobPageText(rawUrl: string): Promise<string> {
  if (!isSafeExternalUrl(rawUrl)) {
    console.warn(`[Deep Fetch] Unsafe URL rejected: ${rawUrl.substring(0, 100)}`);
    return "";
  }

  // Normalized once, up front: for known ATS apply-form urls (Lever, Paylocity), this
  // targets the real job-detail page on the FIRST attempt instead of wasting all 3 layers
  // scraping a form page that was always going to return ~0 usable characters.
  var url = normalizeJobDetailUrl(rawUrl);
  if (url !== rawUrl) {
    console.log(`[Deep Fetch] Normalized apply-form url to detail page: ${rawUrl.substring(0, 100)} -> ${url.substring(0, 100)}`);
  }

  var rawText: string | null = null;

  // Layer timeouts below are deliberately generous (the scrape cascade runs unbounded by
  // the AI-call timeout — see deepFetch.ts/enricher.ts, which await this function fully
  // before ever touching their own, separate AI timeout). Bot-blocked ATS platforms
  // (confirmed live: ADP, UKG/UltiPro serve an immediate "unsupported browser" page
  // regardless of wait time) won't be fixed by more time - those need a fundamentally
  // different approach (real browser rendering) - but a genuinely slow-rendering
  // JS-heavy page has a real chance of succeeding with more of it.

  // ── Layer 1: Jina with JS-wait headers (handles React/SPA ATS platforms) ──
  try {
    rawText = await tryJinaFetch(url, 65000, false);
  } catch (err) {
    console.warn(`[Deep Fetch] Jina attempt 1 failed (${(err as Error).message ?? String(err)}) for: ${url.substring(0, 100)}`);
  }

  if (rawText !== null) return rawText;

  // ── Layer 2: Jina retry with no-cache (avoids stale/empty cached responses) ──
  console.log(`[Deep Fetch] Jina layer 1 returned nothing — retrying with X-No-Cache for: ${url.substring(0, 100)}`);
  try {
    rawText = await tryJinaFetch(url, 65000, true);
  } catch (err) {
    console.warn(`[Deep Fetch] Jina attempt 2 (no-cache) failed (${(err as Error).message ?? String(err)}) for: ${url.substring(0, 100)}`);
  }

  if (rawText !== null) return rawText;

  // ── Layer 3: Direct HTTP fetch (JSON-LD extraction + HTML strip) ──
  console.log(`[Deep Fetch] Jina exhausted both attempts — falling back to direct HTTP fetch for: ${url.substring(0, 100)}`);
  try {
    rawText = await tryDirectFetch(url);
  } catch (err) {
    console.warn(`[Deep Fetch] Direct fetch failed (${(err as Error).message ?? String(err)}) for: ${url.substring(0, 100)}`);
  }

  if (rawText !== null) return rawText;

  console.warn(`[Deep Fetch] All 3 fetch layers exhausted for: ${url.substring(0, 100)}`);
  return "";
}
