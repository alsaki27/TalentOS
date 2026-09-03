// Resume Forge prompt builder
// Skills come exclusively from the candidate's Source of Truth (confirmed_skills from DB)
// and the job analysis. No hardcoded category maps. The AI decides where skills belong.

import { readBaseSummary } from "../resumeIntegrity";
import { mergeSkillSources } from "./mergeSkillSources";

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

/** Build per-role minimum bullet requirements as a prompt string, using actual base resume experience data. */
function buildBulletRequirements(experiences: any[]): string {
  if (!experiences || experiences.length === 0) return "";
  const lines = experiences.map((exp, idx) => {
    const roleLabel = exp.title
      ? `"${exp.title}" at ${exp.company ?? ""}`
      : `Role ${idx + 1}`;
    const min = idx === 0 ? 6 : idx === 1 ? 4 : 3;
    const max = idx === 0 ? 7 : 6;
    return `  - ${roleLabel}: minimum ${min} bullets, maximum ${max} bullets`;
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
      : "   (no bullets stored — you MUST write them from scratch using the evidence bank and job analysis)";
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

/** Build the prompt for the Resume Forge agent. */
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

  return `Compare the base resume with the job description and create a truthful, ATS-friendly, one-page tailored resume.

Rules:
* Preserve all real companies, job titles, dates, education, tools, and achievements.
* Never invent experience, years, permits, agencies, software, certifications, metrics, or responsibilities.
* Prioritize the job's most important skills and responsibilities.
* Rewrite existing experience to show direct relevance using strong action verbs and measurable results.
* EVERY experience bullet, for every role including the candidate's current/most recent role, MUST be written in strict past tense (e.g. "Managed", "Designed", "Led", "Delivered" — never "Manage", "Leading", or "Will manage"). Never use future tense or future-oriented phrasing anywhere in a bullet ("will", "shall", "going to", "would", "plan to", "expect to" are all forbidden). A bullet describes work that was done, period — not work that is planned or ongoing in a future sense.
* Keep the strongest metrics, project scale, tools, and technical deliverables.
* Do not copy full sentences from the job description or insert unsupported keywords.
* Remove weak, repetitive, irrelevant, and generic content.
* Mention missing requirements only when supported by the base resume or verified skills.
* Keep technical skills concise and grouped by relevance (an array of { name: string, skills: string[] } groups, never a flat list).
* Keep everything readable and within one page strictly at any cost.
* Verify date consistency, degree accuracy, experience duration, location, and formatting before finalizing.

PROFESSIONAL SUMMARY RULES (CRITICAL):
${baseSummary
  ? `* The base resume CONTAINS a professional summary, so the tailored resume MUST also include one in the "summary" field. Rewrite the base summary so it is tailored to THIS job description: keep every fact from the base summary (only rephrase and re-prioritize, never invent years, metrics, tools, or credentials), lead with the strengths this JD asks for, and reorder emphasis toward the job's required skills and experience. Keep it 2-4 sentences, match the base resume's tone, and fit it inside the one-page budget (if space is tight, tighten wording to 2 sentences rather than dropping the summary). The base summary text is: ${JSON.stringify(baseSummary)}`
  : `* The base resume has NO professional summary. Output "summary": null. Never invent a summary from scratch.`}

SKILLS SECTION RULES (CRITICAL):
* DO NOT add hardcoded or generic skills. ONLY use skills that come from: (a) the base resume, (b) the CONFIRMED/VERIFIED SKILLS listed below, (c) skills the candidate clearly demonstrates through their experience bullets, or (d) skills that can be inferred with ≥90% confidence from the job description + candidate background combined (e.g., if the candidate has used a tool in multiple roles and the JD lists it, include it).
* DO NOT dump full sentences, requirements, or long JD phrases into the skills section! Skills must be short, 1-4 word technical keywords, software tools, or methodologies.
* DO NOT add duplicate skills or synonyms across any category! Each skill must appear exactly once in the entire resume.
* Start from the base resume's EXISTING skill categories — expand each one using the CONFIRMED/VERIFIED SKILLS and high-confidence inferred skills that are relevant to this job. Do NOT create arbitrary new categories (a single concise "General" group is permitted ONLY when the JD explicitly demands general skills that don't fit any existing category).
* From the CONFIRMED/VERIFIED SKILLS list below, select the most important ones that match the JD's requirements and add them into the appropriate EXISTING categories in the base resume. Use the base resume's own category names (from the 'name' property) as the guide.
* Target 8-15 distinct, high-priority skills per category. Never artificially cap or truncate. A resume with only 2-3 skills per category is incomplete.
* Do NOT add a skill if it has less than 90% confidence of matching this candidate's actual background.
* Office-suite skills ("Microsoft Office", "MS Office", "Office 365", "Outlook", "Word", "PowerPoint") are normally dropped from the tailored resume to save space — EXCEPT when this job's JD explicitly names or requires one of them: in that case the requirement makes it a real differentiator, so include it as a concise entry (keep it in its own group or the most fitting existing category). Excel is always kept as its own entry when the base resume/evidence supports it, never folded into a generic "Microsoft Office" bucket.

JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
* NEVER duplicate a job role, job title, company name, or date range! Each employment position from the base resume must appear EXACTLY ONCE in the experience array.
* DO NOT OUTPUT employment dates (startDate or endDate) in the JSON! The system will automatically lock and inject the correct dates from the base resume. Omit startDate and endDate completely from your JSON output.
* DO NOT touch, alter, or invent job titles, company names, or locations! They must remain 100% identical to the base resume.
* Every experience entry from the base resume must be preserved exactly once in the same chronological order.

PAGE FULLNESS & EXPERIENCE BULLET COUNT RULES (CRITICAL — DO NOT LEAVE EMPTY WHITESPACE):
* The tailored resume MUST fill the entire single page top to bottom — no large empty whitespace at the bottom.
* YOU MUST WRITE BULLETS FOR EVERY EXPERIENCE ROLE. An experience entry without bullets is a broken resume. Never output a role with an empty bullets array.
* EXACT REQUIRED BULLET COUNTS PER ROLE (non-negotiable):
${bulletRequirements || "  - Most recent role: minimum 6 bullets, maximum 7 bullets\n  - Second role: minimum 4 bullets, maximum 6 bullets\n  - Older roles: minimum 3 bullets, maximum 4 bullets"}
* Strategy: Take each EXISTING BULLET from the EXPERIENCE SNAPSHOT below, keep its facts intact, then EXPAND the sentence to be longer (2-3 lines) by adding more detail about tools used, project scale, impact metrics, or methodology. Do NOT invent new facts — expand the existing sentences using information that is already in the base resume, evidence bank, and job analysis.
* When a supported_but_not_surfaced requirement (per requirementAnalysis) needs surfacing, weave its tool/skill name into the bullet of the role where the candidate actually used it — never attach it to a role that has no basis for it.
* If a role has fewer existing bullets than the required minimum: write additional bullets from the evidence bank and job analysis.
* NEVER return a role with fewer bullets than its required minimum above.
* When trimming for page length: shorten individual bullet sentences. NEVER delete entire bullets.

Humanity may worship keywords, but credibility still gets the interview.

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

REQUIREMENT COVERAGE RULES (CRITICAL — requirementAnalysis in JOB ANALYSIS above is the authority):
* requirementAnalysis classifies every material JD requirement with a status and safeToAdd flag. You MUST follow it exactly:
  - supported_by_resume / supported_but_not_surfaced with safeToAdd=true → you MAY include or emphasize this requirement.
  - supported_* with safeToAdd=false → treat as unsupported. Do NOT add it.
  - unsupported → the candidate has no evidence for this. NEVER add it to skills, bullets, or anywhere else. NEVER imply it.
  - hard_blocker (required license/cert/clearance/citizenship with no evidence) → NEVER add, NEVER imply, NEVER soften the gap.
  - nice_to_have → may include only when the candidate material supports it.
* For every supported_but_not_surfaced requirement with safeToAdd=true: you MUST surface it BOTH in the skills section AND woven naturally into an existing experience bullet of the most relevant role. Rewrite that bullet to mention the tool/skill WITHOUT inventing outcomes, metrics, employers, or dates — only extend facts already present in the base resume, evidence bank, or Source of Truth.
* Do NOT copy unsupported JD phrases into bullets just to please an ATS. A keyword the candidate cannot back is worse than a missing one.

BASE RESUME — RAW JSON (authoritative source for titles, companies, education, skills structure — contact info and employment dates are fixed automatically after you respond, using the real base resume, so they are omitted here to save space; each experience entry's existing bullets are omitted here too, only because the EXPERIENCE SNAPSHOT below is the complete, reliable copy of them - use that section for bullet content and timeframes, this one for everything else):
${JSON.stringify(stripRedundantRawJsonFields(baseContent)).slice(0, 12000)}

EXPERIENCE SNAPSHOT — EXISTING BULLETS (use these as the starting point for each role's bullet points; rewrite and expand them to match the job, do NOT ignore or discard them):
${experienceSnapshot}

EVIDENCE BANK:
${JSON.stringify(evidence).slice(0, 8000)}

CONFIRMED/VERIFIED SKILLS (recruiter-confirmed real candidate skills, same authority as skills already in the base resume; each is tagged with which source(s) named it - "(verified)", "(confirmed)", or both when both agree - purely informational, both sources are equally trustworthy):
${mergedSkills.length > 0 ? JSON.stringify(mergedSkills) : "(none)"}

CANDIDATE NOTES & CAVEATS (internal recruiter context — use this to understand the candidate's background, specialisations, and preferences when deciding what to emphasise; NEVER copy this text verbatim into the resume output; NEVER invent employers, dates, or credentials from these notes):
${sourceOfTruth?.notesContext ?? "(none)"}

RULES FOR USING CONFIRMED/VERIFIED SKILLS & NOTES:
1. The CONFIRMED/VERIFIED SKILLS above are the candidate's real skillset — you MUST consider all of them when expanding the skills section. Pick the ones most relevant to THIS job's JD and place them into the correct existing category from the base resume.
2. Include a skill from that list when it is relevant to THIS job OR is explicitly named/required in the JD. When the JD names a general or soft skill (office suite, Outlook, email clients, communication, time management, quality processes, SQP-style workflows, etc.) and the candidate has it in that list or the base resume, you MUST include it — never drop it for being "generic", because the JD demand makes it relevant to this application.
3. Do NOT invent new employers, job titles, or dates based on the notes. Notes inform emphasis and tone only.
4. Do NOT copy the notes text into any resume output field.

EVIDENCE-ID CITATION RULES (CRITICAL):
* Every entry in the EVIDENCE BANK above has a real "id" field. Whenever a bullet, change, or
  claim in your output is grounded in a specific evidence-bank entry, cite that entry's exact
  "id" string — never invent one, never paraphrase it, never cite a base-resume fact that has
  no evidence-bank entry.
* For each experience entry's "evidenceIds": list the id(s) of every evidence-bank entry that
  materially supports that role's bullets (metrics, tools, scope). Leave it as an empty array
  when no evidence-bank entry applies to that role — an empty array is correct and expected far
  more often than a populated one; never cite an id just to fill the field.
* For each "changeLog" entry: set "evidenceId" to the id of the evidence-bank entry that
  justifies that specific change, or null when the change is a rewrite/reprioritization of
  existing base-resume content with no separate evidence-bank backing.
* A dangling or fabricated id (one that does not exactly match an "id" in the EVIDENCE BANK
  above) is worse than no citation — the system checks every id you cite and strips ones that
  don't match, so a wrong id provides no benefit and only wastes your output.

Return a JSON object with:
- summary: final professional summary per the summary rule above, or null
- skills: array of { title: string, skills: string[] } category groups (see SKILLS SECTION RULES) — NOT a flat array of strings
- experience: final experience entries, each with title, company, location, startDate, endDate, bullets, and evidenceIds (see EVIDENCE-ID CITATION RULES above)
- education: final education entries (degree, school, field, graduationDate)
- certifications: final certifications list
- projects: final projects list
- changeLog: array of { change: string, reason: string, evidenceId: string | null } describing every meaningful edit you made and why (see EVIDENCE-ID CITATION RULES above)
- missingRequirements: JD requirements the candidate has no support for, left out of the resume
- excludedKeywords: JD keywords deliberately not used because the candidate cannot truthfully claim them
- truthRisks: array of { risk: string, severity: "low" | "medium" | "high" } for anything that could read as unsupported, even if you judged it safe to include

Return ONLY valid JSON. No markdown fences, no explanation.`;
}

/**
 * Bounded "supported but missed" retry prompt. Fires at most once per
 * workflow, and only when the coverage matrix proves a supported requirement
 * is absent from the draft. The agent must return the SAME full draft JSON
 * shape (the previous draft is embedded so this is a minimal edit, not a
 * regeneration), weaving only the named requirements into existing bullets
 * and the skills section.
 */
export function buildResumeForgeMissedRetryPrompt(
  missedRequirements: string[],
  previousDraft: unknown
): string {
  return `You are Resume Forge. Your previous draft passed validation, but the deterministic
requirement-coverage check found supported requirements that are NOT surfaced anywhere in the
resume. Supported material exists for these — they were simply missed. Fix exactly this, nothing else.

MISSED SUPPORTED REQUIREMENTS (weave each one into the resume):
${missedRequirements.map((name) => `- ${name}`).join("\n")}

HARD RULES FOR THIS CORRECTION PASS:
* Return the COMPLETE resume JSON again, with the same overall shape as the previous draft.
* Add each missed requirement BOTH to the most relevant existing skills category AND woven
  naturally into an existing experience bullet of the role where the candidate actually used
  it. Extend the bullet's existing facts — NEVER invent outcomes, metrics, employers, titles,
  or dates.
* Do not change anything else: keep every company, job title, date, education entry, and
  non-missing bullet identical to the previous draft.
* Do NOT add requirements that are marked unsupported or hard_blocker — a missing credential
  stays missing. Only the named missed requirements above may be added.
* Keep everything within one page.

PREVIOUS DRAFT (return this exact shape with only the minimal additions):
${JSON.stringify(previousDraft)}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
