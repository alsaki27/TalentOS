// src/lib/resumeParsing.ts
// Extract text from PDF/DOCX, then parse structured fields via AI.
// Dependencies: pdf-parse, mammoth (install via npm i pdf-parse mammoth)

import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import type { AiMessage } from "@/lib/ai/provider";

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
    const { PDFParse } = await import("pdf-parse");
    const nodeBuffer = Buffer.from(buffer);
    const parser = new PDFParse({ data: nodeBuffer });
    const result = await parser.getText();
    return result.text ?? "";
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

/**
 * Parse structured fields from raw resume text using AI.
 */
export async function parseResumeFields(rawText: string): Promise<ParsedResume> {
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
