import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

const AUTOMATION_EXTRACTION = "ats_extraction";
const AUTOMATION_NARRATIVE = "ats_narrative";

export type ResumeType = "base" | "tailored";

export interface AtsExtractionResult {
  candidate: {
    skills: string[];
    yearsOfExperience: number;
    education: { degree: string; field: string }[];
  };
  job: {
    hardSkills: string[];
    niceToHaveSkills: string[];
    minYearsOfExperience: number;
    educationRequirement: string;
  } | null;
}

export interface AtsScoreBreakdown {
  overallScore: number;
  hardSkillsScore: number;
  niceToHaveScore: number;
  experienceScore: number;
  educationScore: number;
  parseabilityScore: number;
}

export interface AtsNarrative {
  strengths: string[];
  missingKeywords: string[];
  improvementSuggestions: string[];
}

function normalizeSkill(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

export function fuzzyMatch(skill: string, against: string[]): boolean {
  const a = normalizeSkill(skill);
  if (!a || a.length < 3) return false;
  for (const b of against) {
    const normB = normalizeSkill(b);
    if (!normB || normB.length < 3) continue;
    if (a === normB) return true;
    if (a.includes(normB) || normB.includes(a)) return true;
    if (levenshteinRatio(a, normB) >= 0.85) return true;
  }
  return false;
}

function levenshteinRatio(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return 1;
  if (m === 0 || n === 0) return 0;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

export function filterMissingKeywords(
  narrative: AtsNarrative,
  candidateSkills: string[]
): AtsNarrative {
  if (!narrative.missingKeywords || narrative.missingKeywords.length === 0) {
    return narrative;
  }
  const genuinelyMissing = narrative.missingKeywords.filter(
    (kw) => !fuzzyMatch(kw, candidateSkills)
  );
  return { ...narrative, missingKeywords: genuinelyMissing };
}

export function computeDeterministicScore(
  extraction: AtsExtractionResult,
  parseabilityScore: number
): AtsScoreBreakdown {
  const { candidate, job } = extraction;

  if (!job) {
    const hasEnoughSkills = candidate.skills.length >= 5 ? 100 : candidate.skills.length * 20;
    const hasExp = candidate.yearsOfExperience > 0 ? 100 : 0;
    const hasEdu = candidate.education.length > 0 ? 100 : 0;

    const overall = Math.round(
      hasEnoughSkills * 0.4 +
      hasExp * 0.2 +
      hasEdu * 0.2 +
      parseabilityScore * 0.2
    );

    return {
      overallScore: overall,
      hardSkillsScore: hasEnoughSkills,
      niceToHaveScore: 0,
      experienceScore: hasExp,
      educationScore: hasEdu,
      parseabilityScore,
    };
  }

  const cSkills = new Set(candidate.skills.map((s) => s.toLowerCase()));
  let hardMatched = 0;
  for (const reqSkill of job.hardSkills) {
    if (cSkills.has(reqSkill.toLowerCase())) {
      hardMatched++;
    } else if (Array.from(cSkills).some((cs) => cs.includes(reqSkill.toLowerCase()) || reqSkill.toLowerCase().includes(cs))) {
      hardMatched++;
    }
  }
  const hardSkillsScore = job.hardSkills.length > 0
    ? Math.round((hardMatched / job.hardSkills.length) * 100)
    : 100;

  let niceMatched = 0;
  for (const nSkill of job.niceToHaveSkills) {
    if (cSkills.has(nSkill.toLowerCase())) {
      niceMatched++;
    } else if (Array.from(cSkills).some((cs) => cs.includes(nSkill.toLowerCase()) || nSkill.toLowerCase().includes(cs))) {
      niceMatched++;
    }
  }
  const niceToHaveScore = job.niceToHaveSkills.length > 0
    ? Math.round((niceMatched / job.niceToHaveSkills.length) * 100)
    : 100;

  let experienceScore = 100;
  if (job.minYearsOfExperience > 0) {
    if (candidate.yearsOfExperience >= job.minYearsOfExperience) {
      experienceScore = 100;
    } else {
      experienceScore = Math.round((candidate.yearsOfExperience / job.minYearsOfExperience) * 100);
    }
  }

  let educationScore = 100;
  if (job.educationRequirement && job.educationRequirement !== "None") {
    const hasEdu = candidate.education.some((e) =>
      e.degree.toLowerCase().includes(job.educationRequirement.toLowerCase()) ||
      job.educationRequirement.toLowerCase().includes(e.degree.toLowerCase())
    );
    educationScore = hasEdu ? 100 : 0;
  }

  const overallScore = Math.round(
    hardSkillsScore * 0.4 +
    niceToHaveScore * 0.15 +
    experienceScore * 0.15 +
    educationScore * 0.10 +
    parseabilityScore * 0.20
  );

  return {
    overallScore,
    hardSkillsScore,
    niceToHaveScore,
    experienceScore,
    educationScore,
    parseabilityScore,
  };
}

function safeJsonParse(raw: string): any {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(stripped);
}

export async function extractStructuredData(resumeText: string, jobText?: string): Promise<AtsExtractionResult> {
  const systemPrompt =
    "You are an expert ATS extraction parser. Your goal is to extract structured facts from the given resume and job description. Do NOT hallucinate. Do NOT calculate scores. Only extract what is explicitly written.";

  const userPrompt = `
RESUME:
${resumeText.substring(0, 5000)}

${jobText ? `JOB DESCRIPTION:\n${jobText.substring(0, 3000)}` : ""}

Return ONLY valid JSON (no markdown, no explanation) matching this exact schema:
{
  "candidate": {
    "skills": ["string", ...],
    "yearsOfExperience": number,
    "education": [{"degree": "string", "field": "string"}, ...]
  },
  "job": ${jobText ? '{ "hardSkills": ["string", ...], "niceToHaveSkills": ["string", ...], "minYearsOfExperience": number, "educationRequirement": "string" }' : "null"}
}`;

  const { result, providerName, model } = await callWithUsageTracking(
    AUTOMATION_EXTRACTION,
    undefined,
    async (provider) => {
      const response = await provider.send({
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
        tools: [],
        temperature: 0,
      });
      return safeJsonParse(textOf(response.content));
    }
  );

  console.log(
    `[atsScoring] extractStructuredData via ${providerName}${model ? `/${model}` : ""}`
  );

  const parsed = result;
  if (!jobText) {
    parsed.job = null;
  }
  return parsed as AtsExtractionResult;
}

export async function generateNarrative(
  extraction: AtsExtractionResult,
  breakdown: AtsScoreBreakdown
): Promise<AtsNarrative> {
  const systemPrompt =
    "You are an expert ATS feedback generator. Based ONLY on the provided JSON data (extracted facts and computed score breakdown), generate 3 short, actionable arrays of strings: strengths, missing keywords, and improvement suggestions. Do not make up facts not present in the JSON. Keep it professional and concise.";

  const userPrompt = `
EXTRACTION FACT DATA:
${JSON.stringify(extraction, null, 2)}

COMPUTED BREAKDOWN:
${JSON.stringify(breakdown, null, 2)}

Return ONLY valid JSON (no markdown, no explanation) matching this exact schema:
{
  "strengths": ["3-4 short sentences highlighting strengths", ...],
  "missingKeywords": ["list of missing required or nice-to-have skills", ...],
  "improvementSuggestions": ["2-3 actionable suggestions for the resume", ...]
}`;

  const { result, providerName, model } = await callWithUsageTracking(
    AUTOMATION_NARRATIVE,
    undefined,
    async (provider) => {
      const response = await provider.send({
        system: systemPrompt,
        messages: [{ role: "user", content: [{ type: "text", text: userPrompt }] }],
        tools: [],
        temperature: 0,
      });
      return safeJsonParse(textOf(response.content));
    }
  );

  console.log(
    `[atsScoring] generateNarrative via ${providerName}${model ? `/${model}` : ""}`
  );

  return result as AtsNarrative;
}
