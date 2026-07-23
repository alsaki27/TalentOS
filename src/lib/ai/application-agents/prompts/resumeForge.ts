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

/** Merge new skills into the base skill categories while preserving existing ones. */
function mergeSkills(baseCategories: any[], newSkills: string[]): any[] {
  const categories = baseCategories.map(c => ({ title: c.title, skills: new Set(c.skills) }));
  newSkills.forEach(skill => {
    const catTitle = mapSkillToCategory(skill);
    let cat = categories.find(c => c.title === catTitle);
    if (!cat) {
      cat = { title: catTitle, skills: new Set() };
      categories.push(cat);
    }
    cat.skills.add(skill);
  });
  return categories.map(c => ({ title: c.title, skills: Array.from(c.skills) }));
}

/** Score how many JD keywords appear in a bullet. */
function scoreBullet(bullet: string, keywords: Set<string>): number {
  let score = 0;
  keywords.forEach(kw => {
    if (bullet.toLowerCase().includes(kw.toLowerCase())) score++;
  });
  return score;
}

/** Augment experience bullets with new skills, respecting a maximum of 6 bullets per role. */
function augmentExperience(experiences: any[], newSkills: string[], jobAnalysis: any): any[] {
  const jdKeywords = new Set([...(jobAnalysis.requiredSkills ?? []), ...(jobAnalysis.preferredSkills ?? [])]);
  const verbPool = ["Designed", "Implemented", "Managed", "Optimized", "Developed"];
  const updated = experiences.map(exp => {
    const originalBullets = exp.bullets || exp.bulletPoints || [];
    return { ...exp, bullets: [...originalBullets], bulletPoints: undefined };
  });

  newSkills.forEach(skill => {
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
    const newBullet = `${verbPool[Math.floor(Math.random() * verbPool.length)]} ${skill} to meet job requirements.`;
    if (target.bullets.length < 6) {
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
  verifiedSkills: string[] = []
): string {
  // Collect all skills the JD emphasizes (required + preferred).
  const addedSkills = [
    ...(jobAnalysis.requiredSkills ?? []),
    ...(jobAnalysis.preferredSkills ?? []),
  ];

  // Produce a version of the base resume that already includes the new skills.
  const transformed = transformResume(baseResume?.content ?? {}, jobAnalysis, addedSkills);

  return `You are Resume Forge. Your job is simple: take the candidate's BASE RESUME below and
rephrase/reorder it so it reads as a strong, ATS-friendly match for THIS job — without inventing
anything. This is a light tailoring pass, not a rewrite from scratch. If you are ever unsure
whether to include something, keep it and reword it rather than dropping it or leaving a section
empty. Returning a near-empty resume is always the wrong answer — the base resume already has
real content; your job is to reuse and reword almost all of it, not replace it with less.

GROUND RULES:
1. Do not invent employers, job titles, dates, locations, degrees, certifications, licenses, or
   metrics/numbers that aren't already in the base resume or evidence bank. Everything else about
   the candidate's real history (skills, responsibilities, tools, wording) can be freely
   rephrased, reordered, condensed, or expanded to better match the job description — this is
   expected and encouraged, not something that needs a separate evidence citation.
2. If a JD keyword or skill matches something the candidate already has in their base resume,
   evidence bank, or VERIFIED SKILLS, weave the JD's exact phrasing into the relevant bullet or
   the skills list. If it doesn't match anything about the candidate, just leave it out — don't
   stress about it, don't list it as a big miss, just skip it.
3. Keep every experience role from the base resume. Keep roughly the same number of bullets per
   role as the base resume (rewrite them, don't delete them). Do not collapse a role down to one
   or two bullets and do not return an empty experience array.
4. Never generate, add, or keep a professional summary. Always return summary as null.
5. The skills output MUST use the same categorized‑group structure as the base resume's skills
   section (an array of { title, skills[] } groups, e.g. "GIS Platforms & Mapping" with its own
   skills list, "Field Data & QA/QC" with its own, etc.) — never collapse everything into one
   flat list or one generic "Skills" bucket. Reuse the base resume's existing category titles
   whenever the skills still fit them; only rename/add/split a category if the job genuinely
   calls for regrouping. Within each category, reorder/refresh which skills are listed/emphasized
   for this job, but keep the category structure intact.
6. Skill‑to‑Category Mapping: Use the SKILL_CATEGORY_MAP defined above to assign any new required or
   preferred skill to its proper category. If a skill is not present in the map, create a new
   category titled "Additional Skills" and place the skill there.
7. Bullet Replacement Threshold: If an experience already has 6 bullets, drop the bullet that
   matches the fewest JD keywords before inserting a new bullet that incorporates the new skill.

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

BASE RESUME:
${JSON.stringify(transformed).slice(0, 12000)}

EVIDENCE BANK:
${JSON.stringify(evidence).slice(0, 8000)}

VERIFIED SKILLS (recruiter‑confirmed, safe to use without an evidenceId):
${verifiedSkills.length > 0 ? JSON.stringify(verifiedSkills) : "(none recorded)"}

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
