// Pure resume-data mutation logic for the Falood AI copilot's suggestion
// cards. Deliberately has no React/JSX imports so it can be unit tested
// directly (this project's vitest config only picks up `*.test.ts` files and
// can't parse JSX imported transitively into one - extracted out of
// AiSuggestions.tsx, which re-exports both symbols so existing imports of
// them from that module path keep working unchanged).

import type { ResumeData, Experience } from "@/components/falood/resumify/types/resume";

interface SkillCategory {
  id: string;
  name: string;
  skills: string[];
}

interface EducationEntry {
  id?: string;
  degree: string;
  institution: string;
  location?: string;
  graduationYear?: string;
}

interface CustomSectionSuggestionPayload {
  title?: string;
  content?: string;
  type?: "paragraph" | "bullets";
}

export interface Suggestion {
  id: string;
  type: "experience" | "experience_info" | "experience_block_add" | "experience_block_remove" | "experience_add" | "experience_remove" | "skill" | "skill_remove" | "summary" | "skill_reorg" | "personal_info" | "education_add" | "custom_section_edit" | "custom_section_add";
  title: string;
  contextTitle?: string;
  description: string;
  original?: string;
  suggested: string | string[] | SkillCategory[] | EducationEntry[] | CustomSectionSuggestionPayload;
  targetId?: string; // ID of the experience item, skill category, or custom section
  subId?: string; // ID of the specific skill category if needed
  status?: "accepted" | "rejected" | "pending" | "failed";
}

export const applySuggestionToResumeData = (resumeData: ResumeData, suggestion: Suggestion): ResumeData => {
  const normalize = (s?: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  if (suggestion.type === "summary") {
    return { ...resumeData, summary: (suggestion.suggested as string) ?? "" };
  }

  if (suggestion.type === "personal_info" && suggestion.targetId) {
    const allowed: Record<string, boolean> = {
      fullName: true,
      jobTitle: true,
      email: true,
      phone: true,
      location: true,
      website: true,
      linkedin: true,
      github: true,
      birthDate: true,
    };

    if (!allowed[suggestion.targetId]) return resumeData;

    return {
      ...resumeData,
      personalInfo: {
        ...resumeData.personalInfo,
        [suggestion.targetId]: (suggestion.suggested as string) ?? "",
      } as ResumeData["personalInfo"],
    };
  }

  // The AI is asked (see SUGGESTIONS_SYSTEM_PROMPT in faloodAiService.ts)
  // to always set targetId to the matching experience/skill-category id,
  // but confirmed live across real conversations: it frequently omits it
  // (100% missing in one real session, ~4% across all sessions for
  // "experience" and up to a third for "skill"). Requiring an exact
  // targetId match made every one of those "Accept" clicks a silent
  // no-op - the chat marked the suggestion accepted but resumeData never
  // changed. Below, targetId is used as a hint when present and valid,
  // but matching falls back to locating suggestion.original (or, for
  // skills, just picking an unambiguous category) so acceptance still
  // works without it.
  if (suggestion.type === "experience") {
    const newText = (suggestion.suggested as string) ?? "";
    if (!newText) return resumeData;

    const byTargetId = suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : undefined;
    const candidates = byTargetId ? [byTargetId] : resumeData.experience;

    let matchedExpId: string | null = null;
    let matchedBulletIndex = -1;
    let matchedField: keyof Experience | "dateRange" | null = null;

    for (const exp of candidates) {
      if (!suggestion.original) continue;
      const normOriginal = normalize(suggestion.original);
      if (!normOriginal) continue;

      // 1. Try matching bullet points
      let idx = exp.bulletPoints.findIndex((bp) => bp === suggestion.original);
      if (idx === -1) {
        idx = exp.bulletPoints.findIndex((bp) => normalize(bp).includes(normOriginal) || normOriginal.includes(normalize(bp)));
      }
      if (idx !== -1) {
        matchedExpId = exp.id;
        matchedBulletIndex = idx;
        break;
      }

      // 2. Try matching other fields (jobTitle, company, etc.)
      if (normalize(exp.jobTitle) === normOriginal) { matchedExpId = exp.id; matchedField = "jobTitle"; break; }
      if (normalize(exp.company) === normOriginal) { matchedExpId = exp.id; matchedField = "company"; break; }
      if (normalize(exp.location) === normOriginal) { matchedExpId = exp.id; matchedField = "location"; break; }
      if (normalize(exp.startDate) === normOriginal) { matchedExpId = exp.id; matchedField = "startDate"; break; }
      if (normalize(exp.endDate) === normOriginal) { matchedExpId = exp.id; matchedField = "endDate"; break; }

      // 3. Try matching combined date string (e.g. "Jul 2025 - Present")
      const combinedDate = `${exp.startDate || ""} - ${exp.endDate || ""}`;
      if (normalize(combinedDate) === normOriginal || normalize(combinedDate).includes(normOriginal)) {
        matchedExpId = exp.id;
        matchedField = "dateRange";
        break;
      }
    }

    if (matchedExpId === null) return resumeData;

    const updatedExperience = resumeData.experience.map((exp) => {
      if (exp.id !== matchedExpId) return exp;

      if (matchedBulletIndex !== -1) {
        const updatedBullets = [...exp.bulletPoints];
        updatedBullets[matchedBulletIndex] = newText;
        return { ...exp, bulletPoints: updatedBullets };
      }

      if (matchedField === "dateRange") {
        const parts = newText.split(/\s*[-–—]\s*/);
        if (parts.length >= 2) {
          return { ...exp, startDate: parts[0].trim(), endDate: parts.slice(1).join(" - ").trim() };
        } else {
          return { ...exp, endDate: newText };
        }
      } else if (matchedField) {
        return { ...exp, [matchedField]: newText };
      }

      return exp;
    });

    return { ...resumeData, experience: updatedExperience };
  }

  if (suggestion.type === "experience_info") {
    const field = suggestion.original as keyof Experience | undefined;
    const newText = (suggestion.suggested as string) ?? "";
    if (!field || !newText) return resumeData;

    const target = suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : resumeData.experience[0]; // fallback to most recent if no targetId

    if (!target) return resumeData;
    const allowedFields = ["jobTitle", "company", "location", "startDate", "endDate"];
    if (!allowedFields.includes(field)) return resumeData;

    const updatedExperience = resumeData.experience.map((exp) => {
      if (exp.id !== target.id) return exp;
      return { ...exp, [field]: newText };
    });

    return { ...resumeData, experience: updatedExperience };
  }

  if (suggestion.type === "experience_block_add") {
    const newBlock = suggestion.suggested as any;
    if (!newBlock || typeof newBlock !== "object") return resumeData;

    const newExperience: Experience = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      jobTitle: newBlock.jobTitle || "",
      company: newBlock.company || "",
      location: newBlock.location || "",
      startDate: newBlock.startDate || "",
      endDate: newBlock.endDate || "",
      current: newBlock.current || false,
      description: newBlock.description || "",
      bulletPoints: Array.isArray(newBlock.bulletPoints) ? newBlock.bulletPoints : [],
    };

    return { ...resumeData, experience: [newExperience, ...resumeData.experience] };
  }

  if (suggestion.type === "experience_block_remove") {
    if (!suggestion.targetId) return resumeData;
    const updatedExperience = resumeData.experience.filter((exp) => exp.id !== suggestion.targetId);
    if (updatedExperience.length === resumeData.experience.length) return resumeData; // no match

    return { ...resumeData, experience: updatedExperience };
  }

  if (suggestion.type === "experience_add") {
    const newBullet = (suggestion.suggested as string)?.trim();
    if (!newBullet) return resumeData;

    // No original text to locate against for a brand-new bullet - fall
    // back to the most recent (first) role, which is what a tailoring
    // conversation is about the overwhelming majority of the time.
    const target = (suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : undefined) ?? resumeData.experience[0];
    if (!target) return resumeData;

    const updatedExperience = resumeData.experience.map((exp) => {
      if (exp.id !== target.id) return exp;

      // FALLBACK: If the AI outputted 'experience_add' but provided an 'original' text,
      // it actually meant to MODIFY an existing bullet (or date).
      if (suggestion.original) {
        const normOrig = normalize(suggestion.original);
        if (normOrig) {
          let idx = exp.bulletPoints.findIndex((bp) => bp === suggestion.original);
          if (idx === -1) {
            idx = exp.bulletPoints.findIndex((bp) => normalize(bp).includes(normOrig) || normOrig.includes(normalize(bp)));
          }
          if (idx !== -1) {
            const updated = [...exp.bulletPoints];
            updated[idx] = newBullet;
            return { ...exp, bulletPoints: updated };
          }

          // Try dates as well, just in case they used experience_add for a date change
          if (normalize(exp.startDate) === normOrig) return { ...exp, startDate: newBullet };
          if (normalize(exp.endDate) === normOrig) return { ...exp, endDate: newBullet };

          const combinedDate = `${exp.startDate || ""} - ${exp.endDate || ""}`;
          if (normalize(combinedDate) === normOrig || normalize(combinedDate).includes(normOrig)) {
            const parts = newBullet.split(/\s*[-–—]\s*/);
            if (parts.length >= 2) {
              return { ...exp, startDate: parts[0].trim(), endDate: parts.slice(1).join(" - ").trim() };
            } else {
              return { ...exp, endDate: newBullet };
            }
          }
        }
      }

      if (exp.bulletPoints.includes(newBullet)) return exp;
      return { ...exp, bulletPoints: [...exp.bulletPoints, newBullet] };
    });

    return { ...resumeData, experience: updatedExperience };
  }

  if (suggestion.type === "experience_remove") {
    const original = suggestion.original || (typeof suggestion.suggested === "string" ? suggestion.suggested : "");
    if (!original) return resumeData;
    const normalizedOriginal = normalize(original);

    const byTargetId = suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : undefined;
    const hasMatch = (byTargetId ? [byTargetId] : resumeData.experience)
      .some((exp) => exp.bulletPoints.some((bp) => normalize(bp) === normalizedOriginal));
    if (!hasMatch) return resumeData;

    const updatedExperience = resumeData.experience.map((exp) => {
      if (byTargetId && exp.id !== byTargetId.id) return exp;
      return { ...exp, bulletPoints: exp.bulletPoints.filter((bp) => normalize(bp) !== normalizedOriginal) };
    });

    return { ...resumeData, experience: updatedExperience };
  }

  if (suggestion.type === "skill") {
    const newSkills = Array.isArray(suggestion.suggested) ? (suggestion.suggested as string[]) : [];
    if (newSkills.length === 0) return resumeData;

    const categories = resumeData.skills.categorized;
    if (categories.length === 0) return resumeData;

    const targetCatId = (suggestion.targetId && categories.some((c) => c.id === suggestion.targetId))
      ? suggestion.targetId
      : categories[0].id;

    const updatedCategories = categories.map((cat) => {
      if (cat.id !== targetCatId) return cat;
      const uniqueNewSkills = newSkills.filter((s) => !cat.skills.includes(s));
      return { ...cat, skills: [...cat.skills, ...uniqueNewSkills] };
    });

    return {
      ...resumeData,
      skills: {
        ...resumeData.skills,
        categorized: updatedCategories,
      },
    };
  }

  if (suggestion.type === "skill_remove") {
    const removeSkills = Array.isArray(suggestion.suggested) ? (suggestion.suggested as string[]) : [];
    const removeSet = new Set(removeSkills.map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (removeSet.size === 0) return resumeData;

    // Removal is unambiguous without targetId - just strip matching
    // skill names from whichever category actually contains them.
    const updatedCategories = resumeData.skills.categorized.map((cat) => ({
      ...cat,
      skills: cat.skills.filter((s) => !removeSet.has(s.trim().toLowerCase())),
    }));

    return {
      ...resumeData,
      skills: {
        ...resumeData.skills,
        categorized: updatedCategories,
      },
    };
  }

  if (suggestion.type === "education_add") {
    const newEntries = Array.isArray(suggestion.suggested) ? (suggestion.suggested as EducationEntry[]) : [];
    if (newEntries.length === 0) return resumeData;

    const existingKeys = new Set(resumeData.education.map((e) => `${e.degree}|${e.institution}`.toLowerCase()));
    const toAdd = newEntries
      .filter((e) => e && e.degree && e.institution)
      .filter((e) => !existingKeys.has(`${e.degree}|${e.institution}`.toLowerCase()))
      .map((e) => ({
        id: e.id || `edu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        degree: e.degree,
        institution: e.institution,
        location: e.location || "",
        graduationYear: e.graduationYear || "",
      }));

    if (toAdd.length === 0) return resumeData;
    return { ...resumeData, education: [...resumeData.education, ...toAdd] };
  }

  // Same targetId-as-hint resilience as the experience/skill branches
  // above: the AI is told to set targetId to the custom section's id,
  // but falls back to matching by title (contextTitle) or by the old
  // content text (original) so acceptance still works if it's missing
  // or wrong. This is intentionally generic across ANY custom
  // section - present or newly added by the user - rather than a
  // fixed list of known section names, since custom sections are
  // user-defined and open-ended by nature.
  if (suggestion.type === "custom_section_edit") {
    const newContent = ((suggestion.suggested as CustomSectionSuggestionPayload)?.content
      ?? (typeof suggestion.suggested === "string" ? suggestion.suggested : "")) || "";
    if (!newContent.trim()) return resumeData;

    const byTargetId = suggestion.targetId
      ? resumeData.customSections.find((cs) => cs.id === suggestion.targetId)
      : undefined;
    const byTitle = !byTargetId && suggestion.contextTitle
      ? resumeData.customSections.find((cs) => normalize(cs.title) === normalize(suggestion.contextTitle))
      : undefined;
    const byOriginal = !byTargetId && !byTitle && suggestion.original
      ? resumeData.customSections.find((cs) => normalize(cs.content) === normalize(suggestion.original))
      : undefined;
    const match = byTargetId || byTitle || byOriginal;
    if (!match) return resumeData;

    return {
      ...resumeData,
      customSections: resumeData.customSections.map((cs) =>
        cs.id === match.id ? { ...cs, content: newContent } : cs
      ),
    };
  }

  if (suggestion.type === "custom_section_add") {
    const payload = (typeof suggestion.suggested === "object" && !Array.isArray(suggestion.suggested)
      ? suggestion.suggested as CustomSectionSuggestionPayload
      : undefined);
    const title = (payload?.title || suggestion.contextTitle || "").trim();
    const content = (payload?.content || "").trim();
    if (!title || !content) return resumeData;

    const alreadyExists = resumeData.customSections.some((cs) => normalize(cs.title) === normalize(title));
    if (alreadyExists) return resumeData;

    const newSection = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      content,
      type: (payload?.type === "paragraph" ? "paragraph" : "bullets") as "paragraph" | "bullets",
      visible: true,
      order: resumeData.customSections.length + 1,
    };
    return { ...resumeData, customSections: [...resumeData.customSections, newSection] };
  }

  if (suggestion.type === "skill_reorg") {
    const newCategories = suggestion.suggested as SkillCategory[];
    if (!Array.isArray(newCategories)) return resumeData;

    // Ensure all categories have a unique ID, otherwise React state bleeds across categories
    const categoriesWithIds = newCategories.map((cat, idx) => ({
      ...cat,
      id: cat.id || `ai-cat-${Date.now()}-${idx}`,
    }));

    return {
      ...resumeData,
      skills: {
        ...resumeData.skills,
        categorized: categoriesWithIds,
      },
    };
  }

  return resumeData;
};
