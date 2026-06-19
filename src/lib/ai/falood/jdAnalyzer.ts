// src/lib/ai/falood/jdAnalyzer.ts
// Parse-only job description analyzer. Extracts structured data from raw JD text
// via the configured AI provider. Does not write to the database — the caller handles persistence.

import { getActiveProvider } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

export interface JdAnalysisInput {
  rawText: string;
  candidateId?: string; // optional — reserved for future fit-scoring against a candidate profile
}

export interface JdRedFlag {
  flag: string;
  severity: "low" | "medium" | "high";
  reason: string;
}

export interface JdAnalysisOutput {
  title: string | null;
  company: string | null;
  location: string | null;
  workplaceType: "remote" | "hybrid" | "onsite" | "unknown";
  employmentType: "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown";
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  responsibilities: string[];
  seniorityLevel: string | null;
  yearsExperience: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "hourly" | "yearly" | "monthly" | "unknown";
  domainKeywords: string[];
  softSkills: string[];
  atsKeywords: string[];
  visaSignals: string[];
  redFlags: JdRedFlag[];
  fitSummary: string;
  confidenceScore: number; // 0-1
}

const JD_ANALYSIS_PROMPT = `You are a job description analyzer. Extract structured information from the job description text below and return ONLY a raw JSON object matching this exact schema. Do not wrap the JSON in markdown code fences. Do not include any commentary or explanation before or after the JSON.

Schema:
{
  "title": string | null,
  "company": string | null,
  "location": string | null,
  "workplaceType": "remote" | "hybrid" | "onsite" | "unknown",
  "employmentType": "full_time" | "part_time" | "contract" | "internship" | "temporary" | "unknown",
  "requiredSkills": string[],
  "preferredSkills": string[],
  "tools": string[],
  "responsibilities": string[],
  "seniorityLevel": string | null,
  "yearsExperience": string | null,
  "salaryMin": number | null,
  "salaryMax": number | null,
  "salaryCurrency": string | null,
  "salaryPeriod": "hourly" | "yearly" | "monthly" | "unknown",
  "domainKeywords": string[],
  "softSkills": string[],
  "atsKeywords": string[],
  "visaSignals": string[],
  "redFlags": { "flag": string, "severity": "low" | "medium" | "high", "reason": string }[],
  "fitSummary": string,
  "confidenceScore": number
}

Rules:
- Extract ONLY information that is explicitly present in the text. Do not invent company names, salaries, skills, or requirements.
- If a field is not present or is unclear, use null for strings/numbers or empty arrays for lists.
- "workplaceType": infer from phrases like "remote", "hybrid", "on-site", "in-office". Default to "unknown" if not stated.
- "employmentType": infer from "full-time", "part-time", "contract", "internship", "temporary". Default to "unknown".
- "seniorityLevel": infer from title and requirements (e.g., "entry", "mid", "senior", "lead", "principal"). Default to null if not inferable.
- "yearsExperience": extract as a string like "3-5" or "5+" if mentioned. Default to null.
- "salaryMin" / "salaryMax": extract numeric values only. If a range is given (e.g., "$120k-$150k"), set both. If a single number, set salaryMin = salaryMax = that number. Remove currency symbols and "k" multipliers (e.g., 120000 not 120k).
- "salaryCurrency": "USD", "EUR", "GBP", etc. — only if explicitly stated. Default to null.
- "salaryPeriod": "hourly", "yearly", "monthly". Default to "unknown".
- "requiredSkills": hard skills, tools, programming languages, certifications explicitly required.
- "preferredSkills": nice-to-have skills, not mandatory.
- "tools": specific software, platforms, frameworks mentioned.
- "responsibilities": bullet-style job duties.
- "domainKeywords": industry-specific terms (e.g., "telecom", "OSP", "fiber optics", "GIS", "SaaS").
- "softSkills": communication, leadership, teamwork, etc.
- "atsKeywords": terms that are likely ATS-scored (e.g., "Bachelor's degree", "5+ years", "Python").
- "visaSignals": any mention of sponsorship, work authorization, H-1B, OPT, citizenship, etc.
- "redFlags": anything that might be a concern — unrealistic requirements, low pay signals, vague descriptions, high applicant-to-hire ratios, etc. Each needs a severity and reason.
- "fitSummary": a brief 1-2 sentence assessment of what this role demands.
- "confidenceScore": 0.0 to 1.0 — how confident you are in the extraction overall. Lower if many fields are missing or ambiguous.
- Return ONLY the JSON object. No markdown. No prose.`;

function createEmptyJdAnalysis(): JdAnalysisOutput {
  return {
    title: null,
    company: null,
    location: null,
    workplaceType: "unknown",
    employmentType: "unknown",
    requiredSkills: [],
    preferredSkills: [],
    tools: [],
    responsibilities: [],
    seniorityLevel: null,
    yearsExperience: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: "unknown",
    domainKeywords: [],
    softSkills: [],
    atsKeywords: [],
    visaSignals: [],
    redFlags: [],
    fitSummary: "",
    confidenceScore: 0,
  };
}

function sanitizeString(v: unknown): string | null {
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function sanitizeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function sanitizeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = parseFloat(v.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function sanitizeEnum<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  if (typeof v === "string" && allowed.includes(v as T)) return v as T;
  return fallback;
}

function sanitizeRedFlags(v: unknown): JdRedFlag[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item) => item && typeof item === "object")
    .map((item: any) => ({
      flag: typeof item.flag === "string" ? item.flag.trim() : "Unknown flag",
      severity: sanitizeEnum(item.severity, ["low", "medium", "high"], "low"),
      reason: typeof item.reason === "string" ? item.reason.trim() : "",
    }))
    .filter((item) => item.flag.length > 0);
}

function validateAndSanitize(parsed: any): JdAnalysisOutput {
  return {
    title: sanitizeString(parsed.title),
    company: sanitizeString(parsed.company),
    location: sanitizeString(parsed.location),
    workplaceType: sanitizeEnum(parsed.workplaceType, ["remote", "hybrid", "onsite", "unknown"], "unknown"),
    employmentType: sanitizeEnum(parsed.employmentType, ["full_time", "part_time", "contract", "internship", "temporary", "unknown"], "unknown"),
    requiredSkills: sanitizeStringArray(parsed.requiredSkills),
    preferredSkills: sanitizeStringArray(parsed.preferredSkills),
    tools: sanitizeStringArray(parsed.tools),
    responsibilities: sanitizeStringArray(parsed.responsibilities),
    seniorityLevel: sanitizeString(parsed.seniorityLevel),
    yearsExperience: sanitizeString(parsed.yearsExperience),
    salaryMin: sanitizeNumber(parsed.salaryMin),
    salaryMax: sanitizeNumber(parsed.salaryMax),
    salaryCurrency: sanitizeString(parsed.salaryCurrency),
    salaryPeriod: sanitizeEnum(parsed.salaryPeriod, ["hourly", "yearly", "monthly", "unknown"], "unknown"),
    domainKeywords: sanitizeStringArray(parsed.domainKeywords),
    softSkills: sanitizeStringArray(parsed.softSkills),
    atsKeywords: sanitizeStringArray(parsed.atsKeywords),
    visaSignals: sanitizeStringArray(parsed.visaSignals),
    redFlags: sanitizeRedFlags(parsed.redFlags),
    fitSummary: sanitizeString(parsed.fitSummary) ?? "",
    confidenceScore: (() => {
      const n = sanitizeNumber(parsed.confidenceScore);
      if (n === null) return 0;
      return Math.max(0, Math.min(1, n));
    })(),
  };
}

export async function analyzeJD(input: JdAnalysisInput): Promise<JdAnalysisOutput> {
  const active = getActiveProvider();
  if (!active) {
    throw new Error("No AI provider configured");
  }

  const response = await active.provider.send({
    system: "You are a job description analyzer. Extract structured data and return ONLY raw JSON.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: `${JD_ANALYSIS_PROMPT}\n\n--- JOB DESCRIPTION ---\n${input.rawText}\n--- END JOB DESCRIPTION ---` }],
      },
    ],
    tools: [],
  });

  const text = textOf(response.content) ?? "";

  // Strip markdown code fences if the model added them despite instructions
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!clean) {
    throw new Error("AI returned empty response");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch (parseErr: any) {
    throw new Error(`AI returned malformed JSON: ${parseErr.message}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned non-object JSON");
  }

  return validateAndSanitize(parsed);
}
