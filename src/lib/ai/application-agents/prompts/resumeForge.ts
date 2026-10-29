// Resume Forge prompt builder
// Skills come exclusively from the candidate's Source of Truth (confirmed_skills from DB)
// and the job analysis. No hardcoded category maps. The AI decides where skills belong.

import { readBaseSummary } from "../resumeIntegrity";
import { mergeSkillSources } from "./mergeSkillSources";
import { projectJobAnalysisForDraft, projectBaseResumeForReview, projectEvidenceForReview } from "../promptProjections";
import { resolveQualificationJobDescription } from "../qualificationFit";
import { RESUME_WRITING_RULES, bulletBudgetForIndex } from "../resumeWritingPolicy";

/**
 * Normalise a single bullet that may be stored as a plain string or as a { text: string }
 * object (both formats appear in older base resumes). Returns a plain string or null.
 */
function normaliseBullet(b: unknown): string | null {
  if (typeof b === "string" && b.trim()) return b.trim();
  if (b && typeof b === "object" && !Array.isArray(b)) {
    const obj = b as Record<string, unknown>;
    if (typeof obj.text === "string" && obj.text.trim()) return obj.text.trim();
    if (typeof obj.content === "string" && obj.content.trim()) return obj.content.trim();
    if (typeof obj.description === "string" && obj.description.trim()) return obj.description.trim();
  }
  return null;
}

/**
 * Return a normalised copy of the base resume content where every experience entry's
 * bullets are guaranteed to be a plain string[]. Handles both `bullets` and `bulletPoints`
 * fields, and objects like `{ text: string }`. The original object is NOT mutated.
 */
function normaliseBaseContent(baseContent: any): any {
  if (!baseContent || typeof baseContent !== "object") return baseContent ?? {};
  const experiences: any[] = Array.isArray(baseContent.experience)
    ? baseContent.experience.map((exp: any) => {
        const rawBullets: unknown[] =
          Array.isArray(exp.bullets) ? exp.bullets :
          Array.isArray(exp.bulletPoints) ? exp.bulletPoints : [];
        const normalisedBullets = rawBullets.map(normaliseBullet).filter((b): b is string => b !== null);
        return { ...exp, bullets: normalisedBullets, bulletPoints: undefined };
      })
    : (baseContent.experience ?? []);
  return { ...baseContent, experience: experiences };
}

/** Role-specific writing guides; these must never become padding quotas. */
function buildBulletRequirements(experiences: any[]): string {
  if (!experiences || experiences.length === 0) return "";
  const lines = experiences.map((exp, idx) => {
    const roleLabel = exp.title
      ? `"${exp.title}" at ${exp.company ?? ""}`
      : `Role ${idx + 1}`;
    const { max } = bulletBudgetForIndex(idx);
    return `  - ${roleLabel}: usually 1-${max} concise, evidenced bullets; fewer is valid when source material is sparse`;
  });
  return lines.join("\n");
}

/**
 * Build a human-readable snapshot of the experience section — role headings and their
 * existing bullets as a numbered list. Sent to the AI separately from the raw JSON so
 * the AI cannot miss or misinterpret the existing bullet content.
 */
function buildExperienceSnapshot(experiences: any[]): string {
  if (!experiences || experiences.length === 0) return "(no experience entries)";
  return experiences.map((exp, idx) => {
    const header = `${idx + 1}. ${exp.title ?? "Role"} at ${exp.company ?? ""} (${exp.startDate ?? ""} – ${exp.endDate ?? "Present"})`;
    const bullets: string[] = Array.isArray(exp.bullets) ? exp.bullets : [];
    const bulletLines = bullets.length > 0
      ? bullets.map((b: string, i: number) => `   ${i + 1}. ${b}`).join("\n")
      : "   (no bullets stored - do not invent this role's duties from the job description; flag missing evidence)";
    return `${header}\n${bulletLines}`;
  }).join("\n\n");
}

/**
 * Removes two categories of redundant data from the base-resume JSON before
 * it goes into the raw-JSON block:
 *
 * 1. Fields the model's output can never actually influence: applyForgeGuards()
 *    (resumeForge.ts, the runner) unconditionally overwrites personalInfo
 *    wholesale from the real base resume, and enforceExperienceIntegrity()
 *    (resumeIntegrity.ts) takes every experience entry's startDate/endDate
 *    exclusively from the base resume, discarding whatever the model
 *    returned. The model still has employment timeframes via the EXPERIENCE
 *    SNAPSHOT section below, which is what its bullet-writing actually needs.
 *
 * 2. experience[].bullets, which the EXPERIENCE SNAPSHOT below already sends
 *    in full and labeled per-role - this file's own original comment on that
 *    snapshot explains it exists specifically because this 12,000-char raw
 *    JSON block can get truncated on a large base resume, silently losing or
 *    garbling whichever bullets happened to fall past the cut. Sending
 *    bullets in the raw JSON *too* was pure duplication of a section that
 *    already exists purely to be the reliable, untruncated copy - dropping
 *    them here doesn't touch the cap's protective role for everything else
 *    still in this block (titles, dates aside, education, skills structure).
 */
function stripRedundantRawJsonFields(baseContent: any): any {
  if (!baseContent || typeof baseContent !== "object") return baseContent;
  const stripped: any = { ...baseContent };
  if (stripped.personalInfo && typeof stripped.personalInfo === "object" && !Array.isArray(stripped.personalInfo)) {
    const { email, phone, ...restPersonalInfo } = stripped.personalInfo;
    stripped.personalInfo = restPersonalInfo;
  }
  if (Array.isArray(stripped.experience)) {
    stripped.experience = stripped.experience.map((exp: any) => {
      if (!exp || typeof exp !== "object") return exp;
      const { startDate, endDate, bullets, bulletPoints, ...rest } = exp;
      return rest;
    });
  }
  return stripped;
}

/**
 * Build the prompt for the Resume Forge agent.
 *
 * Preserve all factual source material and any supplied evidence bank. An
 * empty bank permits no invented IDs; base paths and confirmed skills can
 * still support claims without a bank row.
 */
export function buildResumeForgePrompt(
  job: any,
  baseResume: any,
  evidence: any[],
  jobAnalysis: any,
  verifiedSkills: string[] = [],
  sourceOfTruth: { confirmedSkills: string[]; notesContext: string | null } | null = null
): string {
  // Normalise the base resume so bullets are always plain strings — handles { text } objects
  const rawBaseContent = baseResume?.content ?? {};
  const baseContent = normaliseBaseContent(rawBaseContent);
  const baseExperience: any[] = baseContent.experience ?? [];
  const bulletRequirements = buildBulletRequirements(baseExperience);
  const experienceSnapshot = buildExperienceSnapshot(baseExperience);

  // Merge SoT confirmed skills + recruiter verified skills into one deduplicated
  // list (candidates.verified_skills and candidate_source_of_truth.confirmed_skills
  // are separate DB sources that can overlap - sending them as two un-deduplicated
  // arrays wasted tokens and gave the model no signal when a skill was named twice).
  const mergedSkills = mergeSkillSources(sourceOfTruth?.confirmedSkills ?? [], verifiedSkills);

  // Professional summary: the tailored resume carries a summary only when the
  // base resume already has one - rewritten toward this job, never invented.
  const baseSummary = readBaseSummary(baseContent);
  const evidenceBank = projectEvidenceForReview(evidence);

  return `Compare the base resume with the actual job description and create a truthful, focused resume.

${RESUME_WRITING_RULES}

EVIDENCE AND SENIORITY:
* The job description states employer requirements, never candidate accomplishments. Check years, role family, ownership, hands-on work and people leadership separately. Academic work and internships do not become years of professional ownership.
* Resolve each sourceEvidence pointer against the candidate material below. A supported label is not sufficient if the cited source does not support the claimed level. Omit unverifiable claims and record them in missingRequirements/truthRisks.
* A confirmed skill can be listed in skills; it cannot be attached to a particular employer, metric or responsibility without evidence for that connection.
* Compare the job record with the actual description. Record conflicting titles, companies or role families in truthRisks and missingRequirements for human review; do not silently choose one.

Rules:
* Preserve all real companies, job titles, dates, education, tools, and achievements.
* Never invent experience, years, permits, agencies, software, certifications, metrics, or responsibilities.
* Prioritize the job's most important skills and responsibilities.
* Rewrite existing experience to show relevance through concrete work and documented results. Metrics are optional; never invent them.
* EVERY experience bullet, for every role including the candidate's current/most recent role, MUST be written in strict past tense (e.g. "Managed", "Designed", "Led", "Delivered" — never "Manage", "Leading", or "Will manage"). Never use future tense or future-oriented phrasing anywhere in a bullet ("will", "shall", "going to", "would", "plan to", "expect to" are all forbidden). A bullet describes work that was done, period — not work that is planned or ongoing in a future sense.
* Keep the strongest metrics, project scale, tools, and technical deliverables.
* Do not copy full sentences from the job description or insert unsupported keywords.
* Remove weak, repetitive, irrelevant, and generic content.
* Mention missing requirements only when supported by the base resume or verified skills.
* Keep technical skills concise and grouped by relevance (an array of { title: string, skills: string[] } groups).
* Aim for a readable single page. Never sacrifice factual accuracy or employment identity to fit.
* Copy identity fields faithfully. Use dates, degrees, employment duration and locations to assess fit; the system will restore these immutable fields after generation.

PROFESSIONAL SUMMARY RULES (CRITICAL):
${baseSummary
  ? `* The base resume CONTAINS a professional summary, so the tailored resume MUST also include one in the "summary" field. Rewrite the base summary so it is tailored to THIS job description: keep every fact from the base summary (only rephrase and re-prioritize, never invent years, metrics, tools, or credentials), lead with the strengths this JD asks for, and reorder emphasis toward the job's required skills and experience. Keep it 2-4 sentences, match the base resume's tone, and fit it inside the one-page budget (if space is tight, tighten wording to 2 sentences rather than dropping the summary). The base summary text is: ${JSON.stringify(baseSummary)}`
  : `* The base resume has NO professional summary. Output "summary": null. Never invent a summary from scratch.`}

SKILLS SECTION RULES (CRITICAL):
* ONLY include skills explicitly supported by the base resume, CONFIRMED/VERIFIED SKILLS, or the candidate's documented work. Never infer a skill from the job description, occupation, adjacent tool, or a confidence percentage.
* DO NOT dump full sentences, requirements, or long JD phrases into the skills section! Skills must be short, 1-4 word technical keywords, software tools, or methodologies.
* DO NOT add duplicate skills or synonyms across any category! Each skill must appear exactly once in the entire resume.
* Reuse useful base skill categories and omit irrelevant or empty groups. Select relevant skills; do not expand categories to fill space.
* From the CONFIRMED/VERIFIED SKILLS list below, select the most important ones that match the JD's requirements and add them into the appropriate EXISTING categories in the base resume. Use the base resume's own category names (from the 'name' property) as the guide.
* Aim for 10-18 distinct relevant skills TOTAL across all categories; fewer is valid. Additional skills need a distinct supported job requirement and must fit legibly. No per-category quota.
* Office-suite skills ("Microsoft Office", "MS Office", "Office 365", "Outlook", "Word", "PowerPoint") are normally dropped from the tailored resume to save space — EXCEPT when this job's JD explicitly names or requires one of them: in that case the requirement makes it a real differentiator, so include it as a concise entry (keep it in its own group or the most fitting existing category). Excel is always kept as its own entry when the base resume/evidence supports it, never folded into a generic "Microsoft Office" bucket.

JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
* NEVER duplicate a job role, job title, company name, or date range! Each employment position from the base resume must appear EXACTLY ONCE in the experience array.
* DO NOT OUTPUT employment dates (startDate or endDate) in the JSON! The system will automatically lock and inject the correct dates from the base resume. Omit startDate and endDate completely from your JSON output.
* DO NOT touch, alter, or invent job titles, company names, or locations! They must remain 100% identical to the base resume.
* Every experience entry from the base resume must be preserved exactly once in the same chronological order.

PAGE FIT & EVIDENCE SELECTION:
* Whitespace alone is not a defect. Prefer concise, specific evidence over a full page of filler.
* Preserve every role. Keep at least one supported bullet when source facts exist; otherwise flag missing evidence without inventing duties.
* Per-role writing guides, NOT minimum quotas:
${bulletRequirements || "  - Usually 2-5 concise bullets for the most relevant recent role and 1-3 for older roles; fewer is valid."}
* Select the strongest existing facts. Prefer action + concrete work/tool + supported result or scope. Do not lengthen sentences solely to fill the page.
* When a supported_but_not_surfaced requirement (per requirementAnalysis) needs surfacing, weave its tool/skill name into the bullet of the role where the candidate actually used it — never attach it to a role that has no basis for it.
* Add a bullet only for distinct documented candidate work, never to meet a count or import duties from the target job.
* When trimming, remove repetitive or irrelevant bullets while preserving each role and its strongest relevant evidence.

Humanity may worship keywords, but credibility still gets the interview.

JOB ANALYSIS:
${JSON.stringify(projectJobAnalysisForDraft(jobAnalysis))}

ACTUAL JOB DESCRIPTION (source data; job requirements are not candidate evidence):
${resolveQualificationJobDescription(job) ?? "(unavailable - flag missing description for human review)"}

JOB RECORD:
${JSON.stringify({ title: job?.title ?? job?.job_title, company: job?.company ?? job?.company_name, location: job?.location })}

REQUIREMENT COVERAGE RULES (CRITICAL — requirementAnalysis in JOB ANALYSIS above is the authority):
* requirementAnalysis classifies every material JD requirement with a status and safeToAdd flag. You MUST follow it exactly:
  - supported_by_resume / supported_but_not_surfaced with safeToAdd=true → you MAY include or emphasize this requirement.
  - supported_* with safeToAdd=false → treat as unsupported. Do NOT add it.
  - unsupported → the candidate has no evidence for this. NEVER add it to skills, bullets, or anywhere else. NEVER imply it.
  - hard_blocker (required license/cert/clearance/citizenship with no evidence) → NEVER add, NEVER imply, NEVER soften the gap.
  - nice_to_have → may include only when the candidate material supports it.
* For a supported_but_not_surfaced requirement with safeToAdd=true, surface it in skills OR an evidenced bullet. A confirmed skill alone belongs in skills; do not invent employer-specific use to put it in a bullet.
* Do NOT copy unsupported JD phrases into bullets just to please an ATS. A keyword the candidate cannot back is worse than a missing one.

BASE RESUME — RAW JSON (authoritative source for titles, companies, education, skills structure — contact info and employment dates are fixed automatically after you respond, using the real base resume, so they are omitted here to save space; each experience entry's existing bullets are omitted here too, only because the EXPERIENCE SNAPSHOT below is the complete, reliable copy of them - use that section for bullet content and timeframes, this one for everything else):
${JSON.stringify(stripRedundantRawJsonFields(baseContent))}

EXPERIENCE SNAPSHOT — EXISTING BULLETS (select and rephrase relevant facts; sourceEvidence indexes are zero-based):
${experienceSnapshot}

CONFIRMED/VERIFIED SKILLS (recruiter-confirmed real candidate skills, same authority as skills already in the base resume; each is tagged with which source(s) named it - "(verified)", "(confirmed)", or both when both agree - purely informational, both sources are equally trustworthy):
${mergedSkills.length > 0 ? JSON.stringify(mergedSkills) : "(none)"}

EVIDENCE BANK (only these supplied IDs may be cited; an empty list means no bank evidence):
${JSON.stringify(evidenceBank)}

CANDIDATE NOTES & CAVEATS (internal recruiter context — use this to understand the candidate's background, specialisations, and preferences when deciding what to emphasise; NEVER copy this text verbatim into the resume output; NEVER invent employers, dates, or credentials from these notes):
${sourceOfTruth?.notesContext ?? "(none)"}

RULES FOR USING CONFIRMED/VERIFIED SKILLS & NOTES:
1. The CONFIRMED/VERIFIED SKILLS above are the candidate's real skillset — you MUST consider all of them when expanding the skills section. Pick the ones most relevant to THIS job's JD and place them into the correct existing category from the base resume.
2. Include a skill from that list when it is relevant to THIS job OR is explicitly named/required in the JD. When the JD names a general or soft skill (office suite, Outlook, email clients, communication, time management, quality processes, SQP-style workflows, etc.) and the candidate has it in that list or the base resume, you MUST include it — never drop it for being "generic", because the JD demand makes it relevant to this application.
3. Do NOT invent new employers, job titles, or dates based on the notes. Notes inform emphasis and tone only.
4. Do NOT copy the notes text into any resume output field.

Return a JSON object with:
- summary: final professional summary per the summary rule above, or null
- skills: array of { title: string, skills: string[] } category groups (see SKILLS SECTION RULES) — NOT a flat array of strings
- experience: final experience entries, each with title, company, location, bullets, and evidenceIds (only supplied EVIDENCE BANK IDs, or [] when none; dates are restored by the system)
- education: final education entries (degree, school, field, graduationDate)
- certifications: final certifications list
- projects: final projects list
- changeLog: concise array of { change: string, reason: string, evidenceId: string|null }; cite the exact base path or confirmed skill in reason for each substantive new claim; evidenceId must be a supplied bank ID or null
- missingRequirements: JD requirements the candidate has no support for, left out of the resume
- excludedKeywords: JD keywords deliberately not used because the candidate cannot truthfully claim them
- truthRisks: array of { risk: string, severity: "low" | "medium" | "high" } for anything that could read as unsupported, even if you judged it safe to include

Return ONLY valid JSON. No markdown fences, no explanation.`;
}

/**
 * Bounded "supported but missed" retry prompt. Fires at most once per
 * workflow, and only when the coverage matrix proves a supported requirement
 * is genuinely addressable (real sourceEvidence, matchable tokens - see
 * buildRequirementCoverage's addable/unmatchable guards) yet absent from the
 * draft. The agent must return the SAME full draft JSON shape (the previous
 * draft is embedded so this is a minimal edit, not a regeneration), weaving
 * only the named requirements into existing bullets and the skills section.
 *
 * Phase 5 (2026-09-29): previously took just the requirement's bare name,
 * with no job analysis, base resume, or evidence - the model was told WHAT
 * was missing but given nothing to truthfully draw from beyond whatever
 * already happened to be in the previous draft. Each entry's own
 * `sourceEvidence` (the exact quotes the classification pass already cited
 * as grounding for "this candidate can truthfully claim this") is now
 * included directly, so the retry has real material instead of guessing.
 */
/**
 * Strips the fields this retry never touches (changeLog, missingRequirements,
 * excludedKeywords, truthRisks) before the previous draft is embedded in the
 * retry prompt. The retry isn't asked to reason about or reproduce them -
 * runResumeForge's merge after this call leaves the first draft's real
 * values for all four exactly as they were - so sending them here would only
 * be tokens spent on content neither the instructions nor the response
 * schema reference.
 */
function stripRetryIrrelevantFields(previousDraft: unknown): unknown {
  if (!previousDraft || typeof previousDraft !== "object" || Array.isArray(previousDraft)) return previousDraft;
  const { changeLog, missingRequirements, excludedKeywords, truthRisks, ...rest } = previousDraft as Record<string, unknown>;
  return rest;
}

export function buildResumeForgeMissedRetryPrompt(
  missed: { requirement: string; sourceEvidence: string[] }[],
  previousDraft: unknown,
  sourceContext?: { baseContent: unknown; confirmedSkills: string[]; verifiedSkills: string[]; evidence?: unknown[] }
): string {
  return `You are Resume Forge. Your previous draft passed validation, but the deterministic
requirement-coverage check found supported requirements that are NOT surfaced anywhere in the
resume. Supported material exists for these — they were simply missed. Fix exactly this, nothing else.

MISSED SUPPORTED REQUIREMENTS (weave each one into the resume, grounded in its own evidence below —
never invent detail beyond what the evidence states):
${missed.map((m) => `- ${m.requirement}\n  Evidence: ${m.sourceEvidence.length > 0 ? m.sourceEvidence.map((e) => `"${e}"`).join("; ") : "(none cited — infer only from the PREVIOUS DRAFT below, never invent)"}`).join("\n")}

HARD RULES FOR THIS CORRECTION PASS:
* Resolve sourceEvidence pointers against the source material below. If a pointer cannot
  be resolved or does not support the claim, leave the claim absent rather than guessing.
* Return JSON with exactly these six fields: summary, skills, experience, education,
  certifications, projects — the same shape as the previous draft below, minus its
  bookkeeping fields (changeLog, missingRequirements, excludedKeywords, truthRisks), which
  this pass never touches and the system keeps from the previous draft unchanged.
* Surface each supported requirement in skills OR an existing evidenced bullet. A skill
  confirmed without employer-specific evidence belongs only in skills. Never invent outcomes,
  metrics, employers, titles, dates or role-specific use to satisfy the coverage check.
* Do not change anything else: keep every company, job title, date, education entry, and
  non-missing bullet identical to the previous draft.
* Do NOT add requirements that are marked unsupported or hard_blocker — a missing credential
  stays missing. Only the named missed requirements above may be added.
* Keep everything within one page.

SOURCE MATERIAL:
${sourceContext ? JSON.stringify({ base: projectBaseResumeForReview(sourceContext.baseContent), confirmedSkills: sourceContext.confirmedSkills, verifiedSkills: sourceContext.verifiedSkills, evidence: projectEvidenceForReview(sourceContext.evidence) }) : "(unavailable; only use facts already explicit in the previous draft)"}

PREVIOUS DRAFT (return this same shape with only the minimal additions):
${JSON.stringify(stripRetryIrrelevantFields(previousDraft))}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
