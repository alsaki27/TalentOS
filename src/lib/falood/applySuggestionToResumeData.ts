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
  /** Set by the UI when a suggestion can't be applied, with a specific, human-readable reason (see getSuggestionApplyResult). */
  failureReason?: string;
}

/** A suggestion couldn't change anything, and why - distinct reasons so the UI can tell "already on the resume" apart from "couldn't locate the original text" instead of one generic message for every case. */
export interface SuggestionApplyResult {
  resumeData: ResumeData;
  applied: boolean;
  reason?: string;
}

const unchanged = (resumeData: ResumeData, reason: string): SuggestionApplyResult => ({ resumeData, applied: false, reason });
const changed = (resumeData: ResumeData): SuggestionApplyResult => ({ resumeData, applied: true });

/**
 * Applies a suggestion to resumeData and reports whether it actually changed
 * anything, with a specific reason when it didn't. This is the single
 * implementation both applySuggestionToResumeData (kept for existing
 * callers - live preview-on-hover, and every prior test, none of which need
 * the reason) and getSuggestionApplyResult (used by Accept/Accept All to
 * show an accurate "why didn't this apply" message) delegate to, so a future
 * suggestion type only needs one new branch here to get correct application
 * AND correct messaging - never two places to keep in sync.
 */
function applySuggestion(resumeData: ResumeData, suggestion: Suggestion): SuggestionApplyResult {
  const normalize = (s?: string | null) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  if (suggestion.type === "summary") {
    return changed({ ...resumeData, summary: (suggestion.suggested as string) ?? "" });
  }

  if (suggestion.type === "personal_info") {
    if (!suggestion.targetId) return unchanged(resumeData, "No field was specified to update.");
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

    if (!allowed[suggestion.targetId]) return unchanged(resumeData, "That field can't be edited this way.");

    return changed({
      ...resumeData,
      personalInfo: {
        ...resumeData.personalInfo,
        [suggestion.targetId]: (suggestion.suggested as string) ?? "",
      } as ResumeData["personalInfo"],
    });
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
    if (!newText) return unchanged(resumeData, "No replacement text was provided.");

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

    if (matchedExpId === null) return unchanged(resumeData, "Couldn't find that exact text on the resume - it may have already changed.");

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

    return changed({ ...resumeData, experience: updatedExperience });
  }

  if (suggestion.type === "experience_info") {
    const field = suggestion.original as keyof Experience | undefined;
    const newText = (suggestion.suggested as string) ?? "";
    if (!field || !newText) return unchanged(resumeData, "Missing the field or the new value to set.");

    const target = suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : resumeData.experience[0]; // fallback to most recent if no targetId

    if (!target) return unchanged(resumeData, "Couldn't find a matching experience entry.");
    const allowedFields = ["jobTitle", "company", "location", "startDate", "endDate"];
    if (!allowedFields.includes(field)) return unchanged(resumeData, "That field can't be edited this way.");

    const updatedExperience = resumeData.experience.map((exp) => {
      if (exp.id !== target.id) return exp;
      return { ...exp, [field]: newText };
    });

    return changed({ ...resumeData, experience: updatedExperience });
  }

  if (suggestion.type === "experience_block_add") {
    const newBlock = suggestion.suggested as any;
    if (!newBlock || typeof newBlock !== "object") return unchanged(resumeData, "No job details were provided.");

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

    return changed({ ...resumeData, experience: [newExperience, ...resumeData.experience] });
  }

  if (suggestion.type === "experience_block_remove") {
    if (!suggestion.targetId) return unchanged(resumeData, "No experience entry was specified.");
    const updatedExperience = resumeData.experience.filter((exp) => exp.id !== suggestion.targetId);
    if (updatedExperience.length === resumeData.experience.length) {
      return unchanged(resumeData, "Couldn't find that experience entry - it may have already been removed.");
    }

    return changed({ ...resumeData, experience: updatedExperience });
  }

  if (suggestion.type === "experience_add") {
    const newBullet = (suggestion.suggested as string)?.trim();
    if (!newBullet) return unchanged(resumeData, "No bullet text was provided.");

    // No original text to locate against for a brand-new bullet - fall
    // back to the most recent (first) role, which is what a tailoring
    // conversation is about the overwhelming majority of the time.
    const target = (suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : undefined) ?? resumeData.experience[0];
    if (!target) return unchanged(resumeData, "Couldn't find a matching experience entry to add this to.");

    // Tracks what actually happened inside the map below, so the reason
    // reported when nothing changes matches what was actually tried - a
    // modify-via-original attempt that found no match is a different
    // situation from the bullet simply already being present.
    let outcome: "modified" | "already_present" | "added" | "none" = "none";

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
            outcome = "modified";
            return { ...exp, bulletPoints: updated };
          }

          // Try dates as well, just in case they used experience_add for a date change
          if (normalize(exp.startDate) === normOrig) { outcome = "modified"; return { ...exp, startDate: newBullet }; }
          if (normalize(exp.endDate) === normOrig) { outcome = "modified"; return { ...exp, endDate: newBullet }; }

          const combinedDate = `${exp.startDate || ""} - ${exp.endDate || ""}`;
          if (normalize(combinedDate) === normOrig || normalize(combinedDate).includes(normOrig)) {
            const parts = newBullet.split(/\s*[-–—]\s*/);
            outcome = "modified";
            if (parts.length >= 2) {
              return { ...exp, startDate: parts[0].trim(), endDate: parts.slice(1).join(" - ").trim() };
            } else {
              return { ...exp, endDate: newBullet };
            }
          }
        }
      }

      if (exp.bulletPoints.includes(newBullet)) {
        outcome = "already_present";
        return exp;
      }

      outcome = "added";
      return { ...exp, bulletPoints: [...exp.bulletPoints, newBullet] };
    });

    if (outcome === "none") return unchanged(resumeData, "Couldn't find that exact text on the resume to update.");
    if (outcome === "already_present") return unchanged(resumeData, "That bullet is already on this experience entry.");

    return changed({ ...resumeData, experience: updatedExperience });
  }

  if (suggestion.type === "experience_remove") {
    const original = suggestion.original || (typeof suggestion.suggested === "string" ? suggestion.suggested : "");
    if (!original) return unchanged(resumeData, "No text was specified to remove.");
    const normalizedOriginal = normalize(original);

    const byTargetId = suggestion.targetId
      ? resumeData.experience.find((exp) => exp.id === suggestion.targetId)
      : undefined;
    const hasMatch = (byTargetId ? [byTargetId] : resumeData.experience)
      .some((exp) => exp.bulletPoints.some((bp) => normalize(bp) === normalizedOriginal));
    if (!hasMatch) return unchanged(resumeData, "Couldn't find that exact bullet on the resume - it may have already changed.");

    const updatedExperience = resumeData.experience.map((exp) => {
      if (byTargetId && exp.id !== byTargetId.id) return exp;
      return { ...exp, bulletPoints: exp.bulletPoints.filter((bp) => normalize(bp) !== normalizedOriginal) };
    });

    return changed({ ...resumeData, experience: updatedExperience });
  }

  if (suggestion.type === "skill") {
    const newSkills = Array.isArray(suggestion.suggested) ? (suggestion.suggested as string[]) : [];
    if (newSkills.length === 0) return unchanged(resumeData, "No skill was specified.");

    const categories = resumeData.skills.categorized;
    if (categories.length === 0) return unchanged(resumeData, "This resume has no skill categories to add to yet.");

    const targetCatId = (suggestion.targetId && categories.some((c) => c.id === suggestion.targetId))
      ? suggestion.targetId
      : categories[0].id;

    const onResumeAlready = (s: string) => categories.some((cat) => cat.skills.some((existing) => normalize(existing) === normalize(s)));
    if (newSkills.every(onResumeAlready)) {
      return unchanged(resumeData, newSkills.length === 1 ? `"${newSkills[0]}" is already on the resume.` : "These skills are already on the resume.");
    }

    const updatedCategories = categories.map((cat) => {
      if (cat.id !== targetCatId) return cat;
      const uniqueNewSkills = newSkills.filter((s) => !cat.skills.some((existing) => normalize(existing) === normalize(s)));
      return { ...cat, skills: [...cat.skills, ...uniqueNewSkills] };
    });

    return changed({
      ...resumeData,
      skills: {
        ...resumeData.skills,
        categorized: updatedCategories,
      },
    });
  }

  if (suggestion.type === "skill_remove") {
    const removeSkills = Array.isArray(suggestion.suggested) ? (suggestion.suggested as string[]) : [];
    const removeSet = new Set(removeSkills.map((s) => s.trim().toLowerCase()).filter(Boolean));
    if (removeSet.size === 0) return unchanged(resumeData, "No skill was specified to remove.");

    const existed = resumeData.skills.categorized.some((cat) => cat.skills.some((s) => removeSet.has(s.trim().toLowerCase())));
    if (!existed) return unchanged(resumeData, "That skill isn't currently on the resume.");

    // Removal is unambiguous without targetId - just strip matching
    // skill names from whichever category actually contains them.
    const updatedCategories = resumeData.skills.categorized.map((cat) => ({
      ...cat,
      skills: cat.skills.filter((s) => !removeSet.has(s.trim().toLowerCase())),
    }));

    return changed({
      ...resumeData,
      skills: {
        ...resumeData.skills,
        categorized: updatedCategories,
      },
    });
  }

  if (suggestion.type === "education_add") {
    const newEntries = Array.isArray(suggestion.suggested) ? (suggestion.suggested as EducationEntry[]) : [];
    if (newEntries.length === 0) return unchanged(resumeData, "No education details were provided.");

    const validEntries = newEntries.filter((e) => e && e.degree && e.institution);
    if (validEntries.length === 0) return unchanged(resumeData, "That entry is missing a degree or institution.");

    const existingKeys = new Set(resumeData.education.map((e) => `${e.degree}|${e.institution}`.toLowerCase()));
    const toAdd = validEntries
      .filter((e) => !existingKeys.has(`${e.degree}|${e.institution}`.toLowerCase()))
      .map((e) => ({
        id: e.id || `edu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        degree: e.degree,
        institution: e.institution,
        location: e.location || "",
        graduationYear: e.graduationYear || "",
      }));

    if (toAdd.length === 0) return unchanged(resumeData, "This education entry is already on the resume.");
    return changed({ ...resumeData, education: [...resumeData.education, ...toAdd] });
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
    if (!newContent.trim()) return unchanged(resumeData, "No content was provided.");

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
    if (!match) return unchanged(resumeData, "Couldn't find that custom section on the resume - it may have already changed.");

    if (normalize(match.content) === normalize(newContent)) {
      return unchanged(resumeData, "This content is already on the resume.");
    }

    return changed({
      ...resumeData,
      customSections: resumeData.customSections.map((cs) =>
        cs.id === match.id ? { ...cs, content: newContent } : cs
      ),
    });
  }

  if (suggestion.type === "custom_section_add") {
    const payload = (typeof suggestion.suggested === "object" && !Array.isArray(suggestion.suggested)
      ? suggestion.suggested as CustomSectionSuggestionPayload
      : undefined);
    const title = (payload?.title || suggestion.contextTitle || "").trim();
    const content = (payload?.content || "").trim();
    if (!title || !content) return unchanged(resumeData, "Missing a section title or content.");

    const alreadyExists = resumeData.customSections.some((cs) => normalize(cs.title) === normalize(title));
    if (alreadyExists) return unchanged(resumeData, `A "${title}" section already exists on the resume.`);

    const newSection = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      content,
      type: (payload?.type === "paragraph" ? "paragraph" : "bullets") as "paragraph" | "bullets",
      visible: true,
      order: resumeData.customSections.length + 1,
    };
    return changed({ ...resumeData, customSections: [...resumeData.customSections, newSection] });
  }

  if (suggestion.type === "skill_reorg") {
    const newCategories = suggestion.suggested as SkillCategory[];
    if (!Array.isArray(newCategories)) return unchanged(resumeData, "No valid skill categories were provided.");

    // Ensure all categories have a unique ID, otherwise React state bleeds across categories
    const categoriesWithIds = newCategories.map((cat, idx) => ({
      ...cat,
      id: cat.id || `ai-cat-${Date.now()}-${idx}`,
    }));

    return changed({
      ...resumeData,
      skills: {
        ...resumeData.skills,
        categorized: categoriesWithIds,
      },
    });
  }

  return unchanged(resumeData, "This suggestion type isn't recognized.");
}

/** Applies a suggestion and returns the resulting resumeData - unchanged (same reference) if it couldn't be applied. Used for live preview-on-hover, where only the resulting data matters. */
export const applySuggestionToResumeData = (resumeData: ResumeData, suggestion: Suggestion): ResumeData =>
  applySuggestion(resumeData, suggestion).resumeData;

/** Applies a suggestion and reports whether it actually changed anything, with a specific reason when it didn't - used by Accept/Accept All so the UI can show an accurate "why didn't this apply" message instead of one generic reason for every case. */
export const getSuggestionApplyResult = (resumeData: ResumeData, suggestion: Suggestion): SuggestionApplyResult =>
  applySuggestion(resumeData, suggestion);
