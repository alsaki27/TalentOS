// src/lib/ai/jobAgentClassifier.ts
// AI classification module for the Job Agent.
// Same single-shot JSON generation pattern as jobCategorization.ts.
// Provides a regex-based fallback when AI is unavailable or for budget runs.

import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

export interface ClassificationResult {
  seniority: "entry" | "mid" | "senior" | "executive" | "unknown";
  tier: "best" | "medium" | "worthy" | "skip";
  tier_reason: string;
  is_false_positive: boolean;
  false_positive_reason: string | null;
  relevance_score: number;
  keywords: string[];
}

interface ClassifyInput {
  title: string;
  company_name?: string | null;
  search_query: string;
  role_group: string;
  role_group_label: string;
}

const VALID_SENIORITY = new Set(["entry", "mid", "senior", "executive", "unknown"]);
const VALID_TIER = new Set(["best", "medium", "worthy", "skip"]);

const SENIOR_SIGNALS = /\b(senior|sr\.?|lead|principal|staff|director|expert|iii|iv|v|head of|chief)\b/i;
const ENTRY_SIGNALS = /\b(entry.level|entry level|junior|jr\.?|associate|intern|trainee|graduate|new grad|level i\b|\bi\b$)/i;
const MGR_EXCEPTION = /manager/i;

const FALSE_POSITIVE_COMPANIES = new Set([
  "splice", // music-tech company frequently matched by "Splice Engineer" query
]);

function buildPrompt(input: ClassifyInput): string {
  return [
    "You are a strict job-posting classifier for a recruiting agent. The agent searches Google Jobs with specific role titles and must decide whether each result is actually relevant.",
    "",
    "CRITICAL RULES:",
    `- Role group "A" (OSP / Fiber): ALL seniority levels are wanted. Never assign "skip" just because the title sounds senior.`,
    `- Role groups "B" through "L": entry-level candidates are preferred. Assign "skip" to titles containing clear senior signals (senior, sr, lead, principal, staff, director, expert, III, IV, V, head of, chief). Managers are also skipped UNLESS the title is explicitly a hybrid like "project manager-drafter".`,
    `- Relevance / false positives: If the company name or job title clearly does not match the intended domain, set is_false_positive = true. Example: a "Splice Engineer" query returning a role at Splice (the music-tech company) is a false positive.`,
    "- Industry: do NOT reject based on industry. Candidates relocate and industries vary.",
    "",
    "TIER DEFINITIONS:",
    "- best: direct title match + correct seniority + real domain fit + high confidence.",
    "- medium: reasonably relevant but slightly broader title or lower confidence.",
    "- worthy: tangential or hard-to-verify fit — keep for manual review.",
    "- skip: wrong seniority, false positive, or clearly unrelated role.",
    "",
    "Respond with ONLY this JSON object, no markdown fences, no other text:",
    '{"seniority":"entry"|"mid"|"senior"|"executive"|"unknown","tier":"best"|"medium"|"worthy"|"skip","tier_reason":"short reason","is_false_positive":boolean,"false_positive_reason":string|null,"relevance_score":number 0.00-1.00,"keywords":["max 4 precise skills"]}',
    "",
    "Job title:",
    input.title,
    input.company_name ? `Company name: ${input.company_name}` : null,
    `Search query that produced this result: ${input.search_query}`,
    `Role group: ${input.role_group} (${input.role_group_label})`,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseAiJson(raw: string): ClassificationResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(stripped);

  const seniority = VALID_SENIORITY.has(parsed.seniority) ? parsed.seniority : "unknown";
  const tier = VALID_TIER.has(parsed.tier) ? parsed.tier : "worthy";

  return {
    seniority,
    tier,
    tier_reason: typeof parsed.tier_reason === "string" ? parsed.tier_reason.trim() : "",
    is_false_positive: parsed.is_false_positive === true,
    false_positive_reason:
      typeof parsed.false_positive_reason === "string" ? parsed.false_positive_reason.trim() : null,
    relevance_score:
      typeof parsed.relevance_score === "number"
        ? Math.max(0, Math.min(1, parsed.relevance_score))
        : 0.5,
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k: any) => String(k).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

/**
 * AI classifier. Uses the existing provider routing + usage tracking.
 */
export async function classifyWithAi(input: ClassifyInput): Promise<ClassificationResult> {
  const { result } = await callWithUsageTracking(
    "job_categorization",
    undefined,
    async (provider) => {
      const response = await provider.send({
        system: "You are a strict, literal job-posting classifier. Respond with raw JSON only.",
        messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(input) }] }],
        tools: [],
      });
      return parseAiJson(textOf(response.content));
    }
  );
  return result;
}

/**
 * Regex-based fallback classifier. Matches the handover's process_categorize_dedupe.js
 * logic but returns the same ClassificationResult shape.
 */
export function classifyWithRegex(input: ClassifyInput): ClassificationResult {
  const title = input.title;
  const company = (input.company_name ?? "").toLowerCase();
  const isOspFiber = input.role_group === "A";

  // False-positive company check
  for (const fp of FALSE_POSITIVE_COMPANIES) {
    if (company.includes(fp)) {
      return {
        seniority: "unknown",
        tier: "skip",
        tier_reason: `False-positive company match: ${fp}`,
        is_false_positive: true,
        false_positive_reason: `Company "${input.company_name}" matches known false-positive keyword "${fp}"`,
        relevance_score: 0.05,
        keywords: [],
      };
    }
  }

  // OSP / Fiber group: accept all seniority levels
  if (isOspFiber) {
    return {
      seniority: "unknown",
      tier: "best",
      tier_reason: "OSP/Fiber group: all seniority levels wanted",
      is_false_positive: false,
      false_positive_reason: null,
      relevance_score: 0.85,
      keywords: deriveKeywords(title),
    };
  }

  // Groups B–L: prefer entry, skip senior titles
  const isSenior =
    SENIOR_SIGNALS.test(title) ||
    (MGR_EXCEPTION.test(title) && !/project manager-drafter/i.test(title));
  const isEntry = ENTRY_SIGNALS.test(title);

  if (isSenior) {
    return {
      seniority: "senior",
      tier: "skip",
      tier_reason: "Senior/director/principal/manager title — skipped for entry-level groups",
      is_false_positive: false,
      false_positive_reason: null,
      relevance_score: 0.2,
      keywords: [],
    };
  }

  if (isEntry) {
    return {
      seniority: "entry",
      tier: "best",
      tier_reason: "Entry-level signal in title",
      is_false_positive: false,
      false_positive_reason: null,
      relevance_score: 0.9,
      keywords: deriveKeywords(title),
    };
  }

  return {
    seniority: "unknown",
    tier: "worthy",
    tier_reason: "No clear seniority signal — keep for review",
    is_false_positive: false,
    false_positive_reason: null,
    relevance_score: 0.6,
    keywords: deriveKeywords(title),
  };
}

function deriveKeywords(title: string): string[] {
  const t = title.toLowerCase();
  const keywords: string[] = [];
  if (t.includes("autocad") || t.includes("cad")) keywords.push("AutoCAD");
  if (t.includes("draft") || t.includes("drafter")) keywords.push("Drafting");
  if (t.includes("osp") || t.includes("outside plant")) keywords.push("OSP");
  if (t.includes("fiber") || t.includes("fibre")) keywords.push("Fiber");
  if (t.includes("gis") || t.includes("geospatial")) keywords.push("GIS");
  if (t.includes("splice")) keywords.push("Splicing");
  if (t.includes("bim")) keywords.push("BIM");
  if (t.includes("design")) keywords.push("Design");
  return [...new Set(keywords)];
}

/**
 * Classify a job. Uses AI by default; falls back to regex if AI fails or if
 * opts.fallback is true.
 */
export async function classifyJob(
  input: ClassifyInput,
  opts: { useAi?: boolean; delayMs?: number } = {}
): Promise<ClassificationResult> {
  const useAi = opts.useAi ?? true;

  if (useAi) {
    try {
      const result = await classifyWithAi(input);
      if (opts.delayMs && opts.delayMs > 0) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return result;
    } catch (err) {
      console.warn("[jobAgentClassifier] AI classification failed, falling back to regex:", (err as Error).message);
    }
  }

  return classifyWithRegex(input);
}