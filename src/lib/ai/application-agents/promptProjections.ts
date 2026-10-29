// Shared compact projections for Hiring Panel and Final Polish prompts.
//
// B2/B3 (2026-09-28): both prompts used to send raw JSON.stringify(...) of
// the job analysis and the draft, then hard-truncate with .slice(N) - Final
// Polish's job-analysis slice (4000 chars) cut off requirementAnalysis in
// ~40% of real runs (application_job_lens artifacts average 8,911 chars, and
// requirementAnalysis is one of the later keys jsonb's key-order produces),
// and its draft slice (8000 chars) cut off content in 98% of real drafts
// (avg 10,510 chars). A stage was being asked to verify requirement coverage
// against data it literally could not see.
//
// These projections keep only what each prompt's own instructions actually
// reference, so the same information fits without truncation - and, as a
// side effect, costs meaningfully fewer tokens than the raw JSON ever did.
// Both prompt files must use the SAME projection so job-analysis/draft
// representations never drift between Hiring Panel and Final Polish again.

export interface ProjectedRequirement {
  id: string;
  text: string;
  category: string;
  status: string;
  safeToAdd: boolean;
  sourceEvidence: string[];
  notes: string | null;
}

export interface ProjectedJobAnalysis {
  title: string;
  company: string;
  domain: string | null;
  seniority: string | null;
  atsKeywords: string[];
  prohibitedUnsupportedClaims: string[];
  requirementAnalysis: ProjectedRequirement[];
}

export function projectJobAnalysisForReview(jobAnalysis: any): ProjectedJobAnalysis {
  const requirementAnalysis = Array.isArray(jobAnalysis?.requirementAnalysis)
    ? jobAnalysis.requirementAnalysis
    : [];
  return {
    title: typeof jobAnalysis?.title === "string" ? jobAnalysis.title : "",
    company: typeof jobAnalysis?.company === "string" ? jobAnalysis.company : "",
    domain: typeof jobAnalysis?.domain === "string" ? jobAnalysis.domain : null,
    seniority: typeof jobAnalysis?.seniority === "string" ? jobAnalysis.seniority : null,
    atsKeywords: Array.isArray(jobAnalysis?.atsKeywords) ? jobAnalysis.atsKeywords.filter((k: unknown) => typeof k === "string") : [],
    prohibitedUnsupportedClaims: Array.isArray(jobAnalysis?.prohibitedUnsupportedClaims)
      ? jobAnalysis.prohibitedUnsupportedClaims.filter((k: unknown) => typeof k === "string")
      : [],
    requirementAnalysis: requirementAnalysis.filter((r: any) => r && typeof r === "object" && !Array.isArray(r)).map((r: any, i: number) => ({
      id: `r${i}`,
      text: typeof r?.requirement === "string" ? r.requirement : "",
      category: typeof r?.category === "string" ? r.category : "other",
      status: typeof r?.status === "string" ? r.status : "unsupported",
      safeToAdd: r?.safeToAdd === true,
      sourceEvidence: Array.isArray(r?.sourceEvidence) ? r.sourceEvidence.filter((s: unknown): s is string => typeof s === "string") : [],
      notes: typeof r?.notes === "string" ? r.notes : null,
    })),
  };
}

export interface ProjectedJobAnalysisForDraft extends ProjectedJobAnalysis {
  responsibilities: string[];
  ambiguities: string[];
}

/**
 * Resume Forge's draft call needs slightly more than the review projection:
 * `responsibilities` gives real context for expanding bullets ("what does
 * this role actually do"), which Hiring Panel/Final Polish never need since
 * they only grade/polish content that already exists. Still drops
 * requiredSkills, preferredSkills, tools, methodologies, and certifications -
 * every one of those is already re-encoded as its own requirementAnalysis
 * entry (see buildRequirementAnalysisPrompt's requirementSources), so
 * resending them here is pure duplication. Drop rawSummary and
 * evidenceRequirements, which guide classification. Source pointers, notes and
 * ambiguities are retained so the writer can verify and flag conflicts.
 */
export function projectJobAnalysisForDraft(jobAnalysis: any): ProjectedJobAnalysisForDraft {
  return {
    ...projectJobAnalysisForReview(jobAnalysis),
    responsibilities: Array.isArray(jobAnalysis?.responsibilities)
      ? jobAnalysis.responsibilities.filter((r: unknown): r is string => typeof r === "string")
      : [],
    ambiguities: Array.isArray(jobAnalysis?.ambiguities)
      ? jobAnalysis.ambiguities.filter((r: unknown): r is string => typeof r === "string")
      : [],
  };
}

export interface ProjectedDraft {
  summary: string | null;
  skills: unknown;
  experience: Array<{ title: unknown; company: unknown; bullets: unknown; evidenceIds: unknown }>;
  education: unknown;
  certifications: unknown;
  projects: unknown;
  missingRequirements: unknown;
  truthRisks: unknown;
}

/**
 * Draft projection = roles + bullets + skills, plus each role's evidenceIds
 * (Final Polish's prompt instructs it to echo evidenceIds back on every
 * experience entry it returns - finalPolish.ts has no deterministic
 * restoration step for them the way identity fields do, so the model must
 * see the originals or it cannot reproduce them). Drops Resume Forge's own
 * internal bookkeeping fields that neither Hiring Panel nor Final Polish's
 * prompts reference: changeLog and excludedKeywords. Retain missingRequirements
 * and truthRisks so reviewers see unresolved gaps. changeLog can be large (an
 * 8-role resume's changeLog alone can exceed the old 8,000-char Final
 * Polish slice on its own).
 */
export function projectDraftForReview(draft: any): ProjectedDraft {
  const experience = Array.isArray(draft?.experience) ? draft.experience : [];
  return {
    summary: typeof draft?.summary === "string" ? draft.summary : null,
    skills: draft?.skills ?? [],
    experience: experience.map((exp: any) => ({
      title: exp?.title ?? null,
      company: exp?.company ?? null,
      bullets: Array.isArray(exp?.bullets) ? exp.bullets : [],
      evidenceIds: Array.isArray(exp?.evidenceIds) ? exp.evidenceIds : [],
    })),
    education: draft?.education ?? [],
    certifications: draft?.certifications ?? [],
    projects: draft?.projects ?? [],
    missingRequirements: Array.isArray(draft?.missingRequirements) ? draft.missingRequirements : [],
    truthRisks: Array.isArray(draft?.truthRisks) ? draft.truthRisks : [],
  };
}

/** Preserve complete factual material for reviewers without contact/private storage fields.
 * Never slice serialized JSON: the tail may contain the only evidence for a claim.
 */
export function projectBaseResumeForReview(content: any): Record<string, unknown> {
  return {
    summary: content?.summary ?? null,
    skills: content?.skills ?? [],
    experience: content?.experience ?? [],
    education: content?.education ?? [],
    certifications: content?.certifications ?? [],
    projects: content?.projects ?? [],
    customSections: content?.customSections ?? [],
  };
}

export function projectEvidenceForReview(evidence: unknown): unknown[] {
  return (Array.isArray(evidence) ? evidence : [])
    .filter((e) => e && typeof e === "object" && !Array.isArray(e))
    .map((e) => ({ id: e.id, title: e.title, description: e.description, relatedSkills: e.relatedSkills }));
}
