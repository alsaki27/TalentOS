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
import type { ResumeData } from "@/components/falood/resumify/types/resume";

export function isResumeDataEffectivelyEmpty(data: Partial<ResumeData> | null | undefined): boolean {
  if (!data || typeof data !== "object") return true;
  const hasName = !!(data.personalInfo?.fullName || "").trim();
  const hasEmail = !!(data.personalInfo?.email || "").trim();
  const hasSummary = !!(data.summary || "").trim();
  const hasExperience = Array.isArray(data.experience) && data.experience.length > 0;
  const hasEducation = Array.isArray(data.education) && data.education.length > 0;
  const hasProjects = Array.isArray(data.projects) && data.projects.length > 0;
  const hasSimpleSkills = Array.isArray(data.skills?.simple) && (data.skills!.simple as unknown[]).length > 0;
  const hasCategorizedSkills =
    Array.isArray(data.skills?.categorized) &&
    (data.skills!.categorized as { skills?: unknown[] }[]).some((c) => Array.isArray(c.skills) && c.skills.length > 0);
  return (
    !hasName && !hasEmail && !hasSummary && !hasExperience && !hasEducation && !hasProjects && !hasSimpleSkills && !hasCategorizedSkills
  );
}
