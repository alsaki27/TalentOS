// src/lib/resumeParsing.ts
// Extract text from PDF/DOCX, then parse structured fields via AI.
// Dependencies: pdfjs-dist (legacy build), mammoth

import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import type { AiMessage } from "@/lib/ai/provider";

// Minimal DOMMatrix polyfill for Cloudflare Workers. Confirmed via `wrangler tail`
// against the live Worker: pdfjs-dist's legacy build still throws
// "DOMMatrix is not defined" even when only calling getTextContent() (no canvas
// rendering at all) - some real-world PDFs (this was reproduced with an actual
// uploaded resume, not a minimal synthetic test PDF) trigger an internal pdf.js
// code path - gradient/pattern fills, certain font handling - that constructs a
// DOMMatrix regardless of whether anything is ever rendered to a canvas. Neither
// plain Node.js (confirmed: `typeof DOMMatrix` is `undefined` there too) nor
// workerd provide this global; the difference is real Node.js apparently never
// exercises that particular code path for simple text-only PDFs, while a real
// resume's content stream does. Implementing the real 2D affine matrix math
// (not no-op stubs) since getTextContent()'s reported text positions can depend on
// correct transform composition, not just on construction not throwing.
if (typeof globalThis.DOMMatrix === "undefined") {
  class DOMMatrixPolyfill {
    a: number; b: number; c: number; d: number; e: number; f: number;
    constructor(init?: number[] | DOMMatrixPolyfill) {
      const m = Array.isArray(init) ? init : init ? [init.a, init.b, init.c, init.d, init.e, init.f] : [1, 0, 0, 1, 0, 0];
      [this.a, this.b, this.c, this.d, this.e, this.f] = m.length >= 6 ? m : [1, 0, 0, 1, 0, 0];
    }
    multiplySelf(other: DOMMatrixPolyfill) {
      const { a, b, c, d, e, f } = this;
      this.a = a * other.a + c * other.b;
      this.b = b * other.a + d * other.b;
      this.c = a * other.c + c * other.d;
      this.d = b * other.c + d * other.d;
      this.e = a * other.e + c * other.f + e;
      this.f = b * other.e + d * other.f + f;
      return this;
    }
    preMultiplySelf(other: DOMMatrixPolyfill) {
      const result = new DOMMatrixPolyfill([other.a, other.b, other.c, other.d, other.e, other.f]);
      result.multiplySelf(this);
      ({ a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f } = result);
      return this;
    }
    multiply(other: DOMMatrixPolyfill) {
      return new DOMMatrixPolyfill([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(other);
    }
    invertSelf() {
      const { a, b, c, d, e, f } = this;
      const det = a * d - b * c;
      if (det === 0) { this.a = this.b = this.c = this.d = this.e = this.f = NaN; return this; }
      this.a = d / det;
      this.b = -b / det;
      this.c = -c / det;
      this.d = a / det;
      this.e = (c * f - d * e) / det;
      this.f = (b * e - a * f) / det;
      return this;
    }
    translate(tx: number, ty: number) {
      return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]));
    }
    scale(sx: number, sy: number = sx) {
      return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]));
    }
    addPath() {
      // Path geometry is canvas-rendering-only and never reached by getTextContent.
      throw new Error("DOMMatrix polyfill: addPath is not implemented (rendering-only, not used for text extraction)");
    }
  }
  (globalThis as any).DOMMatrix = DOMMatrixPolyfill;
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
    start_date?: string;
    end_date?: string;
    description?: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    field?: string;
    graduation_year?: string;
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
    // pdf-parse depends on @napi-rs/canvas, a native/compiled addon - Cloudflare
    // Workers' workerd runtime cannot load native binaries at all, so that path
    // works fine in local Node.js (confirmed: extracted 5189 chars from a real
    // uploaded resume locally) but silently fails on the deployed Worker every
    // time. @napi-rs/canvas is only needed for rendering pages to images -
    // pdfjs-dist (the actual parsing engine pdf-parse wraps) lists it as an
    // *optional* dependency and explicitly stubs out canvas/fs in its own
    // package.json "browser" field, confirming text extraction alone doesn't
    // need it. Using pdfjs-dist's "legacy" build directly (the variant meant for
    // non-browser environments without DOM - the default build needs a real
    // DOMMatrix global, confirmed it throws ReferenceError without one) avoids
    // the native dependency entirely. No GlobalWorkerOptions.workerSrc is set here,
    // so pdfjs-dist automatically falls back to its in-process "fake worker" mode -
    // confirmed working locally without any worker-related option at all. An
    // earlier attempt passed a `disableWorker` option, but that property doesn't
    // actually exist on DocumentInitParameters (TypeScript caught it) and had no
    // effect either way, since the fake-worker fallback is already the default
    // when no real worker is configured - Workers doesn't support spinning up a
    // separate worker thread the way Node/browsers do.
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjsLib.getDocument({
      data: buffer,
      isEvalSupported: false,
    }).promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pageTexts.push(content.items.map((item: any) => item.str ?? "").join(" "));
    }
    return pageTexts.join("\n\n");
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

const PARSE_PROMPT = `You are a resume parser. Extract structured information from the resume text below and return ONLY a JSON object matching this exact schema (no markdown, no commentary, just raw JSON):

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
      "start_date": string | null,
      "end_date": string | null,
      "description": string | null
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string,
      "field": string | null,
      "graduation_year": string | null
    }
  ],
  "certifications": string[]
}

Rules:
- If a field is missing or unclear, use null (for strings) or empty array (for arrays).
- Dates: prefer ISO format (YYYY-MM) or just year (YYYY). Use null if unparseable.
- Skills: include both hard skills and soft skills, but be specific (e.g., "React" not "frontend").
- Experience: include every job entry you can find, even internships.
- Education: include every degree.
- Do NOT hallucinate information not present in the text.
- Return ONLY the JSON object, no markdown code fences, no explanation.`;

const MARKDOWN_PARSE_PROMPT = `You are a resume parser. The input is a resume converted to clean Markdown. Extract structured information and return ONLY a JSON object matching this exact schema (no markdown, no commentary, just raw JSON):

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
      "start_date": string | null,
      "end_date": string | null,
      "description": string | null
    }
  ],
  "education": [
    {
      "school": string,
      "degree": string,
      "field": string | null,
      "graduation_year": string | null
    }
  ],
  "certifications": string[]
}

Rules:
- Markdown headers (##) usually indicate sections. Experience entries often have dates in them.
- Bullet points (- or *) are individual job responsibilities or achievements.
- Skills may be in a dedicated section or scattered. Collect them all.
- Dates: prefer ISO format (YYYY-MM) or just year (YYYY). Use null if unparseable.
- Do NOT hallucinate information not present in the markdown.
- Return ONLY the JSON object, no markdown code fences, no explanation.`;

// New: Parse from markdown (better quality, fewer tokens)
export async function parseResumeFromMarkdown(markdown: string): Promise<ParsedResume> {
  const active = await getActiveProviderAsync();
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
  const active = await getActiveProviderAsync();
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
      description: `${edu.school}${edu.graduation_year ? ` — Graduated ${edu.graduation_year}` : ""}`,
      related_skills: [],
      confidence_score: 0.8,
    });
  }

  for (const exp of parsed.experience) {
    rows.push({
      source_type: "uploaded_resume",
      title: `${exp.title} at ${exp.company}`,
      description: `${exp.start_date ?? "?"} – ${exp.end_date ?? "Present"}${exp.description ? `\n${exp.description}` : ""}`,
      related_skills: parsed.skills.filter((s) =>
        exp.description?.toLowerCase().includes(s.toLowerCase())
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
