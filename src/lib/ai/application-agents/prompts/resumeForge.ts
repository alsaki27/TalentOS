// Resume Forge prompt builder
// Skills come exclusively from the candidate's Source of Truth (confirmed_skills from DB)
// and the job analysis. No hardcoded category maps. The AI decides where skills belong.

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

  // Collect all SoT confirmed skills + recruiter verified skills into one deduplicated list
  const sotSkills = sourceOfTruth?.confirmedSkills ?? [];

  return `Compare the base resume with the job description and create a truthful, ATS-friendly, one-page tailored resume.

Rules:
* Preserve all real companies, job titles, dates, education, tools, and achievements.
* Never invent experience, years, permits, agencies, software, certifications, metrics, or responsibilities.
* Prioritize the job's most important skills and responsibilities.
* Rewrite existing experience to show direct relevance using strong action verbs and measurable results.
* Keep the strongest metrics, project scale, tools, and technical deliverables.
* Do not copy full sentences from the job description or insert unsupported keywords.
* Remove weak, repetitive, irrelevant, and generic content.
* Mention missing requirements only when supported by the base resume or verified skills.
* Keep technical skills concise and grouped by relevance (an array of { title, skills[] } groups, never a flat list).
* Keep everything readable and within one page strictly at any cost.
* Verify date consistency, degree accuracy, experience duration, location, and formatting before finalizing.
* Never generate a professional summary (always return summary as null).
* Output only the final resume in valid JSON format, not explanations.

SKILLS SECTION RULES (CRITICAL):
* DO NOT add hardcoded or generic skills. ONLY use skills that come from: (a) the base resume, (b) Source of Truth confirmed skills listed below, (c) skills the candidate clearly demonstrates through their experience bullets, or (d) skills that can be inferred with ≥90% confidence from the job description + candidate background combined (e.g., if the candidate has used a tool in multiple roles and the JD lists it, include it).
* DO NOT dump full sentences, requirements, or long JD phrases into the skills section! Skills must be short, 1-4 word technical keywords, software tools, or methodologies.
* DO NOT add duplicate skills or synonyms across any category! Each skill must appear exactly once in the entire resume.
* Start from the base resume's EXISTING skill categories — expand each one using Source of Truth skills and high-confidence inferred skills that are relevant to this job. Do NOT create arbitrary new categories.
* From the Source of Truth confirmed skills list below, select the most important ones that match the JD's requirements and add them into the appropriate EXISTING categories in the base resume. Use the base resume's own category titles as the guide.
* Target 8-15 distinct, high-priority skills per category. Never artificially cap or truncate. A resume with only 2-3 skills per category is incomplete.
* Do NOT add a skill if it has less than 90% confidence of matching this candidate's actual background.

JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
* NEVER duplicate a job role, job title, company name, or date range! Each employment position from the base resume must appear EXACTLY ONCE in the experience array.
* DO NOT touch, alter, or invent job titles, company names, locations, or employment dates! They must remain 100% identical to the base resume (e.g., if a role is 'Jan 2022 - Present', keep it exactly as-is). Future-looking or unconventional dates come from the candidate's real data — preserve them exactly.
* Every experience entry from the base resume must be preserved exactly once in the same chronological order.

PAGE FULLNESS & EXPERIENCE BULLET COUNT RULES (CRITICAL — DO NOT LEAVE EMPTY WHITESPACE):
* The tailored resume MUST fill the entire single page top to bottom — no large empty whitespace at the bottom.
* YOU MUST WRITE BULLETS FOR EVERY EXPERIENCE ROLE. An experience entry without bullets is a broken resume. Never output a role with an empty bullets array.
* EXACT REQUIRED BULLET COUNTS PER ROLE (non-negotiable):
${bulletRequirements || "  - Most recent role: minimum 6 bullets, maximum 7 bullets\n  - Second role: minimum 4 bullets, maximum 6 bullets\n  - Older roles: minimum 3 bullets, maximum 4 bullets"}
* Strategy: Take each EXISTING BULLET from the EXPERIENCE SNAPSHOT below, keep its facts intact, then EXPAND the sentence to be longer (2-3 lines) by adding more detail about tools used, project scale, impact metrics, or methodology. Do NOT invent new facts — expand the existing sentences using information that is already in the base resume, evidence bank, and job analysis.
* If a role has fewer existing bullets than the required minimum: write additional bullets from the evidence bank and job analysis.
* NEVER return a role with fewer bullets than its required minimum above.
* When trimming for page length: shorten individual bullet sentences. NEVER delete entire bullets.

Humanity may worship keywords, but credibility still gets the interview.

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

BASE RESUME — RAW JSON (authoritative source for dates, titles, companies, education, skills structure):
${JSON.stringify(baseContent).slice(0, 12000)}

EXPERIENCE SNAPSHOT — EXISTING BULLETS (use these as the starting point for each role's bullet points; rewrite and expand them to match the job, do NOT ignore or discard them):
${experienceSnapshot}

EVIDENCE BANK:
${JSON.stringify(evidence).slice(0, 8000)}

SOURCE OF TRUTH — CONFIRMED SKILLS (these are skills the recruiter has personally verified this candidate has, extracted from their base resumes and accepted suggestions; treat them with the same authority as skills already in the base resume):
${JSON.stringify(sotSkills)}

VERIFIED SKILLS (additional recruiter-confirmed competencies):
${verifiedSkills.length > 0 ? JSON.stringify(verifiedSkills) : "(none)"}

CANDIDATE NOTES & CAVEATS (internal recruiter context — use this to understand the candidate's background, specialisations, and preferences when deciding what to emphasise; NEVER copy this text verbatim into the resume output; NEVER invent employers, dates, or credentials from these notes):
${sourceOfTruth?.notesContext ?? "(none)"}

RULES FOR USING SOURCE OF TRUTH & NOTES:
1. Source of Truth confirmed skills are the candidate's real verified skillset — you MUST consider all of them when expanding the skills section. Pick the ones most relevant to THIS job's JD and place them into the correct existing category from the base resume.
2. Do NOT include a confirmed skill just because it exists in SoT — only include it if it is relevant to this specific job and fits naturally.
3. Do NOT invent new employers, job titles, or dates based on the notes. Notes inform emphasis and tone only.
4. Do NOT copy the notes text into any resume output field.

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
