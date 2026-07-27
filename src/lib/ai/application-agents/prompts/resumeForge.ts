// Resume Forge prompt builder

// Keyword sets that map a skill to an existing base resume skill category.
// Checked in order — first match wins. If no match, skill falls into "Additional Skills".
const CATEGORY_KEYWORDS: Array<{ keywords: RegExp; category: string }> = [
  { keywords: /\b(gis|arcgis|arcmap|qgis|esri|geodatabase|shapefile|lidar|spatial|geospatial|survey|trimble|field gis|geomedia|mapinfo|autocad map|civil 3d|microstation|bluebeam|openroads|inroads|bentley)\b/i, category: "GIS & Mapping" },
  { keywords: /\b(autocad|civil 3d|microstation|bluebeam|cad|bim|revit|navisworks|solidworks|catia|inventor|sketchup|rhino|openroads|inroads|bentley|drawing|design software)\b/i, category: "Design / CAD" },
  { keywords: /\b(python|javascript|typescript|java|c\+\+|c#|sql|r |matlab|bash|powershell|html|css|react|node|django|flask|fastapi|tensorflow|pytorch|pandas|numpy|scikit|spark|hadoop|kafka|git|github|docker|kubernetes|aws|azure|gcp|cloud|api|rest|graphql|postgresql|mysql|mongodb|redis|linux)\b/i, category: "Programming & Technology" },
  { keywords: /\b(project management|pm|pmp|agile|scrum|kanban|waterfall|jira|trello|asana|ms project|primavera|schedule|planning|budget|cost control|earned value|risk management|stakeholder|procurement|rfp|rfq|proposal|estimating|change order)\b/i, category: "Project Management" },
  { keywords: /\b(row|right.of.way|permitting|easement|license|franchise|utility coordination|land rights|acquisition|title|condemnation|survey coordination|encroachment|access agreement)\b/i, category: "ROW & Permitting" },
  { keywords: /\b(fiber|telecom|broadband|network|nso|ntp|osp|isp|coax|copper|wireless|rf|tower|splice|strand|conduit|pathway|duct|hand hole|vault|pole attachment|make ready|nesc|go-95|joint use|nsa|nro)\b/i, category: "Telecom / OSP" },
  { keywords: /\b(construction|field|inspection|safety|osha|quality|qa|qc|contractor|subcontractor|bid|estimate|rfi|submittal|as-built|site|surveying|grading|drainage|erosion|storm water|swppp|npdes|environmental|utility|underground|aerial|installation)\b/i, category: "Construction & Field" },
  { keywords: /\b(excel|word|powerpoint|outlook|office|sharepoint|teams|google workspace|tableau|power bi|looker|qlikview|salesforce|crm|erp|sap|oracle|dynamics|hubspot|zendesk|servicenow|miro|figma|adobe)\b/i, category: "Software & Tools" },
];

/** Map a skill to an existing base category or a best-fit category using keyword matching. */
function mapSkillToCategory(skill: string, existingCategoryTitles: string[]): string {
  const skillLower = skill.toLowerCase();
  // 1. Try to match an existing base category title directly
  for (const catTitle of existingCategoryTitles) {
    const catLower = catTitle.toLowerCase();
    if (skillLower.includes(catLower.split("/")[0].trim()) || catLower.includes(skillLower.split(" ")[0])) {
      return catTitle;
    }
  }
  // 2. Use keyword-based category mapping
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.test(skill)) {
      // If the matched category exists in the base resume, use it; otherwise use the mapped name
      const existing = existingCategoryTitles.find(t => t.toLowerCase().includes(category.split(" ")[0].toLowerCase()) || category.toLowerCase().includes(t.toLowerCase().split(" ")[0]));
      return existing ?? category;
    }
  }
  // 3. Fall back to last existing category or "Additional Skills"
  return existingCategoryTitles.length > 0 ? existingCategoryTitles[existingCategoryTitles.length - 1] : "Additional Skills";
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

/** Merge new skills into the base skill categories using smart category matching — no duplicates, no bloat. */
function mergeSkills(baseCategories: any[], newSkills: string[]): any[] {
  const allExisting = new Set<string>();
  const categories = baseCategories.map(c => {
    const skillsSet = new Set<string>(c.skills || []);
    skillsSet.forEach(s => allExisting.add(s));
    return { title: c.title, skills: skillsSet };
  });

  const existingTitles = categories.map(c => c.title);

  newSkills.forEach(skill => {
    if (!isCleanSkill(skill, allExisting)) return;
    const catTitle = mapSkillToCategory(skill, existingTitles);
    let cat = categories.find(c => c.title === catTitle);
    if (!cat) {
      cat = { title: catTitle, skills: new Set<string>() };
      categories.push(cat);
      existingTitles.push(catTitle);
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

/** Augment experience bullets with new skills, capping at 7 bullets per role. */
function augmentExperience(experiences: any[], newSkills: string[], jobAnalysis: any): any[] {
  const jdKeywords = new Set([...(jobAnalysis.requiredSkills ?? []), ...(jobAnalysis.preferredSkills ?? [])]);
  const verbPool = ["Designed", "Implemented", "Managed", "Optimized", "Developed", "Leveraged", "Coordinated", "Delivered"];
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
    const verb = verbPool[Math.floor(Math.random() * verbPool.length)];
    const newBullet = `${verb} ${skill} to support project delivery, technical accuracy, and alignment with scope requirements.`;
    if (target.bullets.length < 7) {
      target.bullets.push(newBullet);
    } else {
      // Replace the bullet with the lowest JD-keyword match count.
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

/** Build per-role minimum bullet requirements as a prompt string. */
function buildBulletRequirements(experiences: any[]): string {
  if (!experiences || experiences.length === 0) return "";
  const lines = experiences.map((exp, idx) => {
    const roleLabel = exp.title ? `"${exp.title}" at ${exp.company ?? ""}` : `Role ${idx + 1}`;
    const min = idx === 0 ? 6 : idx === 1 ? 4 : 3;
    const max = idx === 0 ? 7 : 6;
    return `  - ${roleLabel}: minimum ${min} bullets, maximum ${max} bullets`;
  });
  return lines.join("\n");
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
    ...(jobAnalysis.tools ?? []),
    ...(jobAnalysis.methodologies ?? []),
    ...(verifiedSkills ?? []),
    ...(sourceOfTruth?.confirmedSkills ?? []),
  ];

  // Produce a version of the base resume that already includes the new skills.
  const baseContent = baseResume?.content ?? {};
  const transformed = transformResume(baseContent, jobAnalysis, addedSkills);
  const bulletRequirements = buildBulletRequirements(baseContent.experience ?? []);

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
* MAXIMIZE skill coverage: Expand EACH existing category to its full potential using skills from the base resume, Source of Truth, JD required skills, JD preferred skills, tools, and methodologies. Target 8-15 distinct, high-priority skills per category. Never artificially truncate or cap any category.
* Preserve all existing skill categories from the base resume exactly as-is, then EXPAND them — do not create new categories when skills can fit into existing ones.
* Prioritize the most important technical skills required by the JD without adding bloat or generic buzzwords.

JOB TITLE & DATE INTEGRITY RULES (CRITICAL):
* NEVER duplicate a job role, job title, company name, or date range! Each employment position from the base resume must appear EXACTLY ONCE in the experience array. No same job title or company should appear 2 times strictly.
* DO NOT touch, alter, or invent job titles, company names, locations, or employment dates! They must remain 100% identical to the base resume (e.g., if a role is 'Jan 2022 - Present', never change it to 'Jan 2022 - Jan 2022'). Future-looking or unconventional dates are the candidate's real data — preserve them exactly.
* Every experience entry from the base resume must be preserved exactly once in the same chronological order.

PAGE FULLNESS & EXPERIENCE BULLET COUNT RULES (CRITICAL - DO NOT LEAVE EMPTY WHITESPACE BELOW):
* The tailored resume MUST look visually full, comprehensive, and balanced, completely filling out the single page from top to bottom without leaving large empty whitespace at the bottom.
* REQUIRED bullet counts per role (based on this candidate's actual experience):
${bulletRequirements || "  - Most recent role: 6-7 bullets\n  - Earlier roles: 4-6 bullets\n  - Oldest roles: 3-4 bullets"}
* NEVER remove all bullet points from any experience role! NEVER leave any role with fewer than 3 bullets!
* Each bullet should be a rich, multi-clause statement (one to two complete sentences where needed) that demonstrates quantified impact, tools used, and project context. Do NOT write one-line stubs.
* If trimming for page length, SHORTEN bullets (condense wording), do NOT delete entire bullets.

Humanity may worship keywords, but credibility still gets the interview.

JOB ANALYSIS:
${JSON.stringify(jobAnalysis)}

BASE RESUME (pre-transformed with merged skills):
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
