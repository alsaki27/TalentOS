// Deterministic (non-AI) skill-gap detection for the Falood Copilot's
// automatic "you're missing these skills" flow. Deliberately NOT left to AI
// judgment: the set-difference of "which skills are in the JD/base
// resume/Source of Truth but absent from the tailored draft" is exact,
// checkable data, not something worth risking a hallucinated or missed
// match on. The AI is still used (via extractSkillsFromJobDescription) to
// turn JD prose into a skill list - that's genuine language understanding -
// but the comparison itself is plain string matching.

export interface SkillGapCandidate {
  skill: string;
  inJobDescription: boolean;
  inBaseResume: boolean;
  inSourceOfTruth: boolean;
}

function normalizeSkill(skill: string): string {
  return skill.trim().toLowerCase().replace(/\s+/g, " ");
}

function dedupePreserveCase(skills: string[]): string[] {
  const seen = new Map<string, string>();
  for (const s of skills) {
    const trimmed = s.trim();
    if (!trimmed) continue;
    const key = normalizeSkill(trimmed);
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return Array.from(seen.values());
}

/**
 * Skills present in the JD, the candidate's base resumes, or their
 * Source-of-Truth confirmed skills, but missing from the tailored resume's
 * current skill list. Ordered most-corroborated first (JD + base + SoT
 * together outrank a skill only one source mentions), then by first
 * appearance in the JD skill list (the JD's own priority order, since
 * extractSkillsFromJobDescription already returns it most-critical-first).
 */
export function detectSkillGaps(opts: {
  resumeSkills: string[];
  jdSkills: string[];
  baseResumeSkills: string[];
  sourceOfTruthSkills: string[];
}): SkillGapCandidate[] {
  const resumeSet = new Set(opts.resumeSkills.map(normalizeSkill));
  const jdSet = new Set(opts.jdSkills.map(normalizeSkill));
  const baseSet = new Set(opts.baseResumeSkills.map(normalizeSkill));
  const sotSet = new Set(opts.sourceOfTruthSkills.map(normalizeSkill));

  const allCandidates = dedupePreserveCase([
    ...opts.jdSkills,
    ...opts.baseResumeSkills,
    ...opts.sourceOfTruthSkills,
  ]);

  const jdOrder = new Map(opts.jdSkills.map((s, i) => [normalizeSkill(s), i]));

  const gaps: SkillGapCandidate[] = allCandidates
    .filter((skill) => !resumeSet.has(normalizeSkill(skill)))
    .map((skill) => {
      const key = normalizeSkill(skill);
      return {
        skill,
        inJobDescription: jdSet.has(key),
        inBaseResume: baseSet.has(key),
        inSourceOfTruth: sotSet.has(key),
      };
    });

  const corroborationCount = (c: SkillGapCandidate) =>
    Number(c.inJobDescription) + Number(c.inBaseResume) + Number(c.inSourceOfTruth);

  return gaps.sort((a, b) => {
    const corrobDiff = corroborationCount(b) - corroborationCount(a);
    if (corrobDiff !== 0) return corrobDiff;
    const aOrder = jdOrder.get(normalizeSkill(a.skill)) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = jdOrder.get(normalizeSkill(b.skill)) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

/** Fraction of JD skills already present in the resume's skill list (0 if the JD has no extracted skills). */
export function jdCoverageScore(resumeSkills: string[], jdSkills: string[]): number {
  if (jdSkills.length === 0) return 0;
  const resumeSet = new Set(resumeSkills.map(normalizeSkill));
  const covered = jdSkills.filter((s) => resumeSet.has(normalizeSkill(s))).length;
  return covered / jdSkills.length;
}

/**
 * Chunk 3's score-must-not-decrease guard (Option A: lightweight local
 * scoring, confirmed in the plan). Only a skill that would raise JD keyword
 * coverage is worth suggesting - a base-resume/SoT skill the JD never asked
 * for can't lower the score, but it can't be *verified* to raise it either,
 * so it's excluded here rather than suggested on faith. If the JD yielded no
 * extracted skills at all, there is nothing to score against - suggest
 * nothing this run rather than guess.
 */
export function filterSkillGapsForScoreIncrease(
  gaps: SkillGapCandidate[],
  resumeSkills: string[],
  jdSkills: string[]
): SkillGapCandidate[] {
  if (jdSkills.length === 0) return [];
  const baseline = jdCoverageScore(resumeSkills, jdSkills);
  return gaps.filter((gap) => {
    if (!gap.inJobDescription) return false;
    const withSkill = jdCoverageScore([...resumeSkills, gap.skill], jdSkills);
    return withSkill > baseline;
  });
}

/** Flattens a Resumify ResumeData skills block (simple or categorized) into a plain string list. */
export function flattenResumeSkills(skills: { mode: "simple" | "categorized"; simple: string[]; categorized: { skills: string[] }[] } | null | undefined): string[] {
  if (!skills) return [];
  if (skills.mode === "simple") return skills.simple ?? [];
  return (skills.categorized ?? []).flatMap((c) => c.skills ?? []);
}
