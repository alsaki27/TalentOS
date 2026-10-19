import type { JobAnalysisV1, RequirementAnalysisEntry } from "./schemas";

export const QUALIFICATION_FIT_RUBRIC_VERSION = "qualification-fit-v1";

export type QualificationFitStatus = "scored" | "needs_review" | "insufficient_evidence";
export type QualificationCriterionStatus =
  | "meets"
  | "not_evidenced"
  | "hard_requirement_not_evidenced"
  | "below_minimum_experience"
  | "experience_needs_verification";

export interface QualificationFitCriterion {
  requirement: string;
  category: string;
  priority: "hard" | "required" | "preferred";
  status: QualificationCriterionStatus;
  resolved: boolean;
  weight: number;
  points: number;
  jobEvidence: string;
  evidence: string[];
  evidenceExcerpts: string[];
  explanation: string;
}

export interface QualificationFitResult {
  rubricVersion: string;
  minimumEvidenceCoverage: number;
  status: QualificationFitStatus;
  score: number | null;
  rawScore: number | null;
  evidenceCoverage: number | null;
  summary: string;
  criteria: QualificationFitCriterion[];
}

interface ExperienceRow {
  title?: unknown;
  role?: unknown;
  startDate?: unknown;
  start_date?: unknown;
  endDate?: unknown;
  end_date?: unknown;
  bullets?: unknown;
  description?: unknown;
  [key: string]: unknown;
}

interface QualificationFitInput {
  jobDescription: string | null | undefined;
  jobTitle?: string | null;
  jobAnalysis: Partial<JobAnalysisV1> | null | undefined;
  baseResume: unknown;
  verifiedSkills?: string[];
  sourceOfTruthSkills?: string[];
  evidence?: Array<{ id?: string; title?: string; description?: string; relatedSkills?: string[] }>;
  evaluatedAt: string | Date;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "with",
  "years", "year", "experience", "experienced", "background", "professional", "relevant", "minimum", "required",
  "must", "have", "having", "work", "working", "ability", "skills", "skill", "knowledge", "strong",
]);
const MINIMUM_RESOLVED_WEIGHT_PERCENT = 70;

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveQualificationJobDescription(value: unknown): string | null {
  const job = asRecord(value);
  const candidates = [
    job.description_text,
    asRecord(job.raw_source_payload).description,
    job.description_html,
    job.description,
    job.rawDescription,
    job.raw_description,
  ];
  const raw = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof raw !== "string") return null;
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function baseContent(value: unknown): Record<string, any> {
  const row = asRecord(value);
  const content = asRecord(row.content);
  return Object.keys(content).length ? content : row;
}

function candidateMaterial(input: QualificationFitInput): Record<string, any> {
  const content = baseContent(input.baseResume);
  const raw = asRecord(input.baseResume);
  return {
    skills: Array.isArray(content.skills) && content.skills.length ? content.skills : raw.skills ?? [],
    experience: Array.isArray(content.experience) && content.experience.length ? content.experience : raw.experience ?? [],
    education: Array.isArray(content.education) && content.education.length ? content.education : raw.education ?? [],
    certifications: Array.isArray(content.certifications) && content.certifications.length ? content.certifications : raw.certifications ?? [],
  };
}

function resolvePointer(root: unknown, path: string): unknown {
  const parts = path.match(/[^.[\]]+|\[(\d+)\]/g) ?? [];
  let current: any = root;
  for (const rawPart of parts) {
    const part = rawPart.startsWith("[") ? rawPart.slice(1, -1) : rawPart;
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function resolveCitationExcerpt(
  citation: string,
  material: Record<string, any>,
  verifiedSkills: string[],
  sourceOfTruthSkills: string[],
  evidence: QualificationFitInput["evidence"],
): string | null {
  const value = citation.trim();
  if (value.startsWith("base.")) {
    const referenced = resolvePointer(material, value.slice("base.".length));
    if (typeof referenced === "string" && referenced.trim()) return referenced.trim().slice(0, 280);
    if (Array.isArray(referenced)) return referenced.find((entry) => typeof entry === "string" && entry.trim())?.trim().slice(0, 280) ?? null;
    return null;
  }
  if (value.startsWith("sot:")) {
    const skill = normalize(value.slice(4));
    return [...verifiedSkills, ...sourceOfTruthSkills].find((item) => normalize(item) === skill) ?? null;
  }
  if (value.startsWith("evidence:")) {
    const title = normalize(value.slice("evidence:".length));
    const item = (evidence ?? []).find((candidate) => normalize(candidate.title ?? "") === title || normalize(candidate.id ?? "") === title);
    return item ? `${item.title ?? item.id ?? "Evidence"}: ${item.description ?? ""}`.slice(0, 280) : null;
  }
  return null;
}

function weightFor(priority: QualificationFitCriterion["priority"]): number {
  return priority === "hard" ? 5 : priority === "preferred" ? 1 : 3;
}

function meaningfulTokens(value: string): string[] {
  const words = normalize(value).split(" ").filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  const acronyms = (value.match(/\b[A-Z][A-Z0-9]{1,3}\b/g) ?? []).map(normalize).filter(Boolean);
  return [...new Set([...words, ...acronyms])];
}

function findJobEvidence(requirement: string, jobDescription: string): string | null {
  const normalizedRequirement = normalize(requirement);
  if (!normalizedRequirement) return null;
  const requiredWords = normalizedRequirement.split(" ");
  const sourceLines = jobDescription.split(/(?<=[.!?])\s+|[\r\n]+/).map((line) => line.trim()).filter(Boolean);
  const exactLine = sourceLines.find((line) => {
    const lineWords = normalize(line).split(" ");
    return requiredWords.length <= lineWords.length && lineWords.some((_, start) =>
      requiredWords.every((word, offset) => lineWords[start + offset] === word),
    );
  });
  if (exactLine) return exactLine.slice(0, 500);
  const tokens = meaningfulTokens(requirement);
  if (tokens.length === 0) return null;
  let best: { line: string; coverage: number } | null = null;
  for (const line of sourceLines) {
    const lineWords = new Set(normalize(line).split(" "));
    const coverage = tokens.filter((token) => lineWords.has(token)).length / tokens.length;
    if (!best || coverage > best.coverage) best = { line, coverage };
  }
  // A loose half-token match can connect generic model summaries to an
  // unrelated sentence. Require substantial lexical support before treating
  // the source description as the provenance for an extracted criterion.
  const minimumCoverage = tokens.length === 1 ? 1 : 0.75;
  return best && best.coverage >= minimumCoverage ? best.line.slice(0, 500) : null;
}

function citationSupportsRequirement(requirement: string, excerpt: string): boolean {
  const normalizedRequirement = normalize(requirement);
  const normalizedExcerpt = normalize(excerpt);
  if (!normalizedRequirement || !normalizedExcerpt) return false;
  if (normalizedExcerpt.includes(normalizedRequirement)) return true;
  const tokens = meaningfulTokens(requirement);
  if (tokens.length === 0) return false;
  const excerptTokens = new Set(normalizedExcerpt.split(" "));
  const supportedTokens = tokens.filter((token) => excerptTokens.has(token)).length;
  // For a multi-word requirement, require at least two matching terms and
  // substantial overlap. A valid pointer to unrelated text is not evidence.
  return tokens.length === 1
    ? supportedTokens === 1
    : supportedTokens >= 2 && supportedTokens * 3 >= tokens.length * 2;
}

function priorityForRequirement(entry: RequirementAnalysisEntry, jobEvidence: string): QualificationFitCriterion["priority"] {
  if (entry.status === "nice_to_have" || /\b(preferred|nice to have|bonus|desired)\b/i.test(jobEvidence)) return "preferred";
  if (entry.status === "hard_blocker" || /\b(required|requires|must(?:[- ]have)?|mandatory|minimum|at least)\b/i.test(jobEvidence)) {
    if (!/\bnot required\b/i.test(jobEvidence)) return "hard";
  }
  return "required";
}

interface MinimumExperienceRequirement {
  years: number;
  text: string;
  preferred: boolean;
  hard: boolean;
}

function extractMinimumExperienceRequirements(jobDescription: string): MinimumExperienceRequirement[] {
  const results: MinimumExperienceRequirement[] = [];
  const pattern = /\b(?:(minimum(?:\s+of)?|at\s+least)\s+)?(\d{1,2})\s*(\+|plus)?\s+years?\b/gi;
  for (const match of jobDescription.matchAll(pattern)) {
    const index = match.index ?? 0;
    const years = Number(match[2]);
    if (!Number.isInteger(years) || years < 1 || years > 40) continue;
    const nearby = jobDescription.slice(Math.max(0, index - 75), Math.min(jobDescription.length, index + match[0].length + 150));
    if (!/experience|experienced|background|work history/i.test(nearby)) continue;
    const sentenceStart = Math.max(jobDescription.lastIndexOf(".", index), jobDescription.lastIndexOf("\n", index), jobDescription.lastIndexOf(";", index)) + 1;
    const sentenceEndCandidates = [".", "\n", ";"].map((mark) => {
      const position = jobDescription.indexOf(mark, index + match[0].length);
      return position < 0 ? jobDescription.length : position;
    });
    const sentenceEnd = Math.min(...sentenceEndCandidates);
    const clause = jobDescription.slice(sentenceStart, sentenceEnd).trim();
    const preferred = /preferred|nice.to.have|bonus|desired/i.test(clause);
    const hard = !preferred && (Boolean(match[1]) || Boolean(match[3]) || /\b(required|must have|minimum)\b/i.test(clause));
    const criterionText = clause || match[0];
    if (results.some((item) => item.years === years && normalize(item.text) === normalize(criterionText))) continue;
    results.push({ years, text: criterionText, preferred, hard });
  }
  return results;
}

function monthIndex(value: unknown): number | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getUTCFullYear() * 12 + value.getUTCMonth();
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (match) {
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return Number(match[1]) * 12 + month - 1;
  }
  match = text.match(/^(\d{1,2})[-/](\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    if (month >= 1 && month <= 12) return Number(match[2]) * 12 + month - 1;
  }
  const monthName = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})\b/i);
  if (monthName) {
    const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = names.findIndex((name) => monthName[1].toLowerCase().startsWith(name));
    if (month >= 0) return Number(monthName[2]) * 12 + month;
  }
  return null;
}

function evaluatedMonth(value: string | Date): number | null {
  if (value instanceof Date) return monthIndex(value);
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? monthIndex(parsed) : null;
}

function overlapsDomain(candidateText: string, descriptor: string, jobTitle: string): boolean {
  const candidate = normalize(candidateText);
  const terms = meaningfulTokens(`${descriptor} ${jobTitle}`);
  if (terms.length === 0) return false;
  const groups = [
    ["gis", "geospatial", "spatial", "geodatabase"],
    ["database", "databases", "postgis", "sql", "geodatabase"],
    ["python", "scripting"],
    ["cloud", "aws", "azure", "gcp"],
  ];
  const matchedGroup = groups.find((group) => terms.some((term) => group.includes(term)));
  if (matchedGroup) return matchedGroup.some((term) => new RegExp(`\\b${term}\\b`, "i").test(candidate));
  return terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(candidate));
}

function relevantExperienceMonths(
  material: Record<string, any>,
  descriptor: string,
  jobTitle: string,
  jobDescription: string,
  evaluationMonth: number | null,
): { months: number | null; sourceIndexes: number[]; undatedRelevant: boolean } {
  const rows = Array.isArray(material.experience) ? material.experience as ExperienceRow[] : [];
  if (rows.length === 0) return { months: null, sourceIndexes: [], undatedRelevant: true };
  const allowInternships = /(?:internships?|interns?).{0,45}(?:count|equivalent|included|accepted)|(?:count|equivalent|included|accepted).{0,45}(?:internships?|interns?)/i.test(jobDescription);
  const intervals: Array<{ start: number; end: number; index: number }> = [];
  const matchedIndexes: number[] = [];
  let undatedRelevant = false;
  rows.forEach((row, index) => {
    const title = asText(row.title ?? row.role);
    const bullets = Array.isArray(row.bullets) ? row.bullets.map(asText).join(" ") : asText(row.description);
    const text = `${title} ${bullets}`;
    if (!overlapsDomain(text, descriptor, jobTitle)) return;
    if (!allowInternships && /\bintern(?:ship)?\b/i.test(title)) return;
    matchedIndexes.push(index);
    const start = monthIndex(row.startDate ?? row.start_date);
    const rawEnd = row.endDate ?? row.end_date;
    const endText = asText(rawEnd);
    const end = /^(present|current|now)$/i.test(endText) || row.isCurrent === true
      ? evaluationMonth
      : monthIndex(rawEnd);
    if (start == null || end == null || end < start) {
      undatedRelevant = true;
      return;
    }
    intervals.push({ start, end, index });
  });
  // A resume with no matching role is missing evidence, not proof that the
  // candidate has zero relevant experience.
  if (matchedIndexes.length === 0) return { months: null, sourceIndexes: [], undatedRelevant: true };
  if (intervals.length === 0) return { months: undatedRelevant ? null : 0, sourceIndexes: matchedIndexes, undatedRelevant };
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  let totalMonths = 0;
  let rangeStart = intervals[0].start;
  let rangeEnd = intervals[0].end;
  for (const interval of intervals.slice(1)) {
    if (interval.start <= rangeEnd + 1) rangeEnd = Math.max(rangeEnd, interval.end);
    else {
      totalMonths += rangeEnd - rangeStart + 1;
      rangeStart = interval.start;
      rangeEnd = interval.end;
    }
  }
  totalMonths += rangeEnd - rangeStart + 1;
  return { months: totalMonths, sourceIndexes: matchedIndexes, undatedRelevant };
}

function experienceCriterion(
  requirement: MinimumExperienceRequirement,
  input: QualificationFitInput,
  material: Record<string, any>,
  evaluationMonth: number | null,
): QualificationFitCriterion {
  const priority = requirement.preferred ? "preferred" : requirement.hard ? "hard" : "required";
  const weight = weightFor(priority);
  const experience = relevantExperienceMonths(
    material,
    requirement.text,
    input.jobTitle ?? "",
    input.jobDescription ?? "",
    evaluationMonth,
  );
  const requiredMonths = requirement.years * 12;
  const evidence = experience.sourceIndexes.map((sourceIndex) => `base.experience[${sourceIndex}]`);
  const experienceRows = Array.isArray(material.experience) ? material.experience as ExperienceRow[] : [];
  const evidenceExcerpts = experience.sourceIndexes.map((sourceIndex) => {
    const row = experienceRows[sourceIndex] ?? {};
    const title = asText(row.title ?? row.role) || "Relevant experience";
    const start = asText(row.startDate ?? row.start_date) || "date not provided";
    const end = asText(row.endDate ?? row.end_date) || "end date not provided";
    return `${title} (${start} to ${end})`;
  });
  if (experience.months == null || experience.undatedRelevant && experience.months < requiredMonths) {
    return {
      requirement: `${requirement.years}+ years of relevant experience: ${requirement.text}`,
      category: "minimum_experience",
      priority,
      status: "experience_needs_verification",
      resolved: false,
      weight,
      points: 0,
      jobEvidence: requirement.text,
      evidence,
      evidenceExcerpts,
      explanation: "Relevant role dates are missing or incomplete, so the minimum cannot be confirmed.",
    };
  }
  if (experience.months < requiredMonths) {
    return {
      requirement: `${requirement.years}+ years of relevant experience: ${requirement.text}`,
      category: "minimum_experience",
      priority,
      status: "below_minimum_experience",
      resolved: true,
      weight,
      points: 0,
      jobEvidence: requirement.text,
      evidence,
      evidenceExcerpts,
      explanation: `The dated relevant experience in the submitted resume totals ${experience.months} months; ${requiredMonths} months are requested.`,
    };
  }
  return {
    requirement: `${requirement.years}+ years of relevant experience: ${requirement.text}`,
    category: "minimum_experience",
    priority,
    status: "meets",
    resolved: true,
    weight,
    points: weight,
    jobEvidence: requirement.text,
    evidence,
    evidenceExcerpts,
    explanation: `The dated relevant experience in the submitted resume totals at least ${requiredMonths} months.`,
  };
}

export function computeQualificationFit(input: QualificationFitInput): QualificationFitResult {
  const jobDescription = asText(input.jobDescription);
  const analysis = asRecord(input.jobAnalysis);
  const requirementAnalysis = Array.isArray(analysis.requirementAnalysis)
    ? analysis.requirementAnalysis as RequirementAnalysisEntry[]
    : [];
  const material = candidateMaterial(input);
  const noScore = (summary: string): QualificationFitResult => ({
    rubricVersion: QUALIFICATION_FIT_RUBRIC_VERSION,
    minimumEvidenceCoverage: MINIMUM_RESOLVED_WEIGHT_PERCENT,
    status: "insufficient_evidence",
    score: null,
    rawScore: null,
    evidenceCoverage: null,
    summary,
    criteria: [],
  });

  if (jobDescription.length < 80) return noScore("The source job description is missing or too short to score reliably.");
  if (requirementAnalysis.length === 0) return noScore("Resume Forge did not produce structured candidate-to-job requirements for this run.");
  const experienceRequirements = extractMinimumExperienceRequirements(jobDescription);
  const coreJobFields = [analysis.requiredSkills, analysis.responsibilities, analysis.tools, analysis.certifications]
    .filter((value) => Array.isArray(value) && value.length > 0).length;
  if (coreJobFields === 0 && experienceRequirements.length === 0) {
    return noScore("The structured job analysis has no usable requirements; review the job analysis before scoring.");
  }

  const verifiedSkills = input.verifiedSkills ?? [];
  const sourceOfTruthSkills = input.sourceOfTruthSkills ?? [];
  const evidenceSources = input.evidence ?? [];
  const criteria: QualificationFitCriterion[] = [];
  let ungroundedRequirementCount = 0;

  for (const entry of requirementAnalysis) {
    const isExplicitExperienceCriterion = experienceRequirements.some((requirement) =>
      /\b(years?|experience)\b/i.test(entry.requirement) &&
      new RegExp(`\\b${requirement.years}\\s*(?:\\+|plus)?\\s+years?\\b`, "i").test(entry.requirement),
    );
    if (isExplicitExperienceCriterion) continue;
    const jobEvidence = findJobEvidence(entry.requirement, jobDescription);
    if (!jobEvidence) {
      ungroundedRequirementCount++;
      continue;
    }
    const priority = priorityForRequirement(entry, jobEvidence);
    const weight = weightFor(priority);
    const validatedCitations = (entry.sourceEvidence ?? [])
      .map((citation) => ({ citation, excerpt: resolveCitationExcerpt(citation, material, verifiedSkills, sourceOfTruthSkills, evidenceSources) }))
      .filter((item): item is { citation: string; excerpt: string } =>
        Boolean(item.excerpt && citationSupportsRequirement(entry.requirement, item.excerpt)),
      );
    const validCitations = validatedCitations.map((item) => item.citation);
    const evidenceExcerpts = validatedCitations.map((item) => item.excerpt);
    if ((entry.status === "supported_by_resume" || entry.status === "supported_but_not_surfaced" || entry.status === "nice_to_have") && validCitations.length > 0) {
      criteria.push({
        requirement: entry.requirement,
        category: entry.category,
        priority,
        status: "meets",
        resolved: true,
        weight,
        points: weight,
        jobEvidence,
        evidence: validCitations,
        evidenceExcerpts,
        explanation: "Supported by a source citation in the frozen candidate evidence.",
      });
    } else if (entry.status === "hard_blocker") {
      criteria.push({
        requirement: entry.requirement,
        category: entry.category,
        priority,
        status: "hard_requirement_not_evidenced",
        resolved: false,
        weight,
        points: 0,
        jobEvidence,
        evidence: [],
        evidenceExcerpts: [],
        explanation: "Resume Forge marked this mandatory credential or eligibility requirement as lacking candidate evidence; verify before making a decision.",
      });
    } else {
      criteria.push({
        requirement: entry.requirement,
        category: entry.category,
        priority,
        status: "not_evidenced",
        resolved: false,
        weight,
        points: 0,
        jobEvidence,
        evidence: [],
        evidenceExcerpts: [],
        explanation: entry.status === "unsupported"
          ? "No supporting source was cited. This is an evidence gap, not proof that the candidate lacks the qualification."
          : "The available citation could not be resolved against the frozen candidate evidence.",
      });
    }
  }

  if (ungroundedRequirementCount > 0 || (criteria.length === 0 && experienceRequirements.length === 0)) {
    return {
      rubricVersion: QUALIFICATION_FIT_RUBRIC_VERSION,
      minimumEvidenceCoverage: MINIMUM_RESOLVED_WEIGHT_PERCENT,
      status: "needs_review",
      score: null,
      rawScore: null,
      evidenceCoverage: null,
      summary: criteria.length === 0
        ? "The extracted requirements could not be matched to the source job description. Review the job analysis."
        : `${ungroundedRequirementCount} extracted requirement(s) could not be verified against the source job description. Review before scoring.`,
      criteria,
    };
  }

  const evaluationMonth = evaluatedMonth(input.evaluatedAt);
  for (const requirement of experienceRequirements) {
    criteria.push(experienceCriterion(requirement, input, material, evaluationMonth));
  }

  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const resolvedWeight = criteria.reduce((sum, criterion) => sum + (criterion.resolved ? criterion.weight : 0), 0);
  if (totalWeight <= 0) return noScore("No requirements had enough evidence to calculate a fit score.");
  const evidenceCoverage = Math.round((resolvedWeight / totalWeight) * 100);
  const hardRequirementUnknown = criteria.some((criterion) =>
    criterion.status === "hard_requirement_not_evidenced" ||
      (criterion.priority === "hard" && criterion.status === "not_evidenced") ||
      (criterion.priority === "hard" && criterion.status === "experience_needs_verification"),
  );
  const hardRequirementGap = criteria.some((criterion) =>
    criterion.priority === "hard" && criterion.status === "below_minimum_experience",
  );
  const experienceBelowMinimum = criteria.some((criterion) => criterion.status === "below_minimum_experience");
  const notEvidencedCount = criteria.filter((criterion) => !criterion.resolved).length;
  if (hardRequirementUnknown) {
    return {
      rubricVersion: QUALIFICATION_FIT_RUBRIC_VERSION,
      minimumEvidenceCoverage: MINIMUM_RESOLVED_WEIGHT_PERCENT,
      status: "needs_review",
      score: null,
      rawScore: null,
      evidenceCoverage,
      summary: "A hard requirement is not verified in the available candidate evidence. Review it before assigning a definitive qualification-fit score.",
      criteria,
    };
  }
  if (resolvedWeight <= 0) return noScore("No requirements had enough evidence to calculate a fit score.");
  const points = criteria.reduce((sum, criterion) => sum + (criterion.resolved ? criterion.points : 0), 0);
  const rawScore = (points / resolvedWeight) * 10;
  let score: number | null = Math.round(rawScore * 10) / 10;
  if (hardRequirementGap && score !== null) score = Math.min(score, 4);
  if (evidenceCoverage < MINIMUM_RESOLVED_WEIGHT_PERCENT) {
    return {
      rubricVersion: QUALIFICATION_FIT_RUBRIC_VERSION,
      minimumEvidenceCoverage: MINIMUM_RESOLVED_WEIGHT_PERCENT,
      status: "insufficient_evidence",
      score: null,
      rawScore: null,
      evidenceCoverage,
      summary: `Only ${evidenceCoverage}% of weighted requirements have verifiable evidence; at least ${MINIMUM_RESOLVED_WEIGHT_PERCENT}% is needed to show a score.`,
      criteria,
    };
  }
  const needsReview = experienceBelowMinimum || notEvidencedCount > 0;
  const experienceNeedsVerification = criteria.some((criterion) => criterion.status === "experience_needs_verification");
  const summary = hardRequirementUnknown
    ? "A hard requirement is not verified in the available candidate evidence. Review it before assigning a definitive qualification-fit score."
    : hardRequirementGap
      ? "Dated resume evidence is below an explicit minimum-experience requirement; the score is capped at 4.0/10. Review the cited timeline before deciding."
      : experienceBelowMinimum
        ? "Dated resume evidence is below a stated experience requirement. Review the cited timeline before deciding."
        : experienceNeedsVerification
      ? "Experience dates need verification; treat this score as provisional."
      : notEvidencedCount > 0
        ? `${notEvidencedCount} requirement(s) remain unverified. The provisional score uses only requirements with verifiable evidence; unresolved items do not prove the candidate lacks those qualifications.`
        : "All scored requirements have supporting candidate evidence.";

  return {
    rubricVersion: QUALIFICATION_FIT_RUBRIC_VERSION,
    minimumEvidenceCoverage: MINIMUM_RESOLVED_WEIGHT_PERCENT,
    status: needsReview || notEvidencedCount > 0 ? "needs_review" : "scored",
    score,
    rawScore,
    evidenceCoverage,
    summary,
    criteria,
  };
}
