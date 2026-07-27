// Resume Forge prompt builder

// Configurable mapping from skill name to the category it belongs to in the resume.
// Add additional entries as needed.
const SKILL_CATEGORY_MAP: Record<string, string> = {
  "Civil 3D": "Design / CAD",
  // Example: "AutoCAD": "Design / CAD",
};

/** Map a skill to its category using SKILL_CATEGORY_MAP. */
function mapSkillToCategory(skill: string): string {
  return SKILL_CATEGORY_MAP[skill] ?? "Additional Skills";
}

function isCleanSkill(skill: string, existingSkills: Set<string>): boolean {
  if (!skill || typeof skill !== 'string') return false;
  const trimmed = skill.trim();
  // Ignore full sentences or requirements (> 40 chars or > 5 words)
  if (trimmed.length > 40 || trimmed.split(/\s+/).length > 5) return false;
  // Ignore duplicates (case-insensitive check against existing skills)
  const lower = trimmed.toLowerCase();
  for (const existing of existingSkills) {
    if (existing.toLowerCase() === lower || existing.toLowerCase().includes(lower) || lower.includes(existing.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/** Merge new skills into the base skill categories while preserving existing ones without bloat or duplicates. */
function mergeSkills(baseCategories: any[], newSkills: string[]): any[] {
  const allExisting = new Set<string>();
  const categories = baseCategories.map(c => {
    const skillsSet = new Set<string>(c.skills || []);
    skillsSet.forEach(s => allExisting.add(s));
    return { title: c.title, skills: skillsSet };
  });

  newSkills.forEach(skill => {
    if (!isCleanSkill(skill, allExisting)) return;
    const catTitle = mapSkillToCategory(skill);
    let cat = categories.find(c => c.title === catTitle);
    if (!cat) {
      cat = { title: catTitle, skills: new Set() };
      categories.push(cat);
    }
    if (cat.skills.size < 15) {
      cat.skills.add(skill.trim());
      allExisting.add(skill.trim());
    }
  });

  return categories.map(c => ({ title: c.title, skills: Array.from(c.skills) }));
}

function scoreBullet(bullet: any, keywords: Set<string>): number {
  let score = 0;
  const bStr = typeof bullet === 'string' ? bullet : (bullet && bullet.text ? String(bullet.text) : "");
  if (!bStr) return 0;
  keywords.forEach(kw => {
    if (bStr.toLowerCase().includes(kw.toLowerCase())) score++;
  });
  return score;
}

/** Augment experience bullets with new skills, respecting a maximum of 6 bullets per role. */
function augmentExperience(experiences: any[], newSkills: string[], jobAnalysis: any): any[] {
  const jdKeywords = new Set([...(jobAnalysis.requiredSkills ?? []), ...(jobAnalysis.preferredSkills ?? [])]);
  const verbPool = ["Designed", "Implemented", "Managed", "Optimized", "Developed"];
  const updated = experiences.map(exp => {
    const originalBullets = exp.bullets || exp.bulletPoints || [];
    // Normalize to strings just in case they are { text: string } objects
    const stringBullets = originalBullets.map((b: any) => typeof b === 'string' ? b : (b?.text ? String(b.text) : ""));
    return { ...exp, bullets: stringBullets, bulletPoints: undefined };
  });

  const cleanSkills = newSkills.filter(skill => {
    if (!skill || typeof skill !== 'string') return false;
    const trimmed = skill.trim();
    if (trimmed.length > 40 || trimmed.split(/\s+/).length > 5) return false;
    return true;
  });

  cleanSkills.forEach(skill => {
    // Choose the experience that already scores highest against JD keywords.
    let bestIdx = 0;
    let bestScore = -1;
    updated.forEach((exp, idx) => {
      const total = exp.bullets.reduce((sum: number, b: string) => sum + scoreBullet(b, jdKeywords), 0);
      if (total > bestScore) {
        bestScore = total;
        bestIdx = idx;
      }
    });
    const target = updated[bestIdx];
    const newBullet = `${verbPool[Math.floor(Math.random() * verbPool.length)]} ${skill} in alignment with project scope and technical deliverables.`;
    if (target.bullets.length < 7) {
      target.bullets.push(newBullet);
    } else {
      // Replace the bullet with the lowest JD‑keyword match count.
      let lowestIdx = 0;
      let lowestScore = Infinity;
      target.bullets.forEach((b: string, i: number) => {
        const s = scoreBullet(b, jdKeywords);
        if (s < lowestScore) {
          lowestScore = s;
          lowestIdx = i;
        }
      });
      target.bullets[lowestIdx] = newBullet;
    }
  });

  return updated;
}

/** Transform the base resume by merging new skills and adjusting experience bullets. */
function transformResume(base: any, jobAnalysis: any, addedSkills: string[]): any {
  const mergedSkills = mergeSkills(base.skills ?? [], addedSkills);
  const updatedExperience = augmentExperience(base.experience ?? [], addedSkills, jobAnalysis);
  return {
    ...base,
    skills: mergedSkills,
    experience: updatedExperience,
  };
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
  // Collect all skills the JD emphasizes (required + preferred) plus recruiter verified & SoT skills.
  const addedSkills = [
    ...(jobAnalysis.requiredSkills ?? []),
    ...(jobAnalysis.preferredSkills ?? []),
    ...(verifiedSkills ?? []),
    ...(sourceOfTruth?.confirmedSkills ?? []),
  ];

  // Produce a version of the base resume that already includes the new skills.
  const transformed = transformResume(baseResume?.content ?? {}, jobAnalysis, addedSkills);

  return `Compare the base resume with the job description and create a truthful, ATS-friendly, one-page tailored resume.

Rules:
* Preserve all real companies, job titles, dates, education, tools, and achievements.
* Never invent experience, years, permits, agencies, software, certifications, metrics, or responsibilities.
* Prioritize the job's most important skills and responsibilities.
* Rewrite existing experience to show direct relevance using strong action verbs and measurable results.
* Keep the strongest metrics, project scale, tools, and technical deliverables.
* Do not copy full sentences from the job description or insert unsupported keywords.
* Remove weak, repetitive, irrelevant, and generic content.
* Mention missing requirements only when supported by the base resume.
* Keep technical skills concise and grouped by relevance (an array of { title, skills[] } groups, never a flat list).
* Keep everything readable and within one page strictly at any cost.
* Verify date consistency, degree accuracy, experience duration, location, and formatting before finalizing.
* Never generate a professional summary (always return summary as null).
* Output only the final resume in valid JSON format, not explanations.

SKILLS SECTION RULES (CRITICAL):
* DO NOT dump full sentences, requirements, or long JD phrases into the skills section! Skills must be short, 1-4 word technical keywords, software tools, or methodologies (e.g., 'AutoCAD', 'Route Optimization', 'ROW Coordination').
* DO NOT add duplicate skills or synonyms across any category! Each skill must appear exactly once in the entire resume.
* Expand each relevant skill category to include all important, high-impact technical keywords and tools from the base resume, Source of Truth, and JD match (approx. 8 to 15 distinct, high-priority skills per category). Do not artificially truncate skills.
* Prioritize the most important technical skills required by the JD without adding bloat or generic buzzwords.

JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
* NEVER duplicate a job role, job title, company name, or date range! Each employment position from the base resume must appear EXACTLY ONCE in the experience array. No same job title or company should appear 2 times strictly.
* DO NOT touch, alter, or invent job titles, company names, locations, or employment dates! They must remain 100% identical to the base resume (e.g., if a role is 'Jan 2022 - Present', never change it to 'Jan 2022 - Jan 2022').
* Every experience entry from the base resume must be preserved exactly once in the same chronological order.

PAGE FULLNESS & EXPERIENCE BULLET COUNT RULES (CRITICAL - DO NOT LEAVE EMPTY WHITESPACE BELOW):
* The tailored resume MUST look visually full, comprehensive, and balanced, completely filling out the single page from top to bottom without leaving large empty whitespace at the bottom (which happens when roles are condensed too much).
* To prevent empty whitespace below, generate rich, substantive, multi-line bullet points (2 to 3 lines per bullet where appropriate) for every role:
  - For the primary / most recent role: Use 6 to 7 detailed, high-impact bullets.
  - For secondary / earlier roles: Use 4 to 6 detailed bullets.
  - For older roles: Use 3 to 4 detailed bullets.
* NEVER remove all bullet points from any experience role! NEVER leave any role with fewer than 3 bullets! Every role from the base resume must be preserved with rich technical detail so the page remains full and comprehensive.
* Keep the content substantive, project-focused, and detailed to maintain a professional, full one-page presentation.

Humanity may worship keywords, but credibility still gets the interview.

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

BASE RESUME:
${JSON.stringify(transformed).slice(0, 12000)}

EVIDENCE BANK:
${JSON.stringify(evidence).slice(0, 8000)}

VERIFIED SKILLS (recruiter-confirmed, safe to use without an evidenceId):
${verifiedSkills.length > 0 ? JSON.stringify(verifiedSkills) : "(none recorded)"}

SOURCE OF TRUTH SKILLS (skills the recruiter has personally confirmed this candidate is eligible to claim — treat these as equal to skills already in the base resume):
${JSON.stringify(sourceOfTruth?.confirmedSkills ?? [])}

CANDIDATE NOTES (internal context only — use to better understand the candidate's background and preferences; NEVER copy this text verbatim into the resume output):
${sourceOfTruth?.notesContext ?? "(none)"}

RULE FOR SOURCE OF TRUTH: You MAY weave SoT skills into experience bullets and the skills section ONLY if they are genuinely relevant to THIS job's JD. Do NOT include all of them — pick only what the JD calls for. Do NOT invent employers, titles, or dates to support them. Dates, locations, and employers come from the base resume only.

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
