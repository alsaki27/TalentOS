// Converts a candidate's stored resume content into the ResumeData shape
// the Resumify-based chatbot studio (/falood/studio/tailor/[id], backed by
// falood_saved_applications) expects.
//
// This exists because that studio is a standalone, ported-in tool with its own
// data model (no candidate_id/application_id/workflow_id at all) - every other
// "open in studio" entry point across the app now routes through this
// converter + POST /api/falood/applications/from-source instead of the old
// /falood/studio/application and /falood/studio/base routes.
//
// Two real content shapes exist in production data (confirmed live via a
// full sweep of every base resume): application_resume_versions.content is
// always the "studio document" shape produced by finalResumeToStudioDocument.ts
// (header/summary.text/skills-as-{title,skills}[]/experience-with-title+bullets/
// education-with-school+graduationDate) - but base_resumes.content is a 50/50
// split between that shape and the Resumify studio's OWN native ResumeData
// shape (personalInfo/summary-as-string/skills-as-{mode,simple,categorized}/
// experience-with-jobTitle+bulletPoints/education-with-institution+graduationYear) -
// base resumes built or edited directly in the Falood base-resume studio are
// already in that shape. Passing a Resumify-native document through the
// studio-document field mapping (title vs jobTitle, bullets vs bulletPoints,
// school vs institution, etc.) silently produced an almost-empty resume -
// every field read the wrong key and came back "". Detected via the
// personalInfo/header key split, which is mutually exclusive across every
// real record seen.

import {
  ResumeData,
  DEFAULT_COLORS,
  DEFAULT_PAGE_PADDING,
  DEFAULT_SECTIONS,
} from "@/components/falood/resumify/types/resume";

export interface StudioDocumentLike {
  header?: {
    fullName?: string;
    location?: string;
    phone?: string;
    email?: string;
    linkedin?: string;
    github?: string;
    portfolio?: string;
    website?: string;
  };
  summary?: { text?: string } | string | null;
  skills?: { title?: string; skills?: string[] }[];
  experience?: {
    title?: string;
    company?: string;
    location?: string;
    startDate?: string;
    endDate?: string;
    bullets?: { text?: string }[] | string[];
  }[];
  education?: { degree?: string; school?: string; graduationDate?: string; location?: string }[];
  certifications?: { name?: string; issuer?: string; date?: string }[];
  projects?: {
    title?: string;
    description?: string;
    bullets?: { text?: string }[] | string[];
  }[];
}

function bulletTexts(bullets: { text?: string }[] | string[] | undefined): string[] {
  if (!Array.isArray(bullets)) return [];
  return bullets
    .map((b) => (typeof b === "string" ? b : b?.text))
    .filter((t): t is string => typeof t === "string" && t.length > 0);
}

// `?? []` only guards null/undefined, not a wrong-but-truthy value (an
// object, a string) landing in a field this code assumes is an array.
// Confirmed live: "(t.skills ?? []).map is not a function" crashing the
// studio bridge for real candidate data. Every array field is read through
// this instead.
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Normalizes an already-Resumify-shaped document (personalInfo/jobTitle/bulletPoints/institution/...) - fills in any missing pieces rather than re-mapping field names. */
function normalizeResumifyNative(d: any): ResumeData {
  const personalInfo = d.personalInfo && typeof d.personalInfo === "object" ? d.personalInfo : {};
  const experience = asArray<any>(d.experience).map((e) => ({
    id: asString(e?.id) || uid("exp"),
    jobTitle: asString(e?.jobTitle),
    company: asString(e?.company),
    location: asString(e?.location),
    startDate: asString(e?.startDate),
    endDate: asString(e?.endDate),
    current: Boolean(e?.current),
    description: asString(e?.description),
    bulletPoints: asArray<string>(e?.bulletPoints),
  }));
  const education = asArray<any>(d.education).map((e) => ({
    id: asString(e?.id) || uid("edu"),
    degree: asString(e?.degree),
    institution: asString(e?.institution),
    location: asString(e?.location),
    graduationYear: asString(e?.graduationYear),
    gpa: e?.gpa ? asString(e.gpa) : undefined,
    honors: e?.honors ? asString(e.honors) : undefined,
  }));
  const projects = asArray<any>(d.projects).map((p) => ({
    id: asString(p?.id) || uid("proj"),
    title: asString(p?.title),
    description: asString(p?.description),
    technologies: asArray<string>(p?.technologies),
  }));
  const skillsRaw = d.skills && typeof d.skills === "object" && !Array.isArray(d.skills) ? d.skills : {};
  const categorized = asArray<any>(skillsRaw.categorized).map((g) => ({
    id: asString(g?.id) || uid("skg"),
    name: asString(g?.name) || "Skills",
    skills: asArray<string>(g?.skills),
  }));

  return {
    personalInfo: {
      fullName: asString(personalInfo.fullName),
      jobTitle: asString(personalInfo.jobTitle),
      email: asString(personalInfo.email),
      phone: asString(personalInfo.phone),
      location: asString(personalInfo.location),
      website: personalInfo.website ? asString(personalInfo.website) : undefined,
      linkedin: personalInfo.linkedin ? asString(personalInfo.linkedin) : undefined,
      github: personalInfo.github ? asString(personalInfo.github) : undefined,
    },
    summary: asString(d.summary),
    experience,
    education,
    projects,
    skills: {
      mode: skillsRaw.mode === "simple" ? "simple" : "categorized",
      simple: asArray<string>(skillsRaw.simple),
      categorized,
    },
    customSections: asArray<any>(d.customSections).map((c) => ({
      id: asString(c?.id) || uid("cs"),
      title: asString(c?.title),
      content: asString(c?.content),
      type: c?.type === "paragraph" ? "paragraph" : "bullets",
      visible: c?.visible !== false,
      order: typeof c?.order === "number" ? c.order : DEFAULT_SECTIONS.length + 1,
      placement: c?.placement === "left" || c?.placement === "right" ? c.placement : undefined,
    })),
    sections: asArray<any>(d.sections).length > 0 ? d.sections : DEFAULT_SECTIONS,
    colors: d.colors && typeof d.colors === "object" ? d.colors : DEFAULT_COLORS,
    template: typeof d.template === "string" ? d.template : "business-professional",
    pageFormat: d.pageFormat === "a4" ? "a4" : "letter",
    fontSize: ["small", "large"].includes(d.fontSize) ? d.fontSize : "medium",
    fontFamily: asString(d.fontFamily) || "Inter",
    pagePadding: typeof d.pagePadding === "number" ? d.pagePadding : DEFAULT_PAGE_PADDING,
  };
}

/** Converts the AI-pipeline "studio document" shape (header/summary.text/skills-as-groups/...). */
function convertStudioDocument(d: StudioDocumentLike): ResumeData {
  const header = d.header && typeof d.header === "object" ? d.header : {};

  const summaryText = typeof d.summary === "string" ? d.summary : d.summary?.text ?? "";

  const experience = asArray<NonNullable<StudioDocumentLike["experience"]>[number]>(d.experience).map((e) => ({
    id: uid("exp"),
    jobTitle: e?.title ?? "",
    company: e?.company ?? "",
    location: e?.location ?? "",
    startDate: e?.startDate ?? "",
    endDate: e?.endDate ?? "",
    current: !e?.endDate,
    description: "",
    bulletPoints: bulletTexts(e?.bullets),
  }));
  const education = asArray<NonNullable<StudioDocumentLike["education"]>[number]>(d.education).map((e) => ({
    id: uid("edu"),
    degree: e?.degree ?? "",
    institution: e?.school ?? "",
    location: e?.location ?? "",
    graduationYear: e?.graduationDate ?? "",
  }));

  const projects = asArray<NonNullable<StudioDocumentLike["projects"]>[number]>(d.projects).map((p) => ({
    id: uid("proj"),
    title: p?.title ?? "",
    description: p?.description ?? "",
    technologies: [] as string[],
  }));

  const skillGroups = asArray<NonNullable<StudioDocumentLike["skills"]>[number]>(d.skills);
  const categorized = skillGroups.map((g) => ({
    id: uid("skg"),
    name: g?.title ?? "Skills",
    skills: asArray<string>(g?.skills),
  }));

  const customSections: ResumeData["customSections"] = [];
  const certifications = asArray<NonNullable<StudioDocumentLike["certifications"]>[number]>(d.certifications);
  if (certifications.length > 0) {
    customSections.push({
      id: uid("cs"),
      title: "Certifications",
      content: certifications.map((c) => [c?.name, c?.issuer, c?.date].filter(Boolean).join(" — ")).join("\n"),
      type: "bullets",
      visible: true,
      order: DEFAULT_SECTIONS.length + 1,
    });
  }

  return {
    personalInfo: {
      fullName: header.fullName ?? "",
      jobTitle: "",
      email: header.email ?? "",
      phone: header.phone ?? "",
      location: header.location ?? "",
      website: header.portfolio ?? header.website ?? undefined,
      linkedin: header.linkedin ?? undefined,
      github: header.github ?? undefined,
    },
    summary: summaryText,
    experience,
    education,
    projects,
    skills: {
      mode: categorized.length > 1 ? "categorized" : "simple",
      simple: categorized.length <= 1 ? categorized[0]?.skills ?? [] : [],
      categorized,
    },
    customSections,
    sections: DEFAULT_SECTIONS,
    colors: DEFAULT_COLORS,
    template: "business-professional",
    pageFormat: "letter",
    fontSize: "medium",
    fontFamily: "Inter",
    pagePadding: DEFAULT_PAGE_PADDING,
  };
}

export function studioDocumentToResumeData(doc: StudioDocumentLike | null | undefined): ResumeData {
  const d: any = doc && typeof doc === "object" ? doc : {};
  if (d.personalInfo && typeof d.personalInfo === "object") {
    return normalizeResumifyNative(d);
  }
  return convertStudioDocument(d as StudioDocumentLike);
}
