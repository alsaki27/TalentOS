import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy-key-for-build",
});

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

/**
 * Cross-check the AI's missing-keyword list against the actual candidate skills
 * extracted from the resume. Filters out any keyword that fuzzy-matches a skill
 * already present in the candidate's data, preventing false "missing" reports
 * caused by AI hallucination or inconsistent text vs. structured-data sourcing.
 */
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

export async function extractStructuredData(resumeText: string, jobText?: string): Promise<AtsExtractionResult> {
  const systemPrompt = `You are an expert ATS extraction parser. Your goal is to extract structured facts from the given resume and job description. Do NOT hallucinate. Do NOT calculate scores. Only extract what is explicitly written.`;
  
  const userPrompt = `
RESUME:
${resumeText.substring(0, 5000)}

${jobText ? `JOB DESCRIPTION:\n${jobText.substring(0, 3000)}` : ""}
`;

  const schema = {
    name: "extract_ats_data",
    schema: {
      type: "object",
      properties: {
        candidate: {
          type: "object",
          properties: {
            skills: { type: "array", items: { type: "string" } },
            yearsOfExperience: { type: "number" },
            education: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  degree: { type: "string" },
                  field: { type: "string" }
                },
                required: ["degree", "field"],
                additionalProperties: false
              }
            }
          },
          required: ["skills", "yearsOfExperience", "education"],
          additionalProperties: false
        },
        job: {
          type: ["object", "null"],
          properties: {
            hardSkills: { type: "array", items: { type: "string" } },
            niceToHaveSkills: { type: "array", items: { type: "string" } },
            minYearsOfExperience: { type: "number" },
            educationRequirement: { type: "string" }
          },
          required: ["hardSkills", "niceToHaveSkills", "minYearsOfExperience", "educationRequirement"],
          additionalProperties: false
        }
      },
      required: ["candidate", "job"],
      additionalProperties: false
    }
  };

  const response = await openai.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schema.name,
        schema: schema.schema as any,
        strict: true
      }
    }
  });

  const parsed = JSON.parse(response.choices[0].message.content || "{}");
  if (!jobText) {
    parsed.job = null;
  }
  return parsed as AtsExtractionResult;
}

export async function generateNarrative(
  extraction: AtsExtractionResult,
  breakdown: AtsScoreBreakdown
): Promise<AtsNarrative> {
  const systemPrompt = `You are an expert ATS feedback generator. Based ONLY on the provided JSON data (extracted facts and computed score breakdown), generate 3 short, actionable arrays of strings: strengths, missing keywords, and improvement suggestions. Do not make up facts not present in the JSON. Keep it professional and concise.`;

  const userPrompt = `
EXTRACTION FACT DATA:
${JSON.stringify(extraction, null, 2)}

COMPUTED BREAKDOWN:
${JSON.stringify(breakdown, null, 2)}
`;

  const schema = {
    name: "generate_narrative",
    schema: {
      type: "object",
      properties: {
        strengths: { type: "array", items: { type: "string" }, description: "3-4 short sentences highlighting strengths" },
        missingKeywords: { type: "array", items: { type: "string" }, description: "List of missing required or nice-to-have skills" },
        improvementSuggestions: { type: "array", items: { type: "string" }, description: "2-3 actionable suggestions for the resume" }
      },
      required: ["strengths", "missingKeywords", "improvementSuggestions"],
      additionalProperties: false
    }
  };

  const response = await openai.chat.completions.create({
    model: "gpt-4o-2024-08-06",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schema.name,
        schema: schema.schema as any,
        strict: true
      }
    }
  });

  return JSON.parse(response.choices[0].message.content || "{}") as AtsNarrative;
}
