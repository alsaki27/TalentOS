import { isSafeExternalUrl, looksLikeErrorPage, looksLikeLoginWall, normalizeJobDetailUrl } from "@/lib/ai/job-agents/fetchJobPage";

const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_BYTES = 200_000;
const TOTAL_TIMEOUT_MS = 22_000;
const LOCATION_VALUE_MAX_LENGTH = 180;

export type JobLocationExtractionMethod = "schema_jobposting" | "labeled_posting_field";

export interface JobLocationScrapeInput {
  title: string;
  company?: string | null;
  sourceUrl?: string | null;
  applyUrl?: string | null;
}

export type JobLocationScrapeResult =
  | { ok: true; location: string; method: JobLocationExtractionMethod; sourceHost: string }
  | { ok: false; reason: "no_links" | "unsafe_link" | "blocked" | "timeout" | "fetch_failed" | "no_explicit_location"; message: string };

interface PostalAddressLike {
  addressLocality?: unknown;
  addressRegion?: unknown;
  addressCountry?: unknown;
}

interface JsonLdPosting {
  "@type"?: unknown;
  title?: unknown;
  url?: unknown;
  jobLocation?: unknown;
  jobLocationType?: unknown;
  hiringOrganization?: unknown;
  [key: string]: unknown;
}

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

function scalarText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["name", "value", "identifier"]) {
      if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
  }
  return "";
}

function normalizeMatch(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}

function normalizeCountry(value: string): string {
  let country = value.trim();
  if (/^https?:\/\//i.test(country)) {
    try {
      country = new URL(country).pathname.split("/").filter(Boolean).at(-1) ?? country;
    } catch {
      // Keep the original source value if it isn't a valid country identifier.
    }
  }
  if (!country) return "";
  const upper = country.toUpperCase();
  if (upper === "USA" || upper === "U.S.A.") return "United States";
  if (!/^[A-Z]{2}$/.test(upper)) return country;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(upper) ?? country;
  } catch {
    return country;
  }
}

function formatPostalAddress(address: PostalAddressLike | null | undefined): string | null {
  if (!address) return null;
  const city = scalarText(address.addressLocality);
  let region = scalarText(address.addressRegion);
  const country = normalizeCountry(scalarText(address.addressCountry));
  const isUnitedStates = /^(united states(?: of america)?|us|usa|u\.s\.)$/i.test(country);
  if (isUnitedStates && /^[A-Za-z]{2}$/.test(region)) region = US_STATES[region.toUpperCase()] ?? region;
  const parts = [city, region, country].filter(Boolean);
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

function asRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(asRecords);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record["@graph"])) return asRecords(record["@graph"]);
  return [record];
}

function isJobPosting(value: Record<string, unknown>): value is JsonLdPosting {
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  return types.some((type) => typeof type === "string" && type.toLowerCase() === "jobposting");
}

function extractJsonLdPostings(html: string): JsonLdPosting[] {
  const postings: JsonLdPosting[] = [];
  const scriptPattern = /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json(?:\s*;[^"']*)?\1[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const source = match[2].trim().replace(/^<!--\s*/, "").replace(/\s*-->$/, "");
    try {
      postings.push(...asRecords(JSON.parse(source)).filter(isJobPosting));
    } catch {
      // Broken JSON-LD is common; skip that block and keep inspecting the page.
    }
  }
  return postings;
}

function samePostingUrl(postingUrl: string, pageUrl: string): boolean {
  try {
    const posting = new URL(postingUrl);
    const page = new URL(pageUrl);
    if (posting.hostname.toLowerCase() !== page.hostname.toLowerCase()) return false;
    const host = posting.hostname.toLowerCase();
    if (host.endsWith("indeed.com")) {
      const postingId = posting.searchParams.get("jk") ?? posting.searchParams.get("vjk");
      const pageId = page.searchParams.get("jk") ?? page.searchParams.get("vjk");
      return !!postingId && postingId === pageId;
    }
    const linkedInId = (url: URL) => url.pathname.match(/\/jobs\/view\/(\d+)/i)?.[1];
    if (host.endsWith("linkedin.com")) {
      const postingId = linkedInId(posting);
      return !!postingId && postingId === linkedInId(page);
    }
    return posting.pathname.replace(/\/+$/, "") === page.pathname.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

function postingMatches(posting: JsonLdPosting, input: Pick<JobLocationScrapeInput, "title" | "company">, pageUrl: string): boolean {
  const expectedTitle = normalizeMatch(input.title);
  const actualTitle = normalizeMatch(scalarText(posting.title));
  if (expectedTitle && actualTitle === expectedTitle) return true;
  if (typeof posting.url === "string" && samePostingUrl(posting.url, pageUrl)) return true;
  return !expectedTitle;
}

function formattedPostingLocation(posting: JsonLdPosting): string | null {
  const locations = Array.isArray(posting.jobLocation) ? posting.jobLocation : [posting.jobLocation];
  const formatted = locations.flatMap((place) => {
    if (!place || typeof place !== "object") return [];
    const address = (place as Record<string, unknown>).address;
    if (Array.isArray(address)) return address.map((entry) => formatPostalAddress(entry as PostalAddressLike)).filter((x): x is string => !!x);
    return [formatPostalAddress(address as PostalAddressLike)].filter((x): x is string => !!x);
  });
  const unique = [...new Set(formatted)];
  if (unique.length) return unique.join("; ");
  const locationType = scalarText(posting.jobLocationType);
  return /telecommute/i.test(locationType) ? "Remote" : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlToVisibleText(html: string): string {
  return decodeHtmlEntities(html
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\s*(?:br|address|article|dd|div|dt|h[1-6]|li|p|section|span|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:address|article|dd|div|dt|h[1-6]|li|p|section|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\f\v ]+/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function validLocationValue(raw: string): string | null {
  const value = raw.replace(/^[-*•\s]+/, "").replace(/[|;]+$/, "").trim();
  if (!value || value.length > LOCATION_VALUE_MAX_LENGTH) return null;
  if (/^(location|job location|work location|n\/?a|not specified|unknown|various)$/i.test(value)) return null;
  if (/^(apply|apply now|view job|job details|about the job)$/i.test(value)) return null;
  return value;
}

function extractLabeledLocation(text: string, expectedTitle: string): string | null {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^\s{0,3}#{1,6}\s*/, "").trim()).filter(Boolean);
  const expectedTitleMatch = normalizeMatch(expectedTitle);
  const titleIndex = expectedTitleMatch
    ? lines.findIndex((line) => normalizeMatch(
      line
        .replace(/^(?:job\s+)?title\s*:\s*/i, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    ) === expectedTitleMatch)
    : -1;
  if (expectedTitleMatch && titleIndex < 0) return null;

  // Only trust explicit location labels in the posting header near its exact
  // title. A location somewhere else on a career/search page may describe a
  // nearby job or office and must not be copied into the resume.
  const firstCandidateLine = expectedTitleMatch ? titleIndex : 0;
  const lastCandidateLine = expectedTitleMatch ? Math.min(lines.length, titleIndex + 41) : lines.length;
  for (let index = firstCandidateLine; index < lastCandidateLine; index += 1) {
    const exactLabel = /^(?:job\s+|work\s+)?location(?:\s+of\s+(?:the\s+)?(?:job|position))?$/i.test(lines[index]);
    const labeledValue = lines[index].match(/^(?:job\s+|work\s+)?location(?:\s+of\s+(?:the\s+)?(?:job|position))?\s*(?::|[-–—])\s*(.+)$/i)?.[1];
    if (!exactLabel && !labeledValue) continue;
    const sameLine = validLocationValue(labeledValue ?? "");
    if (sameLine) return sameLine;
    const nextLine = lines[index + 1];
    if (nextLine && /^(?:company(?:\s+name)?|job\s+title|title|employment\s+type|salary|description|job\s+type|workplace\s+type|date\s+posted)\b/i.test(nextLine)) {
      continue;
    }
    const nextValue = nextLine ? validLocationValue(nextLine) : null;
    if (nextValue) return nextValue;
  }
  return null;
}

function choosePostingLocation(postings: JsonLdPosting[], input: JobLocationScrapeInput, pageUrl: string): string | null {
  let candidates = postings.filter((posting) => postingMatches(posting, input, pageUrl));
  if (candidates.length > 1 && input.company) {
    const company = normalizeMatch(input.company);
    candidates = candidates.filter((posting) => {
      const organization = posting.hiringOrganization;
      const name = organization && typeof organization === "object"
        ? scalarText((organization as Record<string, unknown>).name)
        : "";
      return normalizeMatch(name) === company;
    });
  }
  if (candidates.length !== 1) return null;
  return formattedPostingLocation(candidates[0]);
}

export function extractJobLocationFromHtml(html: string, input: JobLocationScrapeInput, pageUrl: string): { location: string; method: JobLocationExtractionMethod } | null {
  const jsonLdLocation = choosePostingLocation(extractJsonLdPostings(html), input, pageUrl);
  if (jsonLdLocation) return { location: jsonLdLocation, method: "schema_jobposting" };
  const labeledLocation = extractLabeledLocation(htmlToVisibleText(html), input.title);
  return labeledLocation ? { location: labeledLocation, method: "labeled_posting_field" } : null;
}

export function extractJobLocationFromText(text: string, expectedTitle: string): string | null {
  return extractLabeledLocation(text, expectedTitle);
}

function safePostingUrl(raw: string): boolean {
  if (!isSafeExternalUrl(raw)) return false;
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return false;
    if (hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
    return !parsed.username && !parsed.password && (!parsed.port || parsed.port === "80" || parsed.port === "443");
  } catch {
    return false;
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("Posting page exceeded the read limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      await reader.cancel();
      throw new Error("Posting page exceeded the read limit.");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

class PostingFetchError extends Error {
  constructor(message: string, readonly blocked = false) {
    super(message);
  }
}

async function fetchPublicPostingHtml(startUrl: string, timeoutMs: number): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = startUrl;
  try {
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      if (!safePostingUrl(currentUrl)) throw new PostingFetchError("Posting redirected to a disallowed URL.", true);
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; TalentOS-JobLocation/1.0)",
          Accept: "text/html,application/xhtml+xml,application/ld+json,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.8",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const target = response.headers.get("location");
        if (!target || redirects === 4) throw new PostingFetchError("Posting page redirected too many times.");
        currentUrl = new URL(target, currentUrl).toString();
        continue;
      }
      if ([401, 403, 404, 410, 429].includes(response.status)) {
        throw new PostingFetchError(`Posting site returned HTTP ${response.status}.`, true);
      }
      if (!response.ok) throw new PostingFetchError(`Posting site returned HTTP ${response.status}.`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !/(html|xhtml|json|text\/plain)/i.test(contentType)) {
        throw new PostingFetchError("The posting link did not return a readable job page.");
      }
      const html = await readBoundedText(response, MAX_HTML_BYTES);
      if (!html.trim()) throw new PostingFetchError("Posting page was empty.");
      return { html, finalUrl: currentUrl };
    }
    throw new PostingFetchError("Posting page redirected too many times.");
  } catch (error) {
    if (error instanceof PostingFetchError) throw error;
    if (controller.signal.aborted) throw new PostingFetchError("Posting page took too long to load.");
    throw new PostingFetchError(error instanceof Error ? error.message : "Posting page could not be fetched.");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRenderedPostingText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const proxyUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain",
        "X-Return-Format": "markdown",
        "X-Timeout": "8",
        "X-Remove-Selector": "nav,footer,header,[role='navigation']",
        "User-Agent": "TalentOS-JobCEO/1.0",
      },
    });
    if (!response.ok) return null;
    const text = await readBoundedText(response, MAX_TEXT_BYTES);
    if (!text.trim() || looksLikeLoginWall(text) || looksLikeErrorPage(text)
      || /captcha|access denied|verify you(?:'re| are) human/i.test(text.slice(0, 1500))) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeJobLocationFromPosting(input: JobLocationScrapeInput): Promise<JobLocationScrapeResult> {
  const rawUrls = [input.sourceUrl, input.applyUrl].filter((url): url is string => typeof url === "string" && !!url.trim());
  if (rawUrls.length === 0) {
    return { ok: false, reason: "no_links", message: "This job has no posting or apply link to check." };
  }

  const candidateUrls: string[] = [];
  for (const rawUrl of rawUrls) {
    if (!safePostingUrl(rawUrl)) {
      continue;
    }
    const detailUrl = normalizeJobDetailUrl(rawUrl);
    for (const candidate of [detailUrl, ...(detailUrl === rawUrl ? [] : [rawUrl])]) {
      if (safePostingUrl(candidate) && !candidateUrls.includes(candidate)) candidateUrls.push(candidate);
    }
  }
  if (candidateUrls.length === 0) {
    return { ok: false, reason: "unsafe_link", message: "The saved posting and apply links are not safe public web URLs, so TalentOS did not fetch them." };
  }

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let wasBlocked = false;
  let pageWasRead = false;
  let timedOut = false;
  let fetchFailed = false;
  for (const url of candidateUrls) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const page = await fetchPublicPostingHtml(url, Math.min(7_000, remaining));
      pageWasRead = true;
      const visibleText = htmlToVisibleText(page.html);
      if (looksLikeLoginWall(visibleText) || looksLikeErrorPage(visibleText)) {
        wasBlocked = true;
        continue;
      }
      const extracted = extractJobLocationFromHtml(page.html, input, page.finalUrl);
      if (extracted) {
        return { ok: true, ...extracted, sourceHost: new URL(page.finalUrl).hostname };
      }
      const proxyRemaining = deadline - Date.now();
      if (proxyRemaining > 0) {
        const renderedText = await fetchRenderedPostingText(page.finalUrl, Math.min(9_000, proxyRemaining));
        if (renderedText) {
          const location = extractJobLocationFromText(renderedText, input.title);
          if (location) {
            return { ok: true, location, method: "labeled_posting_field", sourceHost: new URL(page.finalUrl).hostname };
          }
        }
      }
    } catch (error) {
      if (error instanceof PostingFetchError && error.blocked) wasBlocked = true;
      else if (error instanceof PostingFetchError && /took too long/i.test(error.message)) timedOut = true;
      else fetchFailed = true;
    }
  }

  if (wasBlocked) {
    return { ok: false, reason: "blocked", message: "The posting site denied automated access or requires verification. TalentOS left the location unchanged." };
  }
  if (!pageWasRead && timedOut) {
    return { ok: false, reason: "timeout", message: "The posting page timed out before TalentOS could verify its location. No job data was changed." };
  }
  if (!pageWasRead && fetchFailed) {
    return { ok: false, reason: "fetch_failed", message: "TalentOS could not load the posting or apply page. No job data was changed." };
  }
  return { ok: false, reason: "no_explicit_location", message: "TalentOS could not verify an explicit job location on the posting or apply page. The job location was left blank." };
}
