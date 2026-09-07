// src/lib/falood/resumeDocumentAdapters.ts
// Framework-agnostic ResumeDocument shape adapters — no "use client" directive,
// safe to import from both browser code (clientExport.tsx) and server/Worker
// code (the AI agent stages, which need to render a draft to measure real
// page-fit metrics before it's ever shown to a user).
//
// Several resume-studio pages and the AI pipeline's own
// finalResumeToStudioDocument() predate (or diverge from) the canonical
// ResumeDocument type in types.ts and have their own slightly different local
// shape for the same underlying JSONB content: missing `formatting` entirely,
// `projects[].title` instead of `.name`, and skills keyed by `name` instead of
// `title`. skarionPdfDocument.tsx's renderer reads `.title` for both projects
// and skills and requires `formatting` to be present — passing an
// unnormalized studio-document straight to it throws (missing formatting) or
// silently renders blank skill-category labels (name/title drift). This file
// is the one place that drift gets reconciled so every render call site can
// pass whatever shape it has without its own adapter.

import { ResumeDocument, ResumeFormatting } from "@/lib/falood/types";

export const DEFAULT_FORMATTING: ResumeFormatting = {
  styleId: "default",
  pageFormat: "a4",
  fontFamily: "Helvetica",
  fontSize: 10.5,
  marginTop: 0.5,
  marginRight: 0.5,
  marginBottom: 0.5,
  marginLeft: 0.5,
  sectionSpacing: 5,
  bulletSpacing: 1,
  lineHeight: 1.15,
};

export function normalizeResumeContentForExport(content: any): ResumeDocument {
  return {
    ...content,
    formatting: { ...DEFAULT_FORMATTING, ...(content.formatting ?? {}) },
    skills: (content.skills ?? []).map((s: any) => ({
      ...s,
      title: s.title ?? s.name ?? "Skills",
    })),
    projects: (content.projects ?? []).map((p: any) => ({
      ...p,
      name: p.name ?? p.title ?? "",
    })),
  };
}

/** Converts the legacy Resumify editor shape into the canonical PDF document shape. */
export function resumifyResumeDataToExportDocument(data: any): ResumeDocument {
  const personalInfo = data?.personalInfo ?? {};
  const skills = data?.skills ?? {};
  const groups = Array.isArray(skills.categorized) ? skills.categorized : [];
  const simpleSkills = Array.isArray(skills.simple) ? skills.simple : [];
  const skillSections = groups.length > 0
    ? groups.map((group: any, index: number) => ({
        id: group?.id || `skill-${index}`,
        title: group?.name || "Skills",
        skills: Array.isArray(group?.skills) ? group.skills : [],
      }))
    : [{ id: "skills", title: "Skills", skills: simpleSkills }];

  return normalizeResumeContentForExport({
    header: {
      fullName: typeof personalInfo.fullName === "string" ? personalInfo.fullName : "",
      location: personalInfo.location,
      phone: personalInfo.phone,
      email: personalInfo.email,
      linkedin: personalInfo.linkedin,
      github: personalInfo.github,
      portfolio: personalInfo.website,
    },
    summary: typeof data?.summary === "string" && data.summary.trim()
      ? { id: "summary", text: data.summary }
      : undefined,
    skills: skillSections,
    experience: Array.isArray(data?.experience) ? data.experience.map((entry: any, index: number) => ({
      id: entry?.id || `experience-${index}`,
      title: entry?.jobTitle || "",
      company: entry?.company || "",
      location: entry?.location,
      startDate: entry?.startDate || "",
      endDate: entry?.current ? undefined : entry?.endDate,
      bullets: (Array.isArray(entry?.bulletPoints) ? entry.bulletPoints : []).map((text: unknown, bulletIndex: number) => ({
        id: `experience-${index}-bullet-${bulletIndex}`,
        text: typeof text === "string" ? text : "",
      })),
    })) : [],
    education: Array.isArray(data?.education) ? data.education.map((entry: any, index: number) => ({
      id: entry?.id || `education-${index}`,
      degree: entry?.degree || "",
      school: entry?.institution || "",
      location: entry?.location,
      graduationDate: entry?.graduationYear,
    })) : [],
    projects: Array.isArray(data?.projects) ? data.projects.map((entry: any, index: number) => ({
      id: entry?.id || `project-${index}`,
      title: entry?.title || "",
      description: entry?.description,
      bullets: [],
      technologies: Array.isArray(entry?.technologies) ? entry.technologies : [],
    })) : [],
    customSections: Array.isArray(data?.customSections) ? data.customSections.map((section: any, index: number) => ({
      id: section?.id || `custom-${index}`,
      title: section?.title || "Additional Information",
      bullets: String(section?.content || "").split(/\r?\n/).filter(Boolean).map((text, bulletIndex) => ({
        id: `custom-${index}-bullet-${bulletIndex}`,
        text,
      })),
    })) : [],
    certifications: [],
    formatting: {
      pageFormat: data?.pageFormat === "letter" ? "letter" : "a4",
      fontFamily: typeof data?.fontFamily === "string" ? data.fontFamily : "Inter",
      fontSize: typeof data?.fontSize === "number" ? data.fontSize : 10,
      marginTop: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      marginRight: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      marginBottom: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      marginLeft: typeof data?.pagePadding === "number" ? data.pagePadding : 0.5,
      styleId: "resumify-version",
      sectionSpacing: 5,
      bulletSpacing: 1,
      lineHeight: 1.15,
    },
  });
}

/**
 * Applies the Resumify editor's full, current state to a base resume without
 * leaving an older representation of the same editable data behind.
 *
 * Base resumes exist in two shapes in production. Older rows use the
 * canonical ResumeDocument shape, while rows created by the base-resume
 * editor use Resumify's native shape. Preserve the row's shape so existing
 * consumers keep seeing the format they already understand.
 *
 * Certifications need special handling. Canonical certifications are shown
 * in Resumify as a custom section. Once the editor saves, that custom section
 * is the authoritative representation, so the legacy certifications array
 * must be cleared. Otherwise deleting the visible Certifications section only
 * removes customSections; the hidden legacy array recreates it on reopen.
 */
export function mergeResumifyEditorIntoBaseResume(
  existingContent: unknown,
  resumeData: any,
): Record<string, unknown> {
  const existing = existingContent && typeof existingContent === "object" && !Array.isArray(existingContent)
    ? existingContent as Record<string, unknown>
    : {};
  const rawResumeData = resumeData && typeof resumeData === "object" && !Array.isArray(resumeData)
    ? resumeData as Record<string, unknown>
    : {};
  const hasCustomSections = Object.prototype.hasOwnProperty.call(rawResumeData, "customSections");
  const rawCustomSections = Array.isArray(rawResumeData.customSections)
    ? rawResumeData.customSections
    : [];

  // Rows already in the editor-native shape must stay editor-native. Mixing
  // canonical experience/skills into a document that still has personalInfo
  // makes the loader choose the native parser and then read the wrong keys.
  if (existing.personalInfo && typeof existing.personalInfo === "object") {
    return {
      ...existing,
      ...rawResumeData,
      ...(hasCustomSections ? { customSections: rawCustomSections, certifications: [] } : {}),
    };
  }

  const converted = resumifyResumeDataToExportDocument(rawResumeData);
  return {
    ...existing,
    header: converted.header,
    summary: converted.summary,
    skills: converted.skills,
    experience: converted.experience,
    education: converted.education,
    projects: converted.projects,
    ...(hasCustomSections ? { customSections: rawCustomSections, certifications: [] } : {}),
  };
}
