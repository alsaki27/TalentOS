// src/lib/resumeParsing.ts
// Extract text from PDF/DOCX, then parse structured fields via AI.
// Dependencies: mammoth (DOCX). PDF extraction is hand-rolled - see extractText.

import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import type { AiMessage } from "@/lib/ai/provider";

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
  const raw = Buffer.from(buffer);
  const latin1 = raw.toString("latin1");
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
        allText.push(...extractTextShowOperators(Buffer.from(inflated).toString("latin1")));
      } catch {
        // Not actually deflate-compressed text (e.g. an image stream that
        // happens to also be tagged /FlateDecode) - skip it.
      }
    } else if (!dict.includes("/Filter")) {
      allText.push(...extractTextShowOperators(rawBytes.toString("latin1")));
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
  certifications: string[];
  raw_text: string;
}

/**
 * Extract raw text from a resume buffer (PDF or DOCX).
 */
export async function extractText(buffer: Uint8Array, mimeType: string): Promise<string> {
  const type = mimeType.toLowerCase();

  if (type.includes("pdf")) {
    return extractTextFromPdfBuffer(buffer);
  }

  if (type.includes("docx") || type.includes("wordprocessingml")) {
    const mammoth = await import("mammoth");
    const nodeBuffer = Buffer.from(buffer);
    const result = await mammoth.extractRawText({ buffer: nodeBuffer });
    return result.value ?? "";
  }

  if (type.includes("doc") && !type.includes("docx")) {
    // Legacy .doc — no reliable pure-JS parser; return empty so caller can handle.
    return "";
  }

  // Fallback: try utf-8 text
  try {
    return new TextDecoder().decode(buffer);
  } catch {
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
  "skills": string[],
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
- For experience: create an entry for EVERY job. Extract ALL bullet points for each job — do not summarize, do not truncate.
- For education: include EVERY degree, diploma, or certification program.
- For certifications: include every certification mentioned anywhere in the resume.
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
  "skills": string[],
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
- Dates: prefer 'Month Year' or just 'Year'. Use null if unparseable.
- Current jobs: set endDate to null.
- Do NOT hallucinate information not present in the markdown.
- Return ONLY the JSON object, no markdown code fences, no explanation.`;

// New: Parse from markdown (better quality, fewer tokens)
export async function parseResumeFromMarkdown(markdown: string): Promise<ParsedResume> {
  const active = await getProviderForCategory("parsing_extraction");
  if (!active) {
    return { skills: [], experience: [], education: [], certifications: [], raw_text: markdown };
  }

  const messages: AiMessage[] = [
    { role: "user", content: [{ type: "text", text: `${MARKDOWN_PARSE_PROMPT}\n\n--- RESUME MARKDOWN ---\n${markdown}\n--- END RESUME MARKDOWN ---` }] },
  ];

  try {
    const response = await active.provider.send({
      system: "You are a resume parser. Extract structured data from markdown and return ONLY raw JSON.",
      messages,
      tools: [],
    });

    const text = textOf(response.content) ?? "";
    const clean = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(clean) as Partial<ParsedResume>;

    return {
      name: parsed.name || undefined,
      email: parsed.email || undefined,
      phone: parsed.phone || undefined,
      location: parsed.location || undefined,
      linkedin_url: parsed.linkedin_url || undefined,
      github_url: parsed.github_url || undefined,
      portfolio_url: parsed.portfolio_url || undefined,
      summary: parsed.summary || undefined,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      experience: Array.isArray(parsed.experience) ? parsed.experience : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
      certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
      raw_text: markdown,
    };
  } catch (err: any) {
    return { skills: [], experience: [], education: [], certifications: [], raw_text: markdown };
  }
}

/**
 * Parse structured fields from raw resume text using AI.
 * If markdown is provided and substantial, uses the markdown parser (better quality, fewer tokens).
 */
export async function parseResumeFields(rawText: string, markdown?: string): Promise<ParsedResume> {
  // If markdown is provided and available, use the markdown parser (better quality, fewer tokens)
  if (markdown && markdown.trim().length > 100) {
    return parseResumeFromMarkdown(markdown);
  }
  // Otherwise fall back to the existing raw text parser
  const active = await getProviderForCategory("parsing_extraction");
  if (!active) {
    // No AI available — return raw text with empty structure
    return { skills: [], experience: [], education: [], certifications: [], raw_text: rawText };
  }

  const messages: AiMessage[] = [
    { role: "user", content: [{ type: "text", text: `${PARSE_PROMPT}\n\n--- RESUME TEXT ---\n${rawText}\n--- END RESUME TEXT ---` }] },
  ];

  try {
    const response = await active.provider.send({
      system: "You are a resume parser. Extract structured data and return ONLY raw JSON.",
      messages,
      tools: [],
    });

    const text = textOf(response.content) ?? "";
    // Strip markdown code fences if the model added them despite instructions
    const clean = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(clean) as Partial<ParsedResume>;

    return {
      name: parsed.name || undefined,
      email: parsed.email || undefined,
      phone: parsed.phone || undefined,
      location: parsed.location || undefined,
      linkedin_url: parsed.linkedin_url || undefined,
      github_url: parsed.github_url || undefined,
      portfolio_url: parsed.portfolio_url || undefined,
      summary: parsed.summary || undefined,
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      experience: Array.isArray(parsed.experience) ? parsed.experience : [],
      education: Array.isArray(parsed.education) ? parsed.education : [],
      certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
      raw_text: rawText,
    };
  } catch (err: any) {
    // On any failure, return the raw text with empty structure so the UI can still show it
    return { skills: [], experience: [], education: [], certifications: [], raw_text: rawText };
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
