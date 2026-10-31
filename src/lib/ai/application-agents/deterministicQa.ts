// Phase 2 of the AI Resume Pipeline Waste Removal & Quality Hardening plan
// (D:\Shohan\Skarion\Planning MD Files\AI Resume Pipeline\
// AI_Resume_Pipeline_Waste_Removal_And_Quality_Plan_20260928.md).
//
// One deterministic, no-AI-calls entry point that answers every item in the
// 14-check list the plan is built around. It does NOT reimplement checks
// that already exist elsewhere - it composes them - and only adds the 4
// checks that genuinely didn't exist before: a bullet-count MAXIMUM (only a
// minimum was ever enforced), cross-group duplicate-skill detection (the
// existing dedup only ran within one group, only when the page overflowed),
// skills-pool membership (didn't exist at all - v1 flags, does not enforce,
// since prompts/resumeForge.ts's rule (d) explicitly permits JD-inferred
// skills), and a cheap pre-render character/word screen (advisory only -
// measured page fit, passed in as `pageFit`, is always the real authority).
//
// Severity follows the project's existing convention everywhere else in this
// pipeline: fail soft, never hard-kill the workflow. Hard failures still only
// ever set exportReady=false + add to unresolvedWarnings - the resume is
// always saved, a human reviews it. Hard gates here: identity drift, missing
// education when the base has education, missing summary when the base has
// one, page overflow, and the font-readability floor. Everything else warns.

import type { ResumeDraftV1, RequirementAnalysisEntry, PageFitV1, RequirementCoverageRow } from "./schemas";
import {
  enforceExperienceIntegrity,
  enforceEducationIntegrity,
  readBaseSummary,
  flagDuplicateRoleIdentity,
  validateEmploymentChronology,
  normalizeResumeText,
} from "./resumeIntegrity";
import { buildRequirementCoverage, listMissedSupported } from "./requirementCoverage";
import { validateEvidenceCitations } from "./evidenceAudit";

export interface QaFinding {
  check: string;
  detail: string;
}

// role index -> { min, max }. The single source of truth this plan calls
// for: three prompts previously stated three different maxima (Resume
// Forge 7/6/6, Final Polish 6-7/4-6/3-4, Hiring Panel a flat 3-7). These
// numbers match Final Polish's own prompt AND the minimum already enforced
// in code (resumeForge.ts's getMinBullets: idx 0 -> 6, idx 1 -> 4, idx >=2
// -> 3) - the only one of the three that code already partially agreed with.
export const BULLET_COUNT_RULES: { min: number; max: number }[] = [
  { min: 6, max: 7 },
  { min: 4, max: 6 },
];
export const BULLET_COUNT_RULES_OLDER = { min: 3, max: 4 };

export function bulletCountRuleForIndex(index: number): { min: number; max: number } {
  return BULLET_COUNT_RULES[index] ?? BULLET_COUNT_RULES_OLDER;
}

export interface BulletCountFact {
  role: string;
  index: number;
  count: number;
  min: number;
  max: number;
  withinRange: boolean;
}

function checkBulletCounts(experience: ResumeDraftV1["experience"]): { facts: BulletCountFact[]; warnings: QaFinding[] } {
  const facts: BulletCountFact[] = [];
  const warnings: QaFinding[] = [];
  experience.forEach((entry, index) => {
    const { min, max } = bulletCountRuleForIndex(index);
    const count = Array.isArray(entry.bullets) ? entry.bullets.length : 0;
    const withinRange = count >= min && count <= max;
    facts.push({ role: entry.title, index, count, min, max, withinRange });
    if (!withinRange) {
      warnings.push({
        check: "bullet_count",
        detail: `"${entry.title}" has ${count} bullets, outside the ${min}-${max} range for role position ${index}.`,
      });
    }
  });
  return { facts, warnings };
}

function normalizeSkillText(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function checkDuplicateSkills(skills: ResumeDraftV1["skills"]): { facts: string[]; warnings: QaFinding[] } {
  const seen = new Map<string, string>(); // normalized -> first original spelling
  const duplicates: string[] = [];
  for (const group of skills ?? []) {
    for (const skill of group.skills ?? []) {
      if (typeof skill !== "string" || !skill.trim()) continue;
      const normalized = normalizeSkillText(skill);
      if (!normalized) continue;
      if (seen.has(normalized)) {
        duplicates.push(skill);
      } else {
        seen.set(normalized, skill);
      }
    }
  }
  const warnings = duplicates.map((skill) => ({
    check: "duplicate_skill",
    detail: `"${skill}" appears more than once across the skills section (possibly in a different category).`,
  }));
  return { facts: duplicates, warnings };
}

/**
 * The allowed-skills pool: base resume skills, skills appearing in base
 * experience bullets, Source-of-Truth confirmed skills, recruiter-verified
 * skills, and evidence-bank related skills. v1 flags only - never removes a
 * skill - because prompts/resumeForge.ts's rule (d) explicitly permits
 * skills "inferred with >=90% confidence from the job description +
 * candidate background," which a strict filter would silently override.
 */
function buildSkillPool(input: {
  baseSkills: unknown;
  baseExperience: unknown[];
  sourceOfTruth: { confirmedSkills: string[] } | null | undefined;
  verifiedSkills: string[] | undefined;
  evidence: { relatedSkills?: string[] }[] | undefined;
}): Set<string> {
  const pool = new Set<string>();
  const addAll = (values: unknown) => {
    if (!Array.isArray(values)) return;
    for (const v of values) {
      if (typeof v === "string" && v.trim()) pool.add(normalizeSkillText(v));
    }
  };
  addAll(input.baseSkills);
  addAll(input.sourceOfTruth?.confirmedSkills);
  addAll(input.verifiedSkills);
  for (const e of input.evidence ?? []) addAll(e.relatedSkills);
  // Free-text skills mentioned inside base bullets (e.g. a tool named in a
  // bullet but never listed in the skills section) still count as evidenced.
  const bulletsText = normalizeSkillText(
    (input.baseExperience ?? [])
      .map((entry: any) => (Array.isArray(entry?.bullets) ? entry.bullets.join(" ") : ""))
      .join(" ")
  );
  if (bulletsText) pool.add(`__bullets__${bulletsText}`);
  return pool;
}

function isSkillInPool(skill: string, pool: Set<string>): boolean {
  const normalized = normalizeSkillText(skill);
  if (!normalized) return true;
  if (pool.has(normalized)) return true;
  const bulletsBucket = Array.from(pool).find((p) => p.startsWith("__bullets__"));
  if (bulletsBucket && normalized.length >= 3 && bulletsBucket.includes(normalized)) return true;
  return false;
}

function checkSkillsInPool(
  skills: ResumeDraftV1["skills"],
  pool: Set<string>
): { facts: string[]; warnings: QaFinding[] } {
  const outside: string[] = [];
  for (const group of skills ?? []) {
    for (const skill of group.skills ?? []) {
      if (typeof skill !== "string" || !skill.trim()) continue;
      if (!isSkillInPool(skill, pool)) outside.push(skill);
    }
  }
  const warnings = outside.map((skill) => ({
    check: "skill_outside_pool",
    detail: `"${skill}" doesn't match the base resume, Source of Truth, verified skills, or evidence bank - verify it's genuinely supported before this ships (flagged, not removed).`,
  }));
  return { facts: outside, warnings };
}

// Advisory only - a cheap screen to run before an expensive PDF render, never
// a substitute for it. ~600 words is a generous approximation of what
// comfortably fills one page at typical resume formatting; this exists to
// catch an obviously-oversized draft early, not to make export decisions.
const WORD_BUDGET_WARNING_THRESHOLD = 900;

function countWords(draft: Pick<ResumeDraftV1, "summary" | "experience" | "skills">): number {
  const parts: string[] = [];
  if (draft.summary) parts.push(draft.summary);
  for (const entry of draft.experience ?? []) parts.push(...(entry.bullets ?? []));
  for (const group of draft.skills ?? []) parts.push(...(group.skills ?? []));
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
}

export interface DeterministicQaInput {
  draft: Pick<ResumeDraftV1, "summary" | "skills" | "experience" | "education" | "certifications">;
  baseResumeContent: unknown;
  jobAnalysis: { requirementAnalysis?: RequirementAnalysisEntry[] } | null | undefined;
  evidence?: { id: string; relatedSkills?: string[] }[];
  sourceOfTruth?: { confirmedSkills: string[] } | null;
  verifiedSkills?: string[];
  pageFit: PageFitV1 | null;
  job?: unknown;
}

export interface DeterministicQaResult {
  ok: boolean;
  hardFailures: QaFinding[];
  warnings: QaFinding[];
  facts: {
    pageFit: PageFitV1 | null;
    bulletCounts: BulletCountFact[];
    duplicateSkills: string[];
    skillsOutsidePool: string[];
    identityDrift: string[];
    coverage: RequirementCoverageRow[];
    wordCount: number;
  };
}

/**
 * Run every deterministic check this plan calls for against one resume
 * (Resume Forge's draft, or Final Polish's output - anything shaped like
 * ResumeDraftV1's relevant fields). No AI calls. Pure function.
 */
export function runDeterministicQa(rawInput: DeterministicQaInput): DeterministicQaResult {
  const hardFailures: QaFinding[] = [];
  const warnings: QaFinding[] = [];

  // `input.draft` is caller-supplied data typed as `unknown` upstream
  // (ArtifactRecord.data) - a fully-validated ResumeDraftV1 always has these
  // as arrays in production, but this module's own "fail soft, never
  // hard-kill" contract (see file header) means it must not itself throw on
  // a partially-shaped draft (an incomplete test fixture, or a defensively
  // minimal call site). Normalize once, up front, rather than scattering
  // Array.isArray guards through every check below.
  const rawDraft = rawInput.draft as Record<string, unknown> | null | undefined;
  const input: DeterministicQaInput = {
    ...rawInput,
    draft: {
      summary: typeof rawDraft?.summary === "string" ? rawDraft.summary : null,
      skills: Array.isArray(rawDraft?.skills) ? (rawDraft.skills as ResumeDraftV1["skills"]) : [],
      experience: Array.isArray(rawDraft?.experience) ? (rawDraft.experience as ResumeDraftV1["experience"]) : [],
      education: Array.isArray(rawDraft?.education) ? (rawDraft.education as ResumeDraftV1["education"]) : [],
      certifications: Array.isArray(rawDraft?.certifications) ? (rawDraft.certifications as ResumeDraftV1["certifications"]) : [],
    },
  };

  const baseContent = (input.baseResumeContent && typeof input.baseResumeContent === "object" && !Array.isArray(input.baseResumeContent))
    ? (input.baseResumeContent as Record<string, unknown>)
    : {};
  const baseExperience: unknown[] = Array.isArray(baseContent.experience) ? (baseContent.experience as unknown[]) : [];
  const baseEducation: unknown[] = Array.isArray(baseContent.education) ? (baseContent.education as unknown[]) : [];
  const baseSkills: unknown = baseContent.skills;

  // ── 1-6, 11: identity (companies/titles/locations/dates/roles/education) ──
  // Re-run the same enforcement functions the pipeline already uses and
  // compare their output against what was actually given. Any difference
  // means this resume was NOT already conformant to the base resume -
  // exactly what "identity drift" means here. This is a verification pass,
  // not a mutation: it never modifies input.draft.
  const identityDrift: string[] = [];
  const correctedExperience = enforceExperienceIntegrity(input.draft.experience, baseExperience);
  input.draft.experience.forEach((entry, i) => {
    const corrected = correctedExperience[i];
    if (!corrected) return;
    if (normalizeResumeText(entry.title) !== normalizeResumeText(corrected.title)) {
      identityDrift.push(`experience[${i}].title: "${entry.title}" vs base "${corrected.title}"`);
    }
    if (normalizeResumeText(entry.company) !== normalizeResumeText(corrected.company)) {
      identityDrift.push(`experience[${i}].company: "${entry.company}" vs base "${corrected.company}"`);
    }
    if (normalizeResumeText(entry.location ?? "") !== normalizeResumeText(corrected.location ?? "")) {
      identityDrift.push(`experience[${i}].location: "${entry.location}" vs base "${corrected.location}"`);
    }
    if (normalizeResumeText(entry.startDate ?? "") !== normalizeResumeText(corrected.startDate ?? "")) {
      identityDrift.push(`experience[${i}].startDate: "${entry.startDate}" vs base "${corrected.startDate}"`);
    }
  });
  if (correctedExperience.length !== input.draft.experience.length) {
    identityDrift.push(`experience count: resume has ${input.draft.experience.length}, base-derived has ${correctedExperience.length}`);
  }

  const correctedEducation = enforceEducationIntegrity(input.draft.education, baseEducation);
  if (baseEducation.length > 0 && input.draft.education.length === 0) {
    hardFailures.push({ check: "education_missing", detail: "Base resume has education, but this resume has none." });
  }
  input.draft.education.forEach((entry, i) => {
    const corrected = correctedEducation[i];
    if (!corrected) return;
    if (normalizeResumeText(entry.school) !== normalizeResumeText(corrected.school)) {
      identityDrift.push(`education[${i}].school: "${entry.school}" vs base "${corrected.school}"`);
    }
    if (normalizeResumeText(entry.degree) !== normalizeResumeText(corrected.degree)) {
      identityDrift.push(`education[${i}].degree: "${entry.degree}" vs base "${corrected.degree}"`);
    }
  });

  if (identityDrift.length > 0) {
    hardFailures.push({
      check: "identity_drift",
      detail: `${identityDrift.length} identity field(s) differ from the base resume (see facts.identityDrift).`,
    });
  }

  // Duplicate-role warning (existing helper, warn-only by its own design).
  for (const warning of flagDuplicateRoleIdentity(input.draft.experience)) {
    warnings.push({ check: "duplicate_role", detail: warning });
  }

  // Chronology (existing helper, warn-only by its own design).
  for (const warning of validateEmploymentChronology(input.draft.experience, input.draft.education, input.job ?? null)) {
    warnings.push({ check: "chronology", detail: warning });
  }

  // ── 10: summary exists ──
  const baseHasSummary = Boolean(readBaseSummary(baseContent));
  const draftHasSummary = Boolean(input.draft.summary && input.draft.summary.trim());
  if (baseHasSummary && !draftHasSummary) {
    hardFailures.push({ check: "summary_missing", detail: "Base resume has a professional summary, but this resume has none." });
  } else if (!baseHasSummary && draftHasSummary) {
    warnings.push({ check: "summary_invented", detail: "Base resume has no summary, but this resume has one - verify it wasn't invented." });
  }

  // ── 7: bullet count (NEW - min already enforced elsewhere, this adds max) ──
  const bulletCounts = checkBulletCounts(input.draft.experience);
  warnings.push(...bulletCounts.warnings);

  // ── 8: no duplicate skills (NEW - cross-group, always-on) ──
  const duplicateSkills = checkDuplicateSkills(input.draft.skills);
  warnings.push(...duplicateSkills.warnings);

  // ── 9: skills belong to the allowed evidence pool (NEW - flags only) ──
  const pool = buildSkillPool({
    baseSkills,
    baseExperience,
    sourceOfTruth: input.sourceOfTruth,
    verifiedSkills: input.verifiedSkills,
    evidence: input.evidence,
  });
  const skillsOutsidePool = checkSkillsInPool(input.draft.skills, pool);
  warnings.push(...skillsOutsidePool.warnings);

  // ── 13: max character/word budget (NEW - advisory pre-render screen only) ──
  const wordCount = countWords(input.draft);
  if (wordCount > WORD_BUDGET_WARNING_THRESHOLD) {
    warnings.push({
      check: "word_budget",
      detail: `Draft is ~${wordCount} words, well above what typically fits one page - measured page fit (below) is still authoritative, this is an early heads-up only.`,
    });
  }

  // ── 14: rendered page overflow (already correct elsewhere - consume, don't recompute) ──
  if (input.pageFit) {
    if (!input.pageFit.readable) {
      hardFailures.push({ check: "readability_floor", detail: "Rendered font size is below the readability floor." });
    }
    if (input.pageFit.overflow) {
      hardFailures.push({ check: "page_overflow", detail: `Rendered resume spans ${input.pageFit.pageCount} pages.` });
    }
  }

  // Requirement coverage + evidence citations (existing engines, exposed as facts).
  const coverage = buildRequirementCoverage(input.jobAnalysis, input.draft);
  const missed = listMissedSupported(coverage);
  if (missed.length > 0) {
    warnings.push({
      check: "requirement_coverage",
      detail: `${missed.length} supported requirement(s) not surfaced in the resume: ${missed.map((r) => r.requirement).join(", ")}.`,
    });
  }
  // validateEvidenceCitations mutates its input in place (it strips dangling
  // ids as it audits) - this module must stay read-only, so it gets a deep
  // clone, never the caller's actual draft object.
  const evidenceAudit = validateEvidenceCitations(
    JSON.parse(JSON.stringify({ experience: input.draft.experience, changeLog: [] })),
    input.evidence ?? []
  );
  if (evidenceAudit.danglingCount > 0) {
    warnings.push({
      check: "evidence_citation",
      detail: `${evidenceAudit.danglingCount} cited evidence ID(s) don't match any real evidence-bank entry.`,
    });
  }

  return {
    ok: hardFailures.length === 0,
    hardFailures,
    warnings,
    facts: {
      pageFit: input.pageFit,
      bulletCounts: bulletCounts.facts,
      duplicateSkills: duplicateSkills.facts,
      skillsOutsidePool: skillsOutsidePool.facts,
      identityDrift,
      coverage,
      wordCount,
    },
  };
}

/**
 * Phase 2 consumption point (a): render a DeterministicQaResult as a compact
 * prompt block so Hiring Panel/Final Polish can be TOLD these facts instead
 * of re-deriving them from raw JSON - bullet counts, duplicate skills, and
 * identity drift are exactly what this module already computes precisely and
 * for free. Purely additive: does not replace or remove any existing prompt
 * instruction, so this carries no behavior-regression risk on its own.
 * Deliberately omits `coverage` (requirementCoverage rows) - already surfaced
 * to Resume Forge separately as its own retry signal - and `pageFit`, which
 * both prompts already render themselves as their own PAGE QA METRICS block.
 */
export function formatDeterministicQaFacts(qa: DeterministicQaResult): string {
  const lines: string[] = [];
  lines.push(`Overall: ${qa.ok ? "OK - no hard failures" : "HARD FAILURE(S) PRESENT"}`);
  if (qa.hardFailures.length > 0) {
    lines.push("Hard failures:");
    for (const f of qa.hardFailures) lines.push(`  - [${f.check}] ${f.detail}`);
  }
  lines.push(
    `Bullet counts: ${qa.facts.bulletCounts
      .map((b) => `"${b.role}"=${b.count}/${b.min}-${b.max}${b.withinRange ? "" : " OUT OF RANGE"}`)
      .join("; ") || "(no experience entries)"}`
  );
  lines.push(`Duplicate skills: ${qa.facts.duplicateSkills.length > 0 ? qa.facts.duplicateSkills.join(", ") : "none"}`);
  lines.push(`Skills outside the evidenced pool (flagged, not necessarily wrong): ${qa.facts.skillsOutsidePool.length > 0 ? qa.facts.skillsOutsidePool.join(", ") : "none"}`);
  lines.push(`Identity drift vs base resume: ${qa.facts.identityDrift.length > 0 ? qa.facts.identityDrift.join("; ") : "none"}`);
  return lines.join("\n");
}
