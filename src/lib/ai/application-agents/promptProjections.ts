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
    requirementAnalysis: requirementAnalysis.map((r: any, i: number) => ({
      id: `r${i}`,
      text: typeof r?.requirement === "string" ? r.requirement : "",
      category: typeof r?.category === "string" ? r.category : "other",
      status: typeof r?.status === "string" ? r.status : "unsupported",
      safeToAdd: Boolean(r?.safeToAdd),
    })),
  };
}

export interface ProjectedDraft {
  summary: string | null;
  skills: unknown;
  experience: Array<{ title: unknown; company: unknown; bullets: unknown; evidenceIds: unknown }>;
  education: unknown;
  certifications: unknown;
  projects: unknown;
}

/**
 * Draft projection = roles + bullets + skills, plus each role's evidenceIds
 * (Final Polish's prompt instructs it to echo evidenceIds back on every
 * experience entry it returns - finalPolish.ts has no deterministic
 * restoration step for them the way identity fields do, so the model must
 * see the originals or it cannot reproduce them). Drops Resume Forge's own
 * internal bookkeeping fields that neither Hiring Panel nor Final Polish's
 * prompts reference: changeLog, missingRequirements, excludedKeywords,
 * truthRisks - these are the largest single contributor to draft size (an
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
  };
}
