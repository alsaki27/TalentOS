// src/server/services/applicationKeywordService.ts
// Generates application-level JD keywords from available job data.
// Uses the existing AI provider abstraction if no parsed data is available.
// Never writes directly to tables — delegates to repository.

import { supabase } from "@/lib/supabase";
import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { MISSION_CONTEXT } from "@/lib/ai/missionContext";
import {
  upsertApplicationKeywords,
  normalizeKeyword,
  deduplicateKeywords,
  ApplicationKeywordCategory,
  ApplicationKeywordImportance,
  UpsertApplicationKeywordInput,
} from "@/server/repositories/applicationKeywordsRepository";
import { findApplicationById } from "@/server/repositories/applicationsRepository";
import { findJobById } from "@/server/repositories/jobsRepository";

export interface JdAnalysisResult {
  requiredSkills: string[];
  preferredSkills: string[];
  tools: string[];
  responsibilities: string[];
  domainKeywords: string[];
  softSkills: string[];
  atsKeywords: string[];
  criticalAtsPhrases: string[];
  visaSignals: string[];
  redFlags: string[];
  title: string | null;
  company: string | null;
  location: string | null;
}

export interface GenerateKeywordsResult {
  keywords: UpsertApplicationKeywordInput[];
  aiAnalysisUsed: boolean;
  error?: string;
}

// ───────────────────────────────────────────────────────────────
// Public entry point
// ───────────────────────────────────────────────────────────────

export async function generateApplicationKeywords(
  applicationId: string,
  createdByUserId?: string | null
): Promise<GenerateKeywordsResult> {
  // 1. Load application
  const app = await findApplicationById(applicationId);
  if (!app) {
    return { keywords: [], aiAnalysisUsed: false, error: "Application not found" };
  }

  // 2. Determine JD source: linked job > ad-hoc data > raw text
  let rawDescription: string | null = null;
  let parsedDescription: Record<string, unknown> | null = null;
  let jobId: string | null = null;

  if (app.job_id) {
    const job = await findJobById(app.job_id);
    if (job) {
      jobId = job.id;
      rawDescription = job.raw_description ?? null;
      parsedDescription = job.parsed_description ?? null;
    }
  }

  // Fall back to ad-hoc application data
  if (!rawDescription && !parsedDescription) {
    rawDescription = app.adhoc_job_raw_text ?? null;
    parsedDescription = (app.adhoc_job_data as Record<string, unknown>) ?? null;
  }

  if (!rawDescription && !parsedDescription) {
    return { keywords: [], aiAnalysisUsed: false, error: "No job description or raw text available" };
  }

  // 3. Extract keywords from parsed data or AI analysis
  let keywords: Array<{ keyword: string; category: ApplicationKeywordCategory; importance: ApplicationKeywordImportance; aiReason?: string }> = [];
  let aiAnalysisUsed = false;

  if (parsedDescription) {
    keywords = extractKeywordsFromParsed(parsedDescription);
  }

  // If no parsed keywords, or parsed data is sparse, use AI
  if (keywords.length === 0 && rawDescription) {
    const aiResult = await analyzeJDWithAI(rawDescription);
    if (aiResult.error) {
      return { keywords: [], aiAnalysisUsed: false, error: aiResult.error };
    }
    keywords = extractKeywordsFromParsed(aiResult);
    aiAnalysisUsed = true;
  }

  if (keywords.length === 0) {
    return { keywords: [], aiAnalysisUsed, error: "No keywords could be extracted" };
  }

  // 4. Deduplicate and build repository inputs
  const deduped = deduplicateKeywords(keywords.map((k) => ({ keyword: k.keyword })));
  const keywordMap = new Map(keywords.map((k) => [normalizeKeyword(k.keyword), k]));

  const inputs: UpsertApplicationKeywordInput[] = deduped.map((d) => {
    const source = keywordMap.get(d.normalized_keyword);
    const isRedFlag = source?.category === "red_flag";
    return {
      application_id: applicationId,
      job_id: jobId,
      keyword: d.keyword,
      normalized_keyword: d.normalized_keyword,
      category: source?.category ?? "other",
      importance: source?.importance ?? "medium",
      source: "ai_jd_analysis" as const,
      status: isRedFlag ? "needs_evidence" : "pending",
      ai_reason: source?.aiReason ?? null,
      created_by: createdByUserId ?? null,
    };
  });

  // 5. Upsert
  await upsertApplicationKeywords(inputs);

  return { keywords: inputs, aiAnalysisUsed };
}

// ───────────────────────────────────────────────────────────────
// Extract from parsed JSON (job.parsed_description or adhoc_job_data)
// ───────────────────────────────────────────────────────────────

function extractKeywordsFromParsed(
  parsed: Record<string, unknown> | JdAnalysisResult
): Array<{ keyword: string; category: ApplicationKeywordCategory; importance: ApplicationKeywordImportance; aiReason?: string }> {
  const result: Array<{ keyword: string; category: ApplicationKeywordCategory; importance: ApplicationKeywordImportance; aiReason?: string }> = [];

  const add = (items: unknown[], category: ApplicationKeywordCategory, importance: ApplicationKeywordImportance, reason?: string) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item === "string" && item.trim()) {
        result.push({ keyword: item.trim(), category, importance, aiReason: reason });
      }
    }
  };

  add(parsed.requiredSkills as unknown[], "skill", "high", "Required skill from JD");
  add(parsed.preferredSkills as unknown[], "skill", "medium", "Preferred skill from JD");
  add(parsed.tools as unknown[], "tool", "high", "Tool mentioned in JD");
  add(parsed.responsibilities as unknown[], "responsibility", "medium", "Responsibility from JD");
  add(parsed.domainKeywords as unknown[], "domain", "medium", "Domain keyword from JD");
  add(parsed.softSkills as unknown[], "soft_skill", "low", "Soft skill from JD");
  add(parsed.atsKeywords as unknown[], "other", "medium", "ATS keyword from JD");
  add(parsed.visaSignals as unknown[], "visa", "high", "Visa/work authorization signal from JD");
  add(parsed.redFlags as unknown[], "red_flag", "critical", "Red flag detected in JD");

  // jdAnalyzer.ts's criticalAtsPhrases identifies which of the keywords above are
  // actually most likely to gate an ATS screen for this specific job - bump those
  // to "critical" importance so they surface first wherever keywords are sorted/
  // filtered by importance, instead of being just another "high" item in a list of
  // 30+. Without this, the new field exists in the AI's output but never changes
  // any actual behavior downstream.
  const criticalPhrases = new Set(
    ((parsed as any).criticalAtsPhrases as unknown[] | undefined ?? [])
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.trim().toLowerCase())
  );
  if (criticalPhrases.size > 0) {
    for (const kw of result) {
      if (criticalPhrases.has(kw.keyword.toLowerCase()) && kw.importance !== "critical") {
        kw.importance = "critical";
        kw.aiReason = `${kw.aiReason ?? ""} — flagged as a likely ATS gatekeeper for this role`.trim();
      }
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────
// AI JD analysis (fallback when no parsed data)
// ───────────────────────────────────────────────────────────────

async function analyzeJDWithAI(
  rawText: string
): Promise<JdAnalysisResult & { error?: string }> {
  const active = await getProviderForCategory("parsing_extraction");
  if (!active) {
    return {
      requiredSkills: [], preferredSkills: [], tools: [], responsibilities: [],
      domainKeywords: [], softSkills: [], atsKeywords: [], criticalAtsPhrases: [], visaSignals: [], redFlags: [],
      title: null, company: null, location: null,
      error: "No AI provider configured. Set ANTHROPIC_API_KEY, NVIDIA_API_KEY, or GOOGLE_API_KEY.",
    };
  }

  const prompt = [
    MISSION_CONTEXT,
    "",
    "Analyze this job description and extract structured keywords for resume tailoring. Return ONLY a JSON object with no markdown fences, no extra text.",
    "Extract ONLY what is explicitly stated in the text below - do not invent skills, tools, or requirements that aren't there. If a field has nothing to extract, return an empty array (or null for title/company/location) rather than guessing.",
    "Use the JD's own exact wording, not paraphrases - ATS keyword matching is largely literal string matching, so \"AWS\" extracted as \"cloud computing\" defeats the point.",
    "The JSON must have these exact keys:",
    "requiredSkills: array of strings",
    "preferredSkills: array of strings",
    "tools: array of strings",
    "responsibilities: array of strings",
    "domainKeywords: array of strings",
    "softSkills: array of strings",
    "atsKeywords: array of strings",
    "criticalAtsPhrases: array of strings - of everything above, the 5-10 exact phrases most likely to gate an ATS screen for this specific role (the core hard requirement plus the most JD-specific required skills), ordered highest-impact first",
    "visaSignals: array of strings",
    "redFlags: array of strings (e.g., 'unrealistic requirements', 'vague description', 'suspicious salary')",
    "title: string or null",
    "company: string or null",
    "location: string or null",
    "",
    "Job description:",
    rawText.slice(0, 8000),
  ].join("\n");

  try {
    const response = await active.provider.send({
      system: "You are a precise job-description keyword extractor whose accuracy directly determines whether a tailored resume passes ATS screening. Respond with raw JSON only.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const raw = textOf(response.content).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(raw);

    return {
      requiredSkills: coerceArray(parsed.requiredSkills),
      preferredSkills: coerceArray(parsed.preferredSkills),
      tools: coerceArray(parsed.tools),
      responsibilities: coerceArray(parsed.responsibilities),
      domainKeywords: coerceArray(parsed.domainKeywords),
      softSkills: coerceArray(parsed.softSkills),
      atsKeywords: coerceArray(parsed.atsKeywords),
      criticalAtsPhrases: coerceArray(parsed.criticalAtsPhrases),
      visaSignals: coerceArray(parsed.visaSignals),
      redFlags: coerceArray(parsed.redFlags),
      title: typeof parsed.title === "string" ? parsed.title : null,
      company: typeof parsed.company === "string" ? parsed.company : null,
      location: typeof parsed.location === "string" ? parsed.location : null,
    };
  } catch (err: any) {
    return {
      requiredSkills: [], preferredSkills: [], tools: [], responsibilities: [],
      domainKeywords: [], softSkills: [], atsKeywords: [], criticalAtsPhrases: [], visaSignals: [], redFlags: [],
      title: null, company: null, location: null,
      error: err.message ?? "AI JD analysis failed",
    };
  }
}

function coerceArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map((v) => v.trim());
}
