// src/server/services/readinessService.ts
// Professional, unbiased readiness engine.
// Uses weighted signals, confidence scoring, and full data integration (resumes, evidence, profile).

export interface ReadinessInput {
  jdText: string;
  candidate: {
    verified_skills?: string[];
    target_roles?: string[];
    experience_years?: number;
  };
  evidenceSkills: string[];
  resumeSkills: string[];
  resumeTextCorpus: string; // The full text/extracted text from the resume to check against JD
}

export interface ReadinessOutput {
  score: number;
  confidence: "high" | "medium" | "low";
  threshold: number;
  breakdown: {
    skillMatchScore: number;
    resumeMatchScore: number;
    roleAlignmentScore: number;
  };
  matched: string[];
  missing: string[];
  flagged: string[];
  no_skills_data: boolean;
}

export const DEFAULT_THRESHOLD = 70;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.#+]/g, '')
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;|()/\n]+/)
    .map(normalize)
    .filter(Boolean);
}

// Check if a multi-word phrase exists in a text
function phraseExists(text: string, phrase: string): boolean {
  // Normalize both by replacing non-alphanumeric with spaces, then check inclusion
  const normText = text.toLowerCase().replace(/[^a-z0-9.#+]/g, ' ');
  const normPhrase = phrase.toLowerCase().replace(/[^a-z0-9.#+]/g, ' ').trim();
  return normText.includes(` ${normPhrase} `) || normText.startsWith(`${normPhrase} `) || normText.endsWith(` ${normPhrase}`) || normText === normPhrase;
}

/**
 * Professional deterministic readiness score.
 * Unbiased: Does not default to 50% if no skills are found. Returns 0 with a flag.
 */
export function computeReadinessScore(
  input: ReadinessInput,
  threshold: number = DEFAULT_THRESHOLD
): ReadinessOutput {
  const jdTextLower = input.jdText.toLowerCase();
  const jdTokens = new Set(tokenize(input.jdText));

  // 1. Gather all candidate skills from all sources
  const verified = (input.candidate.verified_skills || []).filter(Boolean);
  const evidence = input.evidenceSkills.filter(Boolean);
  const resume = input.resumeSkills.filter(Boolean);
  
  const allCandidateSkills = Array.from(new Set([...verified, ...evidence, ...resume]));
  
  if (allCandidateSkills.length === 0) {
    return {
      score: 0,
      confidence: "low",
      threshold,
      breakdown: { skillMatchScore: 0, resumeMatchScore: 0, roleAlignmentScore: 0 },
      matched: [],
      missing: [],
      flagged: [],
      no_skills_data: true
    };
  }

  // 2. Determine "Required" skills based on intersection of Candidate Skills and JD Text.
  // Since we don't have an external vocabulary, we assume any skill the candidate has that is mentioned in the JD is a "matched" requirement.
  // To find "missing" skills, we would normally need an LLM to extract requirements from JD.
  // For a deterministic engine without bias, we score based on how strongly the candidate's skills map to the JD.
  
  const matchedSkills: string[] = [];
  const flaggedSkills: string[] = []; // Claimed but not found in JD
  
  for (const skill of allCandidateSkills) {
    if (phraseExists(input.jdText, skill) || tokenize(skill).every(token => jdTokens.has(token))) {
      matchedSkills.push(skill);
    } else {
      flaggedSkills.push(skill);
    }
  }

  // Calculate Skill Match Score (Weight: 60%)
  // If they matched a lot of skills, high score. We normalize by capping at say 10 skills for a perfect score.
  const targetSkillCount = Math.max(5, allCandidateSkills.length * 0.5); // Expecting to match at least half their skills or 5 skills.
  let skillMatchScore = Math.min(100, Math.round((matchedSkills.length / targetSkillCount) * 100));
  
  // Calculate Resume Text Density Score (Weight: 20%)
  // How much of the JD vocabulary is found in the candidate's resume text?
  let resumeMatchScore = 0;
  if (input.resumeTextCorpus) {
    const resumeTokens = new Set(tokenize(input.resumeTextCorpus));
    let overlap = 0;
    for (const token of jdTokens) {
      if (token.length > 3 && resumeTokens.has(token)) overlap++;
    }
    // Assume 20 meaningful overlapping terms is a perfect density score
    resumeMatchScore = Math.min(100, Math.round((overlap / 20) * 100));
  }

  // Calculate Role Alignment Score (Weight: 20%)
  let roleAlignmentScore = 0;
  const targetRoles = input.candidate.target_roles || [];
  let roleMatched = false;
  for (const role of targetRoles) {
    if (phraseExists(input.jdText, role)) {
      roleMatched = true;
      break;
    }
  }
  if (roleMatched) {
    roleAlignmentScore = 100;
  } else {
    roleAlignmentScore = 50; // Neutral if no explicit target role matched
  }

  // Weighted Final Score
  // 60% Skills, 20% Resume Text Density, 20% Role Alignment
  let finalScore = Math.round((skillMatchScore * 0.6) + (resumeMatchScore * 0.2) + (roleAlignmentScore * 0.2));

  // Confidence Rating
  let confidence: "high" | "medium" | "low" = "low";
  if (allCandidateSkills.length >= 10 && input.resumeTextCorpus.length > 500) {
    confidence = "high";
  } else if (allCandidateSkills.length >= 3) {
    confidence = "medium";
  }

  // For the UI, "missing" traditionally meant required by JD but missing from candidate.
  // Without an LLM to extract JD requirements, we can't reliably populate "missing".
  // We'll leave it empty to remain strictly accurate (unbiased) rather than guessing.
  const missingSkills: string[] = [];

  return {
    score: finalScore,
    confidence,
    threshold,
    breakdown: {
      skillMatchScore,
      resumeMatchScore,
      roleAlignmentScore
    },
    matched: matchedSkills,
    missing: missingSkills,
    flagged: flaggedSkills,
    no_skills_data: false
  };
}

export function extractAllResumeText(parsedJson: Record<string, unknown> | null): string {
  if (!parsedJson) return "";
  let text = "";
  try {
    text = JSON.stringify(parsedJson);
  } catch(e) {}
  return text;
}