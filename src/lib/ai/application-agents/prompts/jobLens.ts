// Job Lens prompt builders.
//
// Split in two: buildJobOnlyLensPrompt() extracts everything that depends
// only on the job posting (title, skills, tools, ATS keywords, etc.) - this
// is what jobs.job_analysis caches once per job (093_job_analysis_cache.sql).
// buildRequirementAnalysisPrompt() classifies those requirements against one
// candidate's evidence (base resume, Source of Truth, evidence bank,
// verified skills) and produces ONLY requirementAnalysis, the per-candidate
// part that still runs on every application and is never cached. Both are
// shared with jobCategorization.ts, which requests the same job-only fields
// in its own single categorization call so the two never drift on what
// counts as "job-only" data.
//
// Kept as two separate functions (not one prompt with an optional
// candidateContext) specifically so jobCategorization.ts - which has no
// candidate context at all - can share the exact same job-only instructions
// byte-for-byte instead of a second, hand-copied near-duplicate.

import { mergeSkillSources } from "./mergeSkillSources";
import type { JobOnlyAnalysisV1 } from "../schemas";

export interface JobLensCandidateContext {
  baseResume?: {
    skills?: string[];
    experience?: { title: string; company: string; bullets: string[] }[];
    education?: { degree: string; school: string }[];
    certifications?: string[];
    content?: unknown;
  } | null;
  evidence?: { title: string; description: string; relatedSkills: string[] }[];
  sourceOfTruth?: { confirmedSkills: string[] } | null;
  verifiedSkills?: string[];
}

/**
 * Job-only extraction: everything a job posting itself determines, with no
 * candidate context at all. Shared verbatim by jobCategorization.ts's single
 * categorization call, so the field definitions below are the one place
 * this wording lives.
 */
export function buildJobOnlyLensPrompt(job: any): string {
  return `You are Job Lens, an AI that analyzes job descriptions to extract structured requirements.
Your output is the targeting data for a resume-writing pipeline: downstream agents decide what to
emphasize, what exact words to use, and what they are FORBIDDEN to claim, based entirely on what
you extract. Precision here decides whether the final resume beats the ATS filter and survives a
recruiter's 6-second scan.

Analyze this job posting and return a JSON object with the following fields:
- title: the job title
- company: the company name
- location: the job location (or null if not specified)
- requiredSkills: array of required skills. ORDER MATTERS: lead with the 3-5 requirements the
  posting treats as its real selection criteria — the ones repeated multiple times, listed
  first, marked "must have"/"required", or embedded in the job title itself. Downstream agents
  allocate resume space in this order. Include years-of-experience qualifiers in the skill
  string when the JD states them (e.g., "5+ years OSP design", not just "OSP design").
- preferredSkills: array of nice-to-have skills — anything marked "preferred", "a plus",
  "bonus", or "nice to have". Never mix these into requiredSkills.
- tools: array of tools, software, or platforms mentioned. Use the JD's EXACT product names
  and casing (e.g., "Vetro FiberMap" not "Vetro", "AutoCAD" not "autocad") — resume keyword
  matching downstream is verbatim.
- methodologies: array of methodologies (e.g., Agile, Scrum)
- certifications: array of required/preferred certifications, licenses, and degrees. Be
  specific and mark which are hard requirements vs. preferred (e.g., "PE License (required,
  CA/CO/WA preferred)" vs. "PMP (preferred)") — downstream agents rely on this wording to
  know what NOT to fabricate.
- seniority: seniority level (e.g., Senior, Lead, Junior) or null
- domain: industry domain or null
- atsKeywords: array of keywords an ATS or keyword-scanning recruiter would score, in priority
  order (most critical first). Rules:
  * Use the JD's exact phrasing, spelling, and casing — matching is verbatim.
  * When the JD uses both an acronym and its spelled-out form (or clearly means both), include
    BOTH as separate entries (e.g., "OSP" and "Outside Plant"; "GIS" and "Geographic
    Information Systems") — ATS systems frequently match only one form.
  * Keep multi-word phrases intact ("fiber network design", "splice documentation"), not
    tokenized fragments.
  * Include degree/experience threshold phrases the ATS may score ("Bachelor's degree",
    "5+ years").
- responsibilities: array of key responsibilities, most central to the role first
- evidenceRequirements: array of concrete proof a strong candidate would show for the top
  requirements, phrased as checkable items ("designed OSP routes in Vetro FiberMap on a real
  deployment", not "knows Vetro"). Downstream agents use these to judge whether the
  candidate's evidence bank truly supports a claim.
- prohibitedUnsupportedClaims: claims that should never be made without proof. ALWAYS
  include an explicit entry for every required license, certification, or degree named in
  the posting (e.g., "Do not claim a PE license unless evidenced") — this is the single
  highest-risk fabrication category and must never be left implicit. Also include any
  security clearance, work-authorization status, or named-client/named-program experience
  the JD demands.
- ambiguities: unclear or missing information in the JD
- rawSummary: a brief plain-language summary of the role, ending with one sentence naming the
  2-3 things this employer most wants to see on page one of a resume

JOB POSTING:
Title: ${job?.title ?? "Unknown"}
Company: ${job?.company ?? "Unknown"}
Location: ${job?.location ?? "Not specified"}
Description: ${resolveJobDescription(job).slice(0, 8000)}
Employment Type: ${job?.employment_type ?? "Not specified"}
Seniority: ${job?.seniority_level ?? "Not specified"}
Salary: ${job?.salary_range ?? "Not specified"}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}

/**
 * Per-candidate classification: takes the job-only analysis (fresh or from
 * the jobs.job_analysis cache - identical either way, since it's the same
 * shape either way) and classifies every material requirement against one
 * candidate's evidence. Produces ONLY requirementAnalysis - every downstream
 * consumer (resumeForge.ts, hiringPanel.ts, finalPolish.ts,
 * requirementCoverage.ts, disposition.ts) reads the merged JobAnalysisV1
 * shape jobLens.ts's runner assembles from this plus the job-only analysis,
 * so none of them need to change for this split.
 */
export function buildRequirementAnalysisPrompt(
  jobOnlyAnalysis: JobOnlyAnalysisV1,
  candidateContext?: JobLensCandidateContext
): string {
  const ctx = candidateContext ?? {};

  const baseSkills: string[] = Array.isArray(ctx.baseResume?.skills)
    ? ctx.baseResume.skills.filter((s) => typeof s === "string")
    : [];
  const baseExperience = Array.isArray(ctx.baseResume?.experience) ? ctx.baseResume.experience : [];
  const baseEducation = Array.isArray(ctx.baseResume?.education) ? ctx.baseResume.education : [];
  const baseCertifications = Array.isArray(ctx.baseResume?.certifications)
    ? ctx.baseResume.certifications.filter((c) => typeof c === "string")
    : [];
  const evidence = Array.isArray(ctx.evidence) ? ctx.evidence : [];
  const sotSkills = Array.isArray(ctx.sourceOfTruth?.confirmedSkills)
    ? ctx.sourceOfTruth.confirmedSkills.filter((s) => typeof s === "string")
    : [];
  const verifiedSkills = Array.isArray(ctx.verifiedSkills)
    ? ctx.verifiedSkills.filter((s) => typeof s === "string")
    : [];
  // Two separate DB sources (candidates.verified_skills vs
  // candidate_source_of_truth.confirmed_skills) that can overlap - merged
  // into one deduplicated, provenance-tagged list rather than sent as two
  // un-deduplicated arrays.
  const confirmedOrVerifiedSkills = mergeSkillSources(sotSkills, verifiedSkills);

  const experienceLines = baseExperience.map((exp, i) => {
    const bullets = Array.isArray(exp.bullets) ? exp.bullets : [];
    const bulletText = bullets
      .map((b) => (typeof b === "string" ? b : (b as any)?.text ?? ""))
      .filter(Boolean)
      .join(" | ");
    return `[${i}] ${exp.title} @ ${exp.company}: ${bulletText.slice(0, 600)}`;
  }).join("\n");

  // The requirements to classify come from the job-only analysis, already
  // extracted and prioritized - not re-parsed from raw JD text, which is
  // both cheaper and (per the plan) more consistent than re-deriving the
  // same list from scratch on every application.
  const requirementSources = [
    ...jobOnlyAnalysis.requiredSkills.map((r) => ({ requirement: r, hint: "required" as const })),
    ...jobOnlyAnalysis.tools.map((r) => ({ requirement: r, hint: "required" as const })),
    ...jobOnlyAnalysis.certifications.map((r) => ({ requirement: r, hint: "required" as const })),
    ...jobOnlyAnalysis.preferredSkills.map((r) => ({ requirement: r, hint: "nice_to_have" as const })),
  ];

  return `You are Job Lens, an AI that classifies a job posting's requirements against one
candidate's evidence. The job posting itself has already been analyzed (below) - your only job
here is per-candidate: for each requirement, decide whether THIS candidate's material supports it.
Your output is the targeting data for a resume-writing pipeline: downstream agents decide what to
emphasize and what they are FORBIDDEN to claim, based entirely on your classification. Precision
here decides whether the final resume beats the ATS filter and survives a recruiter's 6-second scan.

JOB POSTING (already analyzed - job-only fields, not candidate-specific):
Title: ${jobOnlyAnalysis.title}
Company: ${jobOnlyAnalysis.company}
Domain: ${jobOnlyAnalysis.domain ?? "Not specified"}
Seniority: ${jobOnlyAnalysis.seniority ?? "Not specified"}
Summary: ${jobOnlyAnalysis.rawSummary}
Requirements to classify (required unless marked nice_to_have below): ${JSON.stringify(requirementSources)}
Certifications/credentials named in the posting: ${JSON.stringify(jobOnlyAnalysis.certifications)}
Explicit prohibited-unless-evidenced claims from the posting: ${JSON.stringify(jobOnlyAnalysis.prohibitedUnsupportedClaims)}

Return a JSON object with:
- requirementAnalysis: array of classified requirements — THE most important field. Create ONE
  entry for every material JD requirement listed above: each required skill, required tool,
  license, certification, security clearance, work-authorization status, and any must-have
  domain experience. Each entry is:
  {
    "requirement": "exact JD phrasing (or close, e.g. 'AutoCAD')",
    "category": "skill" | "tool" | "cert" | "credential" | "clearance" | "other",
    "sourceEvidence": ["specific pointers to where the candidate evidence supports this, e.g. 'base.experience[0].bullets[2]', 'sot:Vetro FiberMap', 'evidence:<title>' — leave empty when there is no support"],
    "status": "supported_by_resume" | "supported_but_not_surfaced" | "unsupported" | "hard_blocker" | "nice_to_have",
    "safeToAdd": true only for supported_by_resume / supported_but_not_surfaced rows that cite sourceEvidence; false for everything else,
    "notes": optional short clarification (omit when unnecessary)
  }

REQUIREMENT CLASSIFICATION RULES (CRITICAL — these statuses drive every downstream gate):
* supported_by_resume — the requirement already appears in the candidate's base resume,
  verbatim or close (in skills or experience bullets). Cite the specific base location.
* supported_but_not_surfaced — the Source of Truth confirmed skills, the evidence bank, or
  the base resume narrative support it, but it is NOT currently written into any resume
  bullet or skill entry. Cite the SoT skill name or evidence entry title.
* unsupported — no evidence anywhere in the candidate material. sourceEvidence stays empty.
* hard_blocker — a REQUIRED license, certification, security clearance, citizenship, or
  work-authorization the JD demands as mandatory, and the candidate has zero evidence of it.
  This is a subset of prohibitedUnsupportedClaims. sourceEvidence stays empty.
* nice_to_have — preferred/bonus items only (mirrors preferredSkills). sourceEvidence may be
  cited when support exists.

PRIORITY RULES FOR SUPPORT CLASSIFICATION:
* Every skill in CONFIRMED/VERIFIED SKILLS carries the SAME authority as the base resume,
  regardless of which source(s) named it. A skill from that list is "supported_but_not_surfaced"
  (or supported_by_resume if the base resume also mentions it).
* The evidence bank supports claims the recruiter has already accepted — cite "evidence:<title>".
* Never classify something as supported unless the provided candidate material actually
  mentions it. When in doubt between unsupported and supported, choose unsupported.

CANDIDATE MATERIAL (for classification only — never copied into the resume):
BASE RESUME SKILLS: ${baseSkills.length > 0 ? JSON.stringify(baseSkills) : "(none)"}
BASE RESUME EXPERIENCE:
${experienceLines || "(none)"}
BASE RESUME EDUCATION: ${baseEducation.length > 0 ? JSON.stringify(baseEducation.map((e) => `${e.degree} — ${e.school}`)) : "(none)"}
BASE RESUME CERTIFICATIONS: ${baseCertifications.length > 0 ? JSON.stringify(baseCertifications) : "(none)"}
CONFIRMED/VERIFIED SKILLS (recruiter-confirmed, same authority as base resume; each is tagged with which source(s) named it - "(verified)", "(confirmed)", or both - purely informational, both sources are equally trustworthy):
${confirmedOrVerifiedSkills.length > 0 ? JSON.stringify(confirmedOrVerifiedSkills) : "(none)"}
EVIDENCE BANK (recruiter-accepted narrative facts):
${evidence.length > 0 ? JSON.stringify(evidence.map((e) => ({ title: e.title, description: e.description.slice(0, 300), relatedSkills: e.relatedSkills }))) : "(none)"}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}

// jobs.description_text is only populated for postings that went through the
// scraper's extraction pipeline (stripHtml(jp.description)) - jobs imported
// via other paths (e.g. source: "normalized_import") instead carry the full
// JD text in `notes` or raw_source_payload.description, with description_text
// left null. Falling back only to description_text/raw_description/description
// (none of which are real columns on this table besides description_text)
// silently produced "No description available" for those jobs, causing Job
// Lens to analyze nothing - confirmed live for a COIL posting during
// pipeline stress-testing (empty atsKeywords/requiredSkills, hard-failed the
// Hiring Panel quality gate on ATS score 0).
export function resolveJobDescription(job: any): string {
  if (job?.description_text) return job.description_text;
  if (job?.notes) return job.notes;
  if (job?.raw_source_payload?.description) return String(job.raw_source_payload.description);
  if (job?.description_html) return String(job.description_html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (job?.description) return job.description;
  if (job?.rawDescription) return job.rawDescription;
  return "No description available";
}
