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

var JINA_MIN_QUALITY_CHARS = 500;
var KNOWN_LOGIN_PATTERNS = /sign\s*(in|up|on)|log\s*in|create\s*(an\s*)?account|agree\s*&?\s*join|you\s*must\s*be\s*signed\s*in/i;

function looksLikeLoginWall(text: string): boolean {
  var first500 = text.substring(0, 500).toLowerCase();
  return KNOWN_LOGIN_PATTERNS.test(first500) && text.length < 8000;
}

function isContentUseless(text: string): boolean {
  if (text.length < 200) return true;
  if (looksLikeLoginWall(text)) return true;
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
  var timeout = setTimeout(function () { controller.abort(); }, 20000);

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

    console.log(`[Deep Fetch] Direct fetch success — extracted ${text.length} chars from HTML at: ${url.substring(0, 100)}`);
    return text.length > 24000 ? text.slice(0, 24000) : text;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryJinaFetch(url: string, requestTimeoutMs: number): Promise<string | null> {
  var controller = new AbortController();
  var timeout = setTimeout(function () { controller.abort(); }, requestTimeoutMs);

  try {
    var encodedUrl = encodeURIComponent(url);
    var jinaUrl = `https://r.jina.ai/${encodedUrl}`;

    var response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        "Accept": "text/plain",
        "X-Return-Format": "markdown",
        "User-Agent": "TalentOS-JobCEO/1.0",
      },
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
      console.warn(`[Deep Fetch] Jina returned useless content (${text.length} chars) — falling back to direct fetch for: ${url.substring(0, 100)}`);
      return null;
    }

    console.log(`[Deep Fetch] Jina success — fetched ${text.length} chars from: ${url.substring(0, 100)}`);
    var cleaned = cleanJobPageText(text);
    return cleaned.length > 24000 ? cleaned.slice(0, 24000) : cleaned;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJobPageText(url: string): Promise<string> {
  if (!isSafeExternalUrl(url)) {
    console.warn(`[Deep Fetch] Unsafe URL rejected: ${url.substring(0, 100)}`);
    return "";
  }

  var rawText: string | null = null;

  try {
    rawText = await tryJinaFetch(url, 50000);
  } catch (err) {
    console.warn(`[Deep Fetch] Jina failed (${(err as Error).message ?? String(err)}) for: ${url.substring(0, 100)}`);
  }

  if (rawText !== null) return rawText;

  console.log(`[Deep Fetch] Jina exhausted — falling back to direct HTTP fetch for: ${url.substring(0, 100)}`);

  try {
    rawText = await tryDirectFetch(url);
  } catch (err) {
    console.warn(`[Deep Fetch] Direct fetch failed (${(err as Error).message ?? String(err)}) for: ${url.substring(0, 100)}`);
  }

  if (rawText !== null) return rawText;

  console.warn(`[Deep Fetch] All layers exhausted for: ${url.substring(0, 100)}`);
  return "";
}
