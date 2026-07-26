// Resume Forge prompt builder

// Configurable mapping from skill name to the category it belongs to in the resume.
// Add additional entries as needed.
const SKILL_CATEGORY_MAP: Record<string, string> = {
  "Civil 3D": "Design / CAD",
  // Example: "AutoCAD": "Design / CAD",
};

/*
 * Legacy pre-transform helpers (retained for reference / non-AI fallback mode):
 *
function mapSkillToCategory(skill: string): string {
  return SKILL_CATEGORY_MAP[skill] ?? "Additional Skills";
}

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

function scoreBullet(bullet: any, keywords: Set<string>): number {
  let score = 0;
  const bStr = typeof bullet === 'string' ? bullet : (bullet && bullet.text ? String(bullet.text) : "");
  if (!bStr) return 0;
  keywords.forEach(kw => {
    if (bStr.toLowerCase().includes(kw.toLowerCase())) score++;
  });
  return score;
}

function augmentExperience(experiences: any[], newSkills: string[], jobAnalysis: any): any[] {
  const jdKeywords = new Set([...(jobAnalysis.requiredSkills ?? []), ...(jobAnalysis.preferredSkills ?? [])]);
  const verbPool = ["Designed", "Implemented", "Managed", "Optimized", "Developed"];
  const updated = experiences.map(exp => {
    const originalBullets = exp.bullets || exp.bulletPoints || [];
    const stringBullets = originalBullets.map((b: any) => typeof b === 'string' ? b : (b?.text ? String(b.text) : ""));
    return { ...exp, bullets: stringBullets, bulletPoints: undefined };
  });

  newSkills.forEach(skill => {
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

function transformResume(base: any, jobAnalysis: any, addedSkills: string[]): any {
  const mergedSkills = mergeSkills(base.skills ?? [], addedSkills);
  const updatedExperience = augmentExperience(base.experience ?? [], addedSkills, jobAnalysis);
  return {
    ...base,
    skills: mergedSkills,
    experience: updatedExperience,
  };
}
*/

/** Build the prompt for the Resume Forge agent. */
export function buildResumeForgePrompt(
  job: any,
  baseResume: any,
  evidence: any[],
  jobAnalysis: any,
  verifiedSkills: string[] = [],
  sourceOfTruth: { confirmedSkills: string[]; notesContext: string | null } | null = null
): string {
  // We pass the raw base resume directly to the AI without mechanical pre-processing.
  const rawBaseResume = baseResume?.content ?? {};

  return `You are Resume Forge, a top 1% professional resume architect. Your job is to take the candidate's clean BASE RESUME below and precision-tailor it so it reads as an elite, ATS-optimized match for THIS job — without inventing facts or fabricating experience. This is a strategic tailoring pass: reword, restructure, and emphasize real qualifications. If you are ever unsure whether to include something, keep it and reword it professionally rather than dropping it.

GROUND RULES & ARCHITECTURE:
1. Do not invent employers, job titles, dates, locations, degrees, certifications, licenses, or metrics/numbers that aren't already in the base resume, evidence bank, or Source of Truth. Everything else about the candidate's real history (skills, responsibilities, tools, technical wording) can be freely rephrased, reordered, condensed, or expanded to align with the job description.
2. Bullet-Writing Framework (Action + Tool/Skill + Scale/Outcome): Every single bullet in every experience role MUST follow this elite structural format:
   \`[Strong Action Verb] + [Specific Task, Tool, System, or Methodology] + [Scale, Scope, Environment, or Quantifiable Outcome]\`.
   Generic verbs ("Managed", "Assisted", "Responsible for") or robotic placeholder suffixes ("to meet job requirements", "per company standards", "in accordance with requirements") are STRICTLY FORBIDDEN. Write authentic, professional engineering and technical bullets.
3. Top 3 Page-One Wins: Check \`topThreePageOneWins\` and \`roleContext\` from the JOB ANALYSIS. You MUST ensure that the first role's top 2–3 bullets and the primary skills category directly address these employer priorities with concrete proof from the candidate's real background.
4. Keep every experience role from the base resume. Keep roughly the same number of bullets per role as the base resume (rewrite and enhance them, do not delete them). Do not collapse a role down to 1–2 bullets and do not return an empty experience array.
5. Never generate, add, or keep a professional summary. Always return summary as null.
6. Categorized Skills Structure: The skills output MUST use a categorized-group structure (an array of \`{ title, skills[] }\` groups, e.g. "Outside Plant Engineering & CAD", "Permitting & ROW Management", "Telecom Systems & QA/QC") — never collapse everything into one flat list or a generic "Skills" bucket. Tailor category titles so they immediately signal domain expertise for this specific job.
7. Natural Language Check: Before finalizing each bullet, verify that it reads as something a human subject-matter expert would write. If any bullet sounds like machine-generated filler or ends in "to meet job requirements", rewrite it immediately around real technical substance.

BASE RESUME:
${JSON.stringify(rawBaseResume).slice(0, 12000)}

EVIDENCE BANK:
${JSON.stringify(evidence).slice(0, 8000)}

VERIFIED SKILLS (recruiter-confirmed, safe to use without an evidenceId):
${verifiedSkills.length > 0 ? JSON.stringify(verifiedSkills) : "(none recorded)"}

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

SOURCE OF TRUTH SKILLS (skills the recruiter has personally confirmed this candidate is eligible to claim — treat these as equal to skills already in the base resume):
${JSON.stringify(sourceOfTruth?.confirmedSkills ?? [])}

CANDIDATE NOTES (internal context only — use to better understand the candidate's background and preferences; NEVER copy this text verbatim into the resume output):
${sourceOfTruth?.notesContext ?? "(none)"}

RULE FOR SOURCE OF TRUTH: For each SoT skill that maps to a JD requirement or keyword, integrate it naturally into the most relevant existing experience bullet (reword the bullet to include the tool/skill in context), or place it into the appropriate skills category. Never append standalone robotic sentences just to inject a skill. Pick only what the JD calls for. Do NOT invent employers, titles, or dates to support them.

Return ONLY valid JSON. No markdown fences, no explanation.`;
}
