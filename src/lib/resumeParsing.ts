// src/lib/resumeParsing.ts
// Extract text from PDF/DOCX, then parse structured fields via AI.
// Dependencies: mammoth (DOCX). PDF extraction is hand-rolled - see extractText.

import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";
import type { AiMessage } from "@/lib/ai/provider";
import type { AiProvider } from "@/lib/ai/provider";

// #region debug-point A:resume-parsing-debug
function reportResumeParsingDebug(
  hypothesisId: "A" | "B" | "C" | "D" | "E",
  msg: string,
  data: Record<string, unknown> = {}
) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "base-resume-load-loop",
      runId: "pre-fix",
      hypothesisId,
      location: "src/lib/resumeParsing.ts",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}

function serializeDebugError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function logResumeParsingConsole(step: string, data: Record<string, unknown> = {}) {
  console.log(`[BASE_RESUME_PARSE] ${step}`, data);
}
// #endregion

// #region debug-point A:linkedin-url-seeding-debug
function reportLinkedinUrlSeedingDebug(
  hypothesisId: "A" | "B" | "C" | "D" | "E",
  msg: string,
  data: Record<string, unknown> = {}
) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "linkedin-url-seeding",
      runId: "pre-fix",
      hypothesisId,
      location: "src/lib/resumeParsing.ts",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

// PDF text extraction, decompressing /FlateDecode content streams via the
// standard Web Platform DecompressionStream API, then regex-matching Tj/TJ
// text-show operators on the decompressed result.
//
// History: three different library-based approaches were each confirmed broken
// specifically on the Cloudflare Workers deploy (never reproducible locally):
//   1. pdf-parse depends on @napi-rs/canvas, a native/compiled addon - workerd
//      cannot load native binaries at all.
//   2. pdfjs-dist's legacy build (no native deps) still throws
//      "DOMMatrix is not defined" from an internal code path unrelated to text
//      extraction, triggered by some feature of the real PDF tested against (not
//      reproducible with a minimal synthetic test PDF) - fixable with a polyfill,
//      but then:
//   3. pdfjs-dist's own isNodeJS environment check doesn't pass in workerd (its
//      process global lacks the same Symbol.toStringTag real Node sets), so it
//      tries to spawn a literal `new Worker(workerSrc)` and throws 'No
//      "GlobalWorkerOptions.workerSrc" specified.' Patching that check to pass
//      then required importing pdfjs-dist's separate pdf.worker.mjs bundle (its
//      actual parsing engine, needed even for the in-process "fake worker" path),
//      which alone pushed the gzipped Worker over Cloudflare's 3072 KiB limit.
//
// All three failure modes are different facets of the same root cause: pdf.js
// (any version, any build target) is built assuming a real browser or a real
// Node.js process, and Cloudflare Workers is neither. Writing the extraction
// directly against APIs workerd actually supports avoids the whole category of
// problem. Confirmed against a real uploaded resume (not a synthetic test PDF):
// extracted more text than the pdfjs-dist path managed (7251 vs 5503 chars) -
// this implementation doesn't need a font/glyph layer to know where on the page
// each character would render, only to find the literal strings PDF's Tj/TJ
// operators pass to the renderer.
async function inflateDeflateStream(data: Uint8Array): Promise<Uint8Array> {
  // The extra `new Uint8Array(data)` copy guarantees a plain ArrayBuffer-backed
  // view, which is what BlobPart actually requires - same fix as
  // src/lib/integrations/sharepoint.ts and src/lib/markitdown.ts.
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream("deflate"));
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) chunks.push(chunk);
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function extractTextShowOperators(content: string): string[] {
  const extracted: string[] = [];
  const btEtBlocks = content.match(/BT[\s\S]*?ET/g) ?? [];
  for (const block of btEtBlocks) {
    const tjMatches = block.match(/\([^)]*\)\s*Tj/g) ?? [];
    for (const m of tjMatches) {
      const start = m.indexOf("(");
      const end = m.lastIndexOf(")");
      extracted.push(m.slice(start + 1, end).replace(/\\(.)/g, "$1"));
    }
    const tjArrayMatches = block.match(/\[[^\]]*\]\s*TJ/g) ?? [];
    for (const arr of tjArrayMatches) {
      const strings = arr.match(/\([^)]*\)/g) ?? [];
      for (const s of strings) extracted.push(s.slice(1, -1).replace(/\\(.)/g, "$1"));
    }
  }
  return extracted;
}

async function extractTextFromPdfBuffer(buffer: Uint8Array): Promise<string> {
  const raw = buffer;
  const latin1 = new TextDecoder("latin1").decode(raw);
  const streamHeaderRe = /(<<[^>]*?>>)\s*stream\r?\n/g;
  const allText: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = streamHeaderRe.exec(latin1))) {
    const dict = match[1];
    const streamStart = match.index + match[0].length;
    const endIdx = latin1.indexOf("endstream", streamStart);
    if (endIdx === -1) continue;
    let streamEnd = endIdx;
    while (streamEnd > streamStart && (latin1[streamEnd - 1] === "\n" || latin1[streamEnd - 1] === "\r")) streamEnd--;

    const rawBytes = raw.subarray(streamStart, streamEnd);

    if (dict.includes("/FlateDecode")) {
      try {
        const inflated = await inflateDeflateStream(new Uint8Array(rawBytes));
        allText.push(...extractTextShowOperators(new TextDecoder("latin1").decode(inflated)));
      } catch {
        // Not actually deflate-compressed text (e.g. an image stream that
        // happens to also be tagged /FlateDecode) - skip it.
      }
    } else if (!dict.includes("/Filter")) {
      allText.push(...extractTextShowOperators(new TextDecoder("latin1").decode(rawBytes)));
    }
  }

  return allText.join(" ").replace(/\s+/g, " ").trim();
}

export interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin_url?: string;
  github_url?: string;
  portfolio_url?: string;
  summary?: string;
  skills: string[];
  experience: Array<{
    company: string;
    title: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    bullets: string[];
  }>;
  education: Array<{
    school: string;
    degree: string;
    field?: string;
    graduationDate?: string;
  }>;
  projects?: Array<{
    name: string;
    description?: string;
    technologies?: string[];
    bullets?: string[];
    url?: string;
  }>;
  certifications: string[];
  raw_text: string;
  parse_error?: string;
}

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

const COMMON_RESUME_SECTION_TITLES = [
  "summary",
  "professional summary",
  "profile",
  "experience",
  "professional experience",
  "work experience",
  "employment history",
  "education",
  "projects",
  "certifications",
  "awards",
  "publications",
  "volunteer experience",
  "languages",
  "interests",
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\r/g, "").replace(/\u00A0/g, " ");
}

function isLikelySectionHeading(line: string): boolean {
  const normalized = line.replace(/^#+\s*/, "").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (COMMON_RESUME_SECTION_TITLES.includes(lower)) return true;

  const lettersOnly = normalized.replace(/[^A-Za-z]/g, "");
  if (!lettersOnly) return false;
  const uppercaseRatio = lettersOnly.replace(/[^A-Z]/g, "").length / lettersOnly.length;
  return uppercaseRatio > 0.85 && normalized.split(/\s+/).length <= 5;
}

function cleanSkillLine(line: string): string {
  return line
    .replace(/^[-*•●▪◦]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Words that are clearly fragments of a skill name rather than real category titles.
// Detecting these helps the fallback prefer raw-text extraction over bad AI output.
const FRAGMENT_TITLES = new Set([
  "as", "xgs", "detail", "cross", "skills", "engineering",
  "communication", "design", "technical", "analytical",
  "pon", "built", "oriented", "functional",
]);

function isLikelySkillCategoryTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  if (lower === "technical skills" || lower === "skills") return false;
  if (normalized.length < 8) return false;
  // Reject single-word titles that look like fragments of compound names
  if (FRAGMENT_TITLES.has(lower)) return false;
  return /[\s/&]/.test(normalized) || normalized.length >= 18;
}

function extractSkillsSectionLines(rawText: string): string[] {
  const normalized = normalizeWhitespace(rawText);
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const startIndex = lines.findIndex((line) => {
    const normalizedLine = line.replace(/^#+\s*/, "").replace(/[:\-]+$/, "").trim().toLowerCase();
    return normalizedLine === "technical skills" || normalizedLine === "skills";
  });

  if (startIndex === -1) return [];

  const sectionLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (sectionLines.length > 0 && isLikelySectionHeading(line)) break;
    sectionLines.push(line);
  }

  return sectionLines;
}

function extractCategorizedSkillsFromRawText(rawText: string): string[] {
  const sectionLines = extractSkillsSectionLines(rawText);
  if (sectionLines.length === 0) return [];

  const categories: Array<{ title: string; content: string[] }> = [];
  let currentCategory: { title: string; content: string[] } | null = null;

  for (const rawLine of sectionLines) {
    const line = cleanSkillLine(rawLine);
    if (!line) continue;

    // Match on the FIRST colon that separates a category title from skills.
    // The title must pass isLikelySkillCategoryTitle to avoid splitting on
    // colons inside skill names (e.g., "XGS-PON" should not become "XGS: PON").
    const match = line.match(/^([^:]{3,80}):\s*(.+)$/);
    if (match && isLikelySkillCategoryTitle(match[1])) {
      currentCategory = {
        title: match[1].replace(/\s+/g, " ").trim(),
        content: [match[2].trim()],
      };
      categories.push(currentCategory);
      continue;
    }

    // If no category matched yet but the line contains a colon with a
    // long-enough multi-word title, try a more lenient match that requires
    // the title to contain a space (i.e., at least two words).
    if (!currentCategory && !match) {
      const lenientMatch = line.match(/^([A-Za-z][A-Za-z &/,+()-]{7,80}):\s{1,3}(.+)$/);
      if (lenientMatch && /\s/.test(lenientMatch[1].trim())) {
        currentCategory = {
          title: lenientMatch[1].replace(/\s+/g, " ").trim(),
          content: [lenientMatch[2].trim()],
        };
        categories.push(currentCategory);
        continue;
      }
    }

    if (currentCategory) {
      currentCategory.content.push(line);
    }
  }

  return categories
    .map((category) => `${category.title}: ${category.content.join(" ").replace(/\s+/g, " ").trim()}`)
    .filter((entry) => entry.includes(":"));
}

function splitSkillSegments(rawSkill: string): string[] {
  const trimmed = rawSkill.trim();
  if (!trimmed) return [];

  // Preserve already-valid categorized skill strings as a single segment.
  // The parser often returns one category per string, e.g.
  // "OSP Design & Engineering: AutoCAD, FTTx ...". Re-splitting these on the
  // generic label matcher corrupts titles into fragments like "OSP" / "Design &".
  const existingCategoryTitle = parseSkillCategoryTitle(trimmed);
  if (existingCategoryTitle && isLikelySkillCategoryTitle(existingCategoryTitle)) {
    return [trimmed];
  }

  const normalized = trimmed
    .replace(/[•●▪◦]/g, "\n")
    .replace(/\s+\|\s+/g, "\n")
    .replace(/\s*;\s*/g, "\n");

  let segments = normalized
    .split(/\r?\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const labelMatches = normalized.match(/\b[A-Za-z][A-Za-z/&+ ]{1,40}\s*[:\-]/g) ?? [];
  if (segments.length <= 1 && labelMatches.length > 1) {
    segments = normalized
      .split(/(?=\b[A-Za-z][A-Za-z/&+ ]{1,40}\s*[:\-])/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  return segments.length > 0 ? segments : [trimmed];
}

function normalizeParsedSkills(rawSkills: unknown): string[] {
  if (!Array.isArray(rawSkills)) return [];

  const normalized = rawSkills.flatMap((skill) => {
    if (typeof skill === "string") return splitSkillSegments(skill);
    if (typeof skill === "number" || typeof skill === "boolean") return [String(skill)];
    return [];
  });

  return uniqStrings(normalized);
}

function splitSkillCategoryEntry(value: string): { title: string; content: string } | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const colonIndex = normalized.indexOf(":");
  const dashIndex = normalized.indexOf(" - ");

  let separatorIndex = -1;
  let separatorLength = 0;

  if (colonIndex !== -1 && (dashIndex === -1 || colonIndex < dashIndex)) {
    separatorIndex = colonIndex;
    separatorLength = 1;
  } else if (dashIndex !== -1) {
    separatorIndex = dashIndex;
    separatorLength = 3;
  }

  if (separatorIndex === -1) return null;

  const title = normalized.slice(0, separatorIndex).trim();
  const content = normalized.slice(separatorIndex + separatorLength).trim();
  if (!title || !content) return null;

  return { title, content };
}

function parseSkillCategoryTitle(value: string): string | null {
  return splitSkillCategoryEntry(value)?.title ?? null;
}

function parsedSkillsContainValidCategories(parsedSkills: string[]): boolean {
  return parsedSkills
    .flatMap((skill) => splitSkillSegments(skill))
    .some((segment) => {
      const title = parseSkillCategoryTitle(segment);
      return title ? isLikelySkillCategoryTitle(title) : false;
    });
}

function parsedSkillsContainMalformedCategories(parsedSkills: string[]): boolean {
  return parsedSkills
    .flatMap((skill) => splitSkillSegments(skill))
    .some((segment) => {
      const title = parseSkillCategoryTitle(segment);
      return title ? !isLikelySkillCategoryTitle(title) : false;
    });
}

function shouldPreferRawSkillCategories(rawSkillCategories: string[], parsedSkills: string[]): boolean {
  if (rawSkillCategories.length === 0) return false;

  // Prefer raw section extraction when the model failed to return any skills,
  // flattened a clearly categorized skills section into a plain list, or
  // produced malformed fragment categories like "As" / "XGS".
  if (parsedSkills.length === 0) return true;
  if (parsedSkillsContainMalformedCategories(parsedSkills)) return true;
  if (!parsedSkillsContainValidCategories(parsedSkills)) return true;

  return false;
}

function cleanExtractedUrl(url: string): string {
  let cleaned = url.trim();
  cleaned = cleaned.replace(/^[<(["']+/, "").replace(/[>)\]"',.;:|•·]+$/, "");
  cleaned = cleaned.replace(/\s+/g, "");
  cleaned = cleaned.replace(/^http:\/\//i, "https://");
  if (/^linkedin\.com\//i.test(cleaned)) cleaned = `https://www.${cleaned}`;
  if (/^www\.linkedin\.com\//i.test(cleaned)) cleaned = `https://${cleaned}`;
  cleaned = cleaned.replace(/^https:\/\/linkedin\.com\//i, "https://www.linkedin.com/");
  return cleaned;
}

function extractLinkedInUrl(rawText: string): string | undefined {
  if (!rawText.trim()) return undefined;

  const directMatch = rawText.match(/((?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)<\]"',;|•·]+)/i);
  if (directMatch?.[1]) return cleanExtractedUrl(directMatch[1]);

  const normalizedText = rawText
    .replace(/linked\s*[-–—]?\s*in/gi, "linkedin")
    .replace(/\s*\.\s*/g, ".")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*:\s*\/\s*\//g, "://");

  const normalizedMatch = normalizedText.match(/((?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s)<\]"',;|•·]+)/i);
  if (normalizedMatch?.[1]) return cleanExtractedUrl(normalizedMatch[1]);

  const profilePathMatch = normalizedText.match(/linkedin\s*[:\-]?\s*((?:\/)?in\/[A-Za-z0-9-_%]+\/?)/i);
  if (profilePathMatch?.[1]) {
    const profilePath = profilePathMatch[1].replace(/^\//, "");
    return `https://www.linkedin.com/${profilePath}`;
  }

  // Last resort: look for "in/username" pattern near the word "linkedin"
  const looseMatch = normalizedText.match(/linkedin[^a-z]{0,20}(in\/[A-Za-z0-9-_%]+)/i);
  if (looseMatch?.[1]) {
    return `https://www.linkedin.com/${looseMatch[1]}`;
  }

  return undefined;
}

/** Public alias for extractLinkedInUrl so other modules can use the regex fallback. */
export function extractLinkedInUrlFromText(rawText: string): string | undefined {
  return extractLinkedInUrl(rawText);
}

export function extractLinkedInUrlFromBinary(buffer: Uint8Array): string | undefined {
  try {
    const len = buffer.length;
    const head = new TextDecoder("latin1").decode(buffer.subarray(0, Math.min(len, 800_000)));
    const tail = new TextDecoder("latin1").decode(buffer.subarray(Math.max(0, len - 800_000)));
    const combined = `${head}\n${tail}`;

    const candidates = combined.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[A-Za-z0-9/_\-?&=%\.]+/gi) ?? [];
    if (candidates.length === 0) return undefined;

    const first = candidates[0];
    if (!first) return undefined;

    const preferred =
      candidates.find((c) => /linkedin\.com\/in\//i.test(c)) ??
      first;

    return cleanExtractedUrl(preferred);
  } catch {
    return undefined;
  }
}

function normalizeLinkedInUrl(rawLinkedInUrl: unknown, rawText: string): string | undefined {
  if (typeof rawLinkedInUrl === "string" && rawLinkedInUrl.trim()) {
    const extracted = extractLinkedInUrl(rawLinkedInUrl);
    if (extracted) return extracted;

    const cleaned = cleanExtractedUrl(rawLinkedInUrl);
    const lower = cleaned.toLowerCase();
    if (lower.includes("linkedin.com/") && !/[|•·]/.test(cleaned)) return cleaned;
  }

  return extractLinkedInUrl(rawText);
}

/**
 * Extract raw text from a resume buffer (PDF or DOCX).
 */
export async function extractText(buffer: Uint8Array, mimeType: string): Promise<string> {
  const type = mimeType.toLowerCase();

  if (type.includes("pdf")) {
    const text = await extractTextFromPdfBuffer(buffer);
    // #region debug-point A:extract-pdf-text
    reportResumeParsingDebug("A", "resume text extracted from pdf", {
      mimeType: type,
      textLength: text.length,
      rawText: text,
    });
    // #endregion
    return text;
  }

  if (type.includes("docx") || type.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const nodeBuffer = Buffer.from(buffer);
    const result = await mammoth.extractRawText({ buffer: nodeBuffer });
    const text = result.value ?? "";
    // #region debug-point A:extract-docx-text
    reportResumeParsingDebug("A", "resume text extracted from docx", {
      mimeType: type,
      textLength: text.length,
      rawText: text,
    });
    // #endregion
    return text;
  }

  if (type.includes("doc") && !type.includes("docx")) {
    // Legacy .doc — no reliable pure-JS parser; return empty so caller can handle.
    // #region debug-point E:extract-doc-text
    reportResumeParsingDebug("E", "legacy doc extraction returned empty text", {
      mimeType: type,
    });
    // #endregion
    return "";
  }

  // Fallback: try utf-8 text
  try {
    const text = new TextDecoder().decode(buffer);
    // #region debug-point A:extract-fallback-text
    reportResumeParsingDebug("A", "resume text extracted via fallback decoder", {
      mimeType: type,
      textLength: text.length,
      rawText: text,
    });
    // #endregion
    return text;
  } catch (error) {
    // #region debug-point E:extract-fallback-error
    reportResumeParsingDebug("E", "fallback text extraction failed", {
      mimeType: type,
      error: serializeDebugError(error),
    });
    // #endregion
    return "";
  }
}

const PARSE_PROMPT = `You are an expert resume parser. Your job is to extract EVERY SINGLE piece of structured information from the resume text below. Be thorough and exhaustive. Do not skip sections. Do not summarize — extract full details.

Return ONLY a JSON object matching this exact schema (no markdown, no commentary, just raw JSON):

{
  "name": string | null,
  "email": string | null,
  "phone": string | null,
  "location": string | null,
  "linkedin_url": string | null,
  "github_url": string | null,
  "portfolio_url": string | null,
  "summary": string | null,
  "skills": [
    {
      "category": "string | null",
      "items": ["string"]
    }
  ],
  "projects": [
    {
      "name": string,
      "description": string | null,
      "technologies": ["string"],
      "bullets": ["string"],
      "url": string | null
    }
  ],
  "experience": [
    {
      "company": string,
      "title": string,
      "location": string | null,
      "startDate": string | null,
      "endDate": string | null,
      "bullets": string[]
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string,
      "field": string | null,
      "graduationDate": string | null
    }
  ],
  "certifications": string[]
}

CRITICAL RULES:
- EXTRACT EVERYTHING. Do not skip any section, job, skill, degree, or certification.
- For skills: list EVERY skill you can find. Be specific (e.g., "React" not "frontend").
- SKILL CATEGORIES: Extract skills as an array of objects with a 'category' and 'items'.
  - If the resume groups skills inline by category (e.g., "OSP Design & Engineering: AutoCAD, FTTx Network Planning..."), set the "category" to the FULL exact title before the colon (e.g., "OSP Design & Engineering") and split the trailing comma-separated items into the "items" array.
  - Do NOT truncate, shorten, or alter the category title. Keep it exactly as written (e.g., "Automation, Data & Process Optimization").
  - Handle parenthetical additions correctly: items containing ratios, limits, or tools inside parentheses (e.g., "Splitter Configuration (1:32)", "Advanced Microsoft Excel (Pivot Tables, VLOOKUP, VBA)", "AutoLISP (Drafting Automation)") are SINGLE individual skills. Do NOT split them into separate array items.
  - Skill names like "XGS-PON", "As-Built", "HLD/LLD", "QA/QC" contain hyphens or slashes — these are SINGLE skills, NOT category separators.
  - If skills are NOT categorized, set "category" to null.
- For projects: create an entry for every project mentioned (academic, personal, or professional). Extract the name, a short description, technologies used, any bullet points, and a link/url if available.
- For experience: create an entry for EVERY job. Extract ALL bullet points for each job — do not summarize, do not truncate.
- For education: include EVERY degree, diploma, or certification program.
- For certifications: include every certification mentioned anywhere in the resume.
- For linkedin_url: Look carefully for any LinkedIn profile reference. It may appear as a full URL, a spaced/broken URL like "linkedin . com / in / name", or text like "Linked In" followed by a profile path. Normalize it to a canonical "https://www.linkedin.com/in/username" URL. Also check the header/contact section for LinkedIn icons or labels.
- Dates: prefer 'Month Year' or just 'Year'. Use null if unparseable.
- Current jobs: set endDate to null.
- If a field is truly missing, use null for strings and [] for arrays.
- Do NOT hallucinate information not present in the text.
- Return ONLY the JSON object, no markdown code fences, no explanation.`;

const MARKDOWN_PARSE_PROMPT = `You are an expert resume parser. The input is a resume converted to clean Markdown. Extract structured information and return ONLY a JSON object matching this exact schema (no markdown, no commentary, just raw JSON):

{
  "name": string | null,
  "email": string | null,
  "phone": string | null,
  "location": string | null,
  "linkedin_url": string | null,
  "github_url": string | null,
  "portfolio_url": string | null,
  "summary": string | null,
  "skills": [
    {
      "category": "string | null",
      "items": ["string"]
    }
  ],
  "projects": [
    {
      "name": string,
      "description": string | null,
      "technologies": ["string"],
      "bullets": ["string"],
      "url": string | null
    }
  ],
  "experience": [
    {
      "company": string,
      "title": string,
      "location": string | null,
      "startDate": string | null,
      "endDate": string | null,
      "bullets": string[]
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string,
      "field": string | null,
      "graduationDate": string | null
    }
  ],
  "certifications": string[]
}

CRITICAL RULES:
- Markdown headers (##) usually indicate sections. Experience entries often have dates in them.
- Bullet points (- or *) are individual job responsibilities or achievements. Extract ALL of them.
- Skills may be in a dedicated section or scattered. Collect them ALL.
- SKILL CATEGORIES: Extract skills as an array of objects with a 'category' and 'items'.
  - If the markdown shows categorized skills inline (e.g., "OSP Design & Engineering: AutoCAD, FTTx Network Planning..."), set the "category" to the FULL exact title before the colon (e.g., "OSP Design & Engineering") and split the trailing comma-separated items into the "items" array.
  - Do NOT truncate, shorten, or alter the category title. Keep it exactly as written (e.g., "Automation, Data & Process Optimization").
  - Handle parenthetical additions correctly: items containing ratios, limits, or tools inside parentheses (e.g., "Splitter Configuration (1:32)", "Advanced Microsoft Excel (Pivot Tables, VLOOKUP, VBA)", "AutoLISP (Drafting Automation)") are SINGLE individual skills. Do NOT split them into separate array items.
  - Skill names containing hyphens or slashes like "XGS-PON", "As-Built", "HLD/LLD", "QA/QC" are SINGLE skills — do NOT split them into separate categories.
  - If skills are NOT categorized, set "category" to null.
- For projects: create an entry for every project mentioned (academic, personal, or professional). Extract the name, a short description, technologies used, any bullet points, and a link/url if available.
- For linkedin_url: Look carefully for LinkedIn profile references, including full URLs, spaced/broken URLs like "linkedin . com / in / name", or text like "LinkedIn" followed by a profile path. Normalize to "https://www.linkedin.com/in/username".
- Dates: prefer 'Month Year' or just 'Year'. Use null if unparseable.
- Current jobs: set endDate to null.
- Do NOT hallucinate information not present in the markdown.
- Return ONLY the JSON object, no markdown code fences, no explanation.`;

// New: Parse from markdown (better quality, fewer tokens)
export async function parseResumeFromMarkdown(markdown: string, rawTextForNormalization?: string): Promise<ParsedResume> {
  // #region debug-point A:markdown-parse-start
  reportResumeParsingDebug("A", "markdown parse started", {
    markdownLength: markdown.length,
    markdown,
  });
  // #endregion
  logResumeParsingConsole("markdown parse started", {
    markdownLength: markdown.length,
    markdown,
  });

  const messages: AiMessage[] = [
    { role: "user", content: [{ type: "text", text: `${MARKDOWN_PARSE_PROMPT}\n\n--- RESUME MARKDOWN ---\n${markdown}\n--- END RESUME MARKDOWN ---` }] },
  ];

  try {
    const { result } = await callWithUsageTracking("resume_parsing", undefined, async (provider) => {
      const response = await provider.send({
        system: "You are a resume parser. Extract structured data from markdown and return ONLY raw JSON.",
        messages,
        tools: [],
      });

    const text = textOf(response.content) ?? "";
    // #region debug-point B:markdown-provider-raw-response
    reportResumeParsingDebug("B", "markdown provider returned raw response", {
      responseLength: text.length,
      rawProviderText: text,
    });
    // #endregion
    logResumeParsingConsole("markdown provider raw response", {
      responseLength: text.length,
      rawProviderText: text,
    });
    const clean = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(clean) as any;

    if (Array.isArray(parsed.skills)) {
      parsed.skills = parsed.skills.map((s: any) => {
        if (typeof s === "string") return s;
        if (s.category && Array.isArray(s.items)) return `${s.category}: ${s.items.join(", ")}`;
        if (Array.isArray(s.items)) return s.items.join(", ");
        return "";
      }).filter(Boolean);
    }

    // #region debug-point B:markdown-provider-normalized
    reportResumeParsingDebug("B", "markdown provider response normalized before finalize", {
      parsedSkills: Array.isArray(parsed.skills) ? parsed.skills : [],
      summary: parsed?.summary ?? null,
      experienceCount: Array.isArray(parsed?.experience) ? parsed.experience.length : 0,
      educationCount: Array.isArray(parsed?.education) ? parsed.education.length : 0,
      certificationsCount: Array.isArray(parsed?.certifications) ? parsed.certifications.length : 0,
    });
    // #endregion
    logResumeParsingConsole("markdown provider normalized response", {
      parsedSkills: Array.isArray(parsed.skills) ? parsed.skills : [],
      summary: parsed?.summary ?? null,
      experienceCount: Array.isArray(parsed?.experience) ? parsed.experience.length : 0,
      educationCount: Array.isArray(parsed?.education) ? parsed.education.length : 0,
      certificationsCount: Array.isArray(parsed?.certifications) ? parsed.certifications.length : 0,
    });

    const normalizedRawText = (() => {
      const fallback = typeof rawTextForNormalization === "string" ? rawTextForNormalization.trim() : "";
      const md = markdown.trim();
      if (!fallback) return markdown;
      if (fallback === md) return markdown;
      return `${rawTextForNormalization}\n${markdown}`;
    })();

      return finalizeParsedResume(parsed as Partial<ParsedResume>, normalizedRawText);
    });
    return result;
  } catch (err: any) {
    // #region debug-point E:markdown-parse-error
    reportResumeParsingDebug("E", "markdown parse failed", {
      markdownLength: markdown.length,
      markdown,
      error: serializeDebugError(err),
    });
    // #endregion
    logResumeParsingConsole("markdown parse failed", {
      markdownLength: markdown.length,
      markdown,
      error: serializeDebugError(err),
    });
    return { skills: [], experience: [], education: [], certifications: [], raw_text: markdown, parse_error: err?.message ?? serializeDebugError(err) };
  }
}


export function finalizeParsedResume(parsed: Partial<ParsedResume>, rawText: string): ParsedResume {
  const normalizedSkills = normalizeParsedSkills(parsed.skills);
  const rawSkillCategories = extractCategorizedSkillsFromRawText(rawText);
  const skillSectionLines = extractSkillsSectionLines(rawText);
  const preferRawSkillCategories = shouldPreferRawSkillCategories(rawSkillCategories, normalizedSkills);
  const normalizedLinkedinUrl = normalizeLinkedInUrl(parsed.linkedin_url, rawText);

  // #region debug-point C:finalize-skills
  reportResumeParsingDebug("C", "finalizing parsed resume skills", {
    rawTextLength: rawText.length,
    rawText,
    rawSkillSectionLines: skillSectionLines,
    aiNormalizedSkills: normalizedSkills,
    rawSkillCategories,
    preferRawSkillCategories,
    selectedSkills: preferRawSkillCategories ? rawSkillCategories : normalizedSkills,
  });
  // #endregion
  logResumeParsingConsole("finalizing parsed resume skills", {
    rawTextLength: rawText.length,
    rawText,
    rawSkillSectionLines: skillSectionLines,
    aiNormalizedSkills: normalizedSkills,
    rawSkillCategories,
    preferRawSkillCategories,
    selectedSkills: preferRawSkillCategories ? rawSkillCategories : normalizedSkills,
  });

  const finalized = {
    name: parsed.name || undefined,
    email: parsed.email || undefined,
    phone: parsed.phone || undefined,
    location: parsed.location || undefined,
    linkedin_url: normalizedLinkedinUrl,
    github_url: parsed.github_url || undefined,
    portfolio_url: parsed.portfolio_url || undefined,
    summary: parsed.summary || undefined,
    skills: preferRawSkillCategories
      ? rawSkillCategories
      : normalizedSkills,
    experience: Array.isArray(parsed.experience) ? parsed.experience : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
    raw_text: rawText,
  };

  // #region debug-point B:linkedin-url-seeding-normalization
  if (!finalized.linkedin_url && /(linkedin|lnkd\.in)/i.test(rawText)) {
    reportLinkedinUrlSeedingDebug("B", "linkedin normalization produced null despite linkedin-like text present", {
      hasParsedLinkedinField: typeof parsed.linkedin_url === "string" && parsed.linkedin_url.trim().length > 0,
      parsedLinkedinField: typeof parsed.linkedin_url === "string" ? parsed.linkedin_url.trim().slice(0, 200) : null,
      rawTextHasLinkedInWord: /linkedin/i.test(rawText),
      rawTextHasLnkdIn: /lnkd\.in/i.test(rawText),
    });
  }
  // #endregion

  // #region debug-point C:finalize-result
  reportResumeParsingDebug("C", "parsed resume finalized", {
    selectedSkills: finalized.skills,
    experienceCount: finalized.experience.length,
    educationCount: finalized.education.length,
    projectCount: finalized.projects?.length ?? 0,
    certificationsCount: finalized.certifications.length,
  });
  // #endregion
  logResumeParsingConsole("parsed resume finalized", {
    parsedJson: finalized,
  });

  return finalized;
}

export async function parseResumeTextWithProvider(rawText: string, provider: AiProvider | null): Promise<ParsedResume> {
  if (!provider) {
    // #region debug-point E:text-no-provider
    reportResumeParsingDebug("E", "raw text parse skipped because no provider is configured", {
      rawTextLength: rawText.length,
      rawText,
    });
    // #endregion
    logResumeParsingConsole("raw text parse skipped: no provider", {
      rawTextLength: rawText.length,
      rawText,
    });
    return { skills: [], experience: [], education: [], certifications: [], raw_text: rawText };
  }

  // #region debug-point A:text-parse-start
  reportResumeParsingDebug("A", "raw text parse started", {
    rawTextLength: rawText.length,
    rawText,
  });
  // #endregion
  logResumeParsingConsole("raw text parse started", {
    rawTextLength: rawText.length,
    rawText,
  });

  const messages: AiMessage[] = [
    { role: "user", content: [{ type: "text", text: `${PARSE_PROMPT}\n\n--- RESUME TEXT ---\n${rawText}\n--- END RESUME TEXT ---` }] },
  ];

  try {
    const response = await provider.send({
      system: "You are a resume parser. Extract structured data and return ONLY raw JSON.",
      messages,
      tools: [],
    });

    const text = textOf(response.content) ?? "";
    // #region debug-point B:text-provider-raw-response
    reportResumeParsingDebug("B", "raw text provider returned raw response", {
      responseLength: text.length,
      rawProviderText: text,
    });
    // #endregion
    logResumeParsingConsole("raw text provider raw response", {
      responseLength: text.length,
      rawProviderText: text,
    });
    const clean = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(clean) as any;
    
    if (Array.isArray(parsed.skills)) {
      parsed.skills = parsed.skills.map((s: any) => {
        if (typeof s === "string") return s;
        if (s.category && Array.isArray(s.items)) return `${s.category}: ${s.items.join(", ")}`;
        if (Array.isArray(s.items)) return s.items.join(", ");
        return "";
      }).filter(Boolean);
    }

    // #region debug-point B:text-provider-normalized
    reportResumeParsingDebug("B", "raw text provider response normalized before finalize", {
      parsedSkills: Array.isArray(parsed.skills) ? parsed.skills : [],
      summary: parsed?.summary ?? null,
      experienceCount: Array.isArray(parsed?.experience) ? parsed.experience.length : 0,
      educationCount: Array.isArray(parsed?.education) ? parsed.education.length : 0,
      certificationsCount: Array.isArray(parsed?.certifications) ? parsed.certifications.length : 0,
    });
    // #endregion
    logResumeParsingConsole("raw text provider normalized response", {
      parsedSkills: Array.isArray(parsed.skills) ? parsed.skills : [],
      summary: parsed?.summary ?? null,
      experienceCount: Array.isArray(parsed?.experience) ? parsed.experience.length : 0,
      educationCount: Array.isArray(parsed?.education) ? parsed.education.length : 0,
      certificationsCount: Array.isArray(parsed?.certifications) ? parsed.certifications.length : 0,
      parsedJsonBeforeFinalize: parsed,
    });

    return finalizeParsedResume(parsed as Partial<ParsedResume>, rawText);
  } catch (err: any) {
    // #region debug-point E:text-parse-error
    reportResumeParsingDebug("E", "raw text parse failed", {
      rawTextLength: rawText.length,
      rawText,
      error: serializeDebugError(err),
    });
    // #endregion
    logResumeParsingConsole("raw text parse failed", {
      rawTextLength: rawText.length,
      rawText,
      error: serializeDebugError(err),
    });
    return { skills: [], experience: [], education: [], certifications: [], raw_text: rawText, parse_error: err?.message ?? serializeDebugError(err) };
  }
}

/**
 * Parse structured fields from raw resume text using AI.
 * If markdown is provided and substantial, uses the markdown parser (better quality, fewer tokens).
 */
export async function parseResumeFields(rawText: string, markdown?: string): Promise<ParsedResume> {
  // If markdown is provided and available, use the markdown parser (better quality, fewer tokens)
  if (markdown && markdown.trim().length > 100) {
    // #region debug-point A:parse-fields-markdown-branch
    reportResumeParsingDebug("A", "parseResumeFields selected markdown branch", {
      rawTextLength: rawText.length,
      markdownLength: markdown.length,
    });
    // #endregion
    logResumeParsingConsole("parseResumeFields selected markdown branch", {
      rawTextLength: rawText.length,
      markdownLength: markdown.length,
    });
    return parseResumeFromMarkdown(markdown, rawText);
  }
  // Otherwise fall back to the existing raw text parser
  // #region debug-point A:parse-fields-raw-text-branch
  reportResumeParsingDebug("A", "parseResumeFields selected raw text branch", {
    rawTextLength: rawText.length,
  });
  // #endregion
  logResumeParsingConsole("parseResumeFields selected raw text branch", {
    rawTextLength: rawText.length,
  });
  try {
    const { result } = await callWithUsageTracking("resume_parsing", undefined, async (provider) => {
      return parseResumeTextWithProvider(rawText, provider);
    });
    return result;
  } catch (err: any) {
    return { skills: [], experience: [], education: [], certifications: [], raw_text: rawText, parse_error: err?.message ?? String(err) };
  }
}

/**
 * Turn a parsed resume into starter evidence rows for the evidence bank.
 * Confidence is lower for AI-inferred vs human-entered.
 */
export function parsedResumeToEvidence(parsed: ParsedResume): Array<{
  source_type: string;
  title: string;
  description: string;
  related_skills: string[];
  confidence_score: number;
}> {
  const rows: ReturnType<typeof parsedResumeToEvidence> = [];

  if (parsed.summary) {
    rows.push({
      source_type: "uploaded_resume",
      title: "Professional Summary",
      description: parsed.summary,
      related_skills: parsed.skills.slice(0, 10),
      confidence_score: 0.65,
    });
  }

  for (const edu of parsed.education) {
    rows.push({
      source_type: "uploaded_resume",
      title: `Education: ${edu.degree}${edu.field ? `, ${edu.field}` : ""}`,
      description: `${edu.school}${edu.graduationDate ? ` — Graduated ${edu.graduationDate}` : ""}`,
      related_skills: [],
      confidence_score: 0.8,
    });
  }

  for (const exp of parsed.experience) {
    const description = exp.bullets?.join("\n") ?? "";
    rows.push({
      source_type: "uploaded_resume",
      title: `${exp.title} at ${exp.company}`,
      description: `${exp.startDate ?? "?"} – ${exp.endDate ?? "Present"}${description ? `\n${description}` : ""}`,
      related_skills: parsed.skills.filter((s) =>
        description.toLowerCase().includes(s.toLowerCase())
      ),
      confidence_score: 0.75,
    });
  }

  for (const cert of parsed.certifications) {
    rows.push({
      source_type: "uploaded_resume",
      title: `Certification: ${cert}`,
      description: "Extracted from resume",
      related_skills: [],
      confidence_score: 0.7,
    });
  }

  return rows;
}
