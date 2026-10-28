// Shared "does this resume look like the blank placeholder" check.
//
// Incident (2026-10-15): the Falood Studio tailor page
// (src/app/falood/studio/tailor/[id]/page.tsx) has an exit-flush safety net
// that PATCHes current state to the server on tab-close/switch/navigate-away
// so an in-progress edit isn't lost. It decided whether there was anything
// to flush by comparing against "the last confirmed-loaded snapshot" - but
// that snapshot is only set AFTER the initial GET load succeeds. Leaving the
// page (or the load simply being slow - already a known issue with this
// app's DB connection) before that load finished made the check wrongly
// conclude "unsaved changes exist" and PATCH the still-blank initial state
// over real saved content, silently destroying it. Confirmed to have
// happened to at least one candidate's reviewed/applied tailored resume.
//
// That specific race is fixed at its source (the page no longer considers
// itself "dirty" until a real load has completed). This check is the
// independent, structural backstop: used both client-side (skip sending a
// doomed/destructive save) and server-side (refuse to persist it even if a
// client bug sends one anyway) - so this exact class of data loss can't
// recur even from a future, different bug in either place.
//
// Shape note (2026-10-27): base_resumes.content is stored in two different
// shapes in production - the Resumify-native shape this file was originally
// written for (personalInfo.fullName, summary as a plain string, skills as
// {mode, simple, categorized}), and an older "canonical" shape (confirmed
// live: ~88% of base_resumes rows) that uses header.fullName, summary as
// {id, text}, and skills as a bare array of {title, skills[]} groups. This
// check is reused against base_resumes.content (see
// src/app/api/base-resumes/[id]/route.ts), so it must recognize real content
// in either shape - reading only the Resumify-native fields would make a
// fully-populated canonical resume register as "empty" (false positive
// rejection) and `(data.summary || "").trim()` throws outright when summary
// is the canonical {id, text} object, not a string.
import type { ResumeData } from "@/components/falood/resumify/types/resume";

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string") {
    return (value as { text: string }).text;
  }
  return "";
}

export function isResumeDataEffectivelyEmpty(data: Partial<ResumeData> | null | undefined): boolean {
  if (!data || typeof data !== "object") return true;
  const raw = data as Record<string, unknown>;
  const personalInfo = (raw.personalInfo ?? {}) as Record<string, unknown>;
  const header = (raw.header ?? {}) as Record<string, unknown>;
  const hasName = !!readText(personalInfo.fullName ?? header.fullName).trim();
  const hasEmail = !!readText(personalInfo.email ?? header.email).trim();
  const hasSummary = !!readText(raw.summary).trim();
  const hasExperience = Array.isArray(data.experience) && data.experience.length > 0;
  const hasEducation = Array.isArray(data.education) && data.education.length > 0;
  const hasProjects = Array.isArray(data.projects) && data.projects.length > 0;
  const skills = raw.skills;
  // Resumify-native: { mode, simple: string[], categorized: SkillCategory[] }.
  const hasSimpleSkills = Array.isArray((skills as { simple?: unknown })?.simple)
    && ((skills as { simple: unknown[] }).simple.length > 0);
  const hasCategorizedSkills = Array.isArray((skills as { categorized?: unknown })?.categorized)
    && (skills as { categorized: { skills?: unknown[] }[] }).categorized.some((c) => Array.isArray(c?.skills) && c.skills.length > 0);
  // Canonical: a bare array of { title, skills: string[] } groups.
  const hasCanonicalSkills = Array.isArray(skills)
    && (skills as { skills?: unknown[] }[]).some((group) => Array.isArray(group?.skills) && group.skills.length > 0);
  return (
    !hasName && !hasEmail && !hasSummary && !hasExperience && !hasEducation && !hasProjects
    && !hasSimpleSkills && !hasCategorizedSkills && !hasCanonicalSkills
  );
}

export type PersistGuardReason = "not_loaded" | "would_erase_content";

export type PersistGuardResult =
  | { allow: true }
  | { allow: false; reason: PersistGuardReason };

/**
 * The single decision rule behind every exit-flush/autosave/explicit-save
 * guard on both resume studio pages: never persist anything before a real
 * load has completed, and never let a snapshot that now looks empty replace
 * one that was genuinely saved with real content (a brand-new, never-saved
 * session's first save is still allowed through - that's the
 * `lastSavedResumeData` empty-too case below).
 */
export function shouldPersistResumeSnapshot(input: {
  hasLoadedInitialData: boolean;
  nextResumeData: Partial<ResumeData> | null | undefined;
  lastSavedResumeData: Partial<ResumeData> | null | undefined;
}): PersistGuardResult {
  if (!input.hasLoadedInitialData) return { allow: false, reason: "not_loaded" };
  if (!isResumeDataEffectivelyEmpty(input.nextResumeData)) return { allow: true };
  if (isResumeDataEffectivelyEmpty(input.lastSavedResumeData ?? null)) return { allow: true };
  return { allow: false, reason: "would_erase_content" };
}
