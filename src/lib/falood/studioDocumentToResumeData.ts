// Converts the "studio document" shape shared by application_resume_versions.content
// and base_resumes.content (see src/lib/ai/application-agents/finalResumeToStudioDocument.ts)
// into the ResumeData shape the Resumify-based chatbot studio
// (/falood/studio/tailor/[id], backed by falood_saved_applications) expects.
//
// This exists because that studio is a standalone, ported-in tool with its own
// data model (no candidate_id/application_id/workflow_id at all) - every other
// "open in studio" entry point across the app now routes through this
// converter + POST /api/falood/applications instead of the old
// /falood/studio/application and /falood/studio/base routes.

import {
  ResumeData,
  DEFAULT_COLORS,
  DEFAULT_PAGE_PADDING,
  DEFAULT_SECTIONS,
} from "@/components/falood/resumify/types/resume";

// Minimal shape covering both application_resume_versions.content and
// base_resumes.content - both are produced by finalResumeToStudioDocument
// (application-tailored) or hand-authored/CLI-built in the same shape (base).
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

// Base resumes in particular can predate this shape (hand-authored, CLI-built,
// or from an older version of the app) - `?? []` only guards null/undefined,
// not a wrong-but-truthy value (an object, a string) landing in a field this
// code assumes is an array. Confirmed live: "(t.skills ?? []).map is not a
// function" crashing the studio bridge for a real candidate's data. Every
// array field is read through this instead.
function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function studioDocumentToResumeData(doc: StudioDocumentLike | null | undefined): ResumeData {
  const d = doc && typeof doc === "object" ? doc : {};
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
  const mostRecentTitle = experience[0]?.jobTitle ?? "";

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
      jobTitle: mostRecentTitle,
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
    template: "tech-sidebar",
    pageFormat: "letter",
    fontSize: "medium",
    fontFamily: "Inter",
    pagePadding: DEFAULT_PAGE_PADDING,
  };
}
