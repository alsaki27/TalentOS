// Converts the multi-agent pipeline's FinalResumeV1 artifact into the
// ResumeDocument shape rendered by the Falood Application Resume Studio
// (/falood/studio/application/[applicationResumeId]).
//
// FinalResumeV1 carries only the AI-tailored content (summary/skills/
// experience/education/certifications/projects) plus QA metadata; it has no
// contact/header information. The candidate's header is preserved from the
// base resume content (already stored in the studio's ResumeDocument shape on
// base_resumes.content), so the transformer overlays the agent output on top
// of the base resume, keeping the header intact while regenerating the editable
// sections with stable IDs so the studio's section editors and A4 preview
// can address them by id.

import type { FinalResumeV1, ExperienceEntry } from "./schemas";
import { readBaseSummary, readResumeText } from "./resumeIntegrity";
import { pickResumePresentation, type ResumePresentation } from "@/lib/falood/resumePresentation";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import type { Education, Skills } from "@/components/falood/resumify/types/resume";
import type { ResumeCustomSection } from "@/lib/falood/types";

// FinalResumeV1's QA-only fields (appliedIssueIds, rejectedIssueIds,
// unresolvedWarnings, finalQaScore, exportReady, pageFit) are never read by
// this converter - only the 6 renderable content fields are. ResumeDraftV1
// (Resume Forge's output, what Hiring Panel actually has in hand before Final
// Polish ever runs) shares identical shapes for all 6, so narrowing the
// parameter type to this Pick lets Hiring Panel pass its draft straight
// through with no separate runtime adapter.
export type RenderableResumeContent = Pick<FinalResumeV1, "summary" | "skills" | "experience" | "education" | "certifications" | "projects">;

export interface ResumeDocumentHeader {
  fullName: string;
  jobTitle?: string;
  location?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface ResumeDocument extends Partial<ResumePresentation> {
  header: ResumeDocumentHeader;
  summary?: { id: string; text: string };
  skills: { id: string; name: string; skills: string[] }[];
  skillDisplayMode: Skills["mode"];
  experience: {
    id: string;
    title: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    isCurrent?: boolean;
    bullets: { id: string; text: string }[];
  }[];
  education: { id: string; degree: string; school: string; graduationDate?: string; gpa?: string; honors?: string }[];
  certifications?: { id: string; name: string; issuer?: string; date?: string }[];
  projects?: {
    id: string;
    title: string;
    description?: string;
    bullets: { id: string; text: string }[];
  }[];
  customSections?: ResumeCustomSection[];
}

let idCounter = 0;
function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function readHeader(baseContent: any): ResumeDocumentHeader {
  const raw = baseContent?.header ?? {};
  if (raw && typeof raw === "object" && typeof raw.fullName === "string") {
    return {
      fullName: raw.fullName,
      jobTitle: raw.jobTitle,
      location: raw.location ?? undefined,
      phone: raw.phone ?? undefined,
      email: raw.email ?? undefined,
      linkedin: raw.linkedin ?? undefined,
      github: raw.github ?? undefined,
      portfolio: raw.portfolio ?? raw.website ?? undefined,
    };
  }
  return {
    fullName: baseContent?.personalInfo?.fullName ?? "",
    jobTitle: baseContent?.personalInfo?.jobTitle,
    email: baseContent?.personalInfo?.email ?? undefined,
    phone: baseContent?.personalInfo?.phone ?? undefined,
    location: baseContent?.personalInfo?.location ?? undefined,
    linkedin: baseContent?.personalInfo?.linkedin ?? undefined,
    github: baseContent?.personalInfo?.github ?? undefined,
    portfolio: baseContent?.personalInfo?.website ?? baseContent?.personalInfo?.portfolio ?? undefined,
  };
}

const identityKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function mapExperience(entries: ExperienceEntry[], rawBaseExperience: unknown) {
  const base = Array.isArray(rawBaseExperience) ? rawBaseExperience : [];
  const savedSelections = entries.map((entry) => {
    const matches = base.filter((role) => role
      && identityKey(readResumeText(role.jobTitle ?? role.title)) === identityKey(entry.title)
      && identityKey(readResumeText(role.company)) === identityKey(entry.company));
    const exact = matches.filter((role) => identityKey(readResumeText(role.startDate)) === identityKey(entry.startDate ?? ""));
    const source = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
    return source?.isCurrent ?? source?.current;
  });
  const explicitlyCurrent = savedSelections.indexOf(true);
  const currentIndex = explicitlyCurrent >= 0 ? explicitlyCurrent : entries.findIndex((entry, index) =>
    savedSelections[index] !== false && identityKey(entry.endDate ?? "") === "present"
  );
  return entries.map((e, index) => {
    const isCurrent = index === currentIndex;
    return {
      id: uid("exp"),
      title: e.title,
      company: e.company,
      location: e.location ?? undefined,
      startDate: e.startDate ?? "",
      endDate: isCurrent || identityKey(e.endDate ?? "") === "present" ? undefined : e.endDate ?? undefined,
      isCurrent,
      bullets: e.bullets.map((b) => ({ id: uid("b"), text: b })),
    };
  });
}

function mapEducation(edu: FinalResumeV1["education"], baseEducation: Education[]) {
  return edu.map((e) => {
    const matches = baseEducation.filter((entry) =>
      identityKey(entry.degree) === identityKey(e.degree) && identityKey(entry.institution) === identityKey(e.school)
    );
    const exact = matches.filter((entry) => identityKey(entry.graduationYear) === identityKey(e.graduationDate ?? ""));
    const source = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
    return {
      id: uid("edu"),
      degree: e.degree,
      school: e.school,
      graduationDate: e.graduationDate ?? undefined,
      gpa: source?.gpa,
      honors: source?.honors,
    };
  });
}

function mapSkills(skills: FinalResumeV1["skills"], baseSkills: Skills) {
  if (skills.length > 0) {
    return skills.map((g) => ({ id: uid("skg"), name: (g as any).name ?? g.title, skills: [...g.skills] }));
  }
  if (baseSkills.mode === "simple") return [{ id: uid("skg"), name: "Skills", skills: baseSkills.simple }];
  return baseSkills.categorized.map((g) => ({
    id: uid("skg"),
    name: g.name,
    skills: Array.isArray(g?.skills) ? g.skills.filter((s: any) => typeof s === "string") : [],
  }));
}

function mapCertifications(certs: any[], baseContent: any) {
  const baseCerts: any[] = Array.isArray(baseContent?.certifications) ? baseContent.certifications : [];
  const out: { id: string; name: string; issuer?: string; date?: string }[] = [];
  for (const cert of certs) {
    const c = typeof cert === 'string' ? cert : (cert && cert.name ? String(cert.name) : "");
    if (!c) continue;
    const match = baseCerts.find((b) => b?.name && typeof b.name === 'string' && b.name.toLowerCase() === c.toLowerCase());
    out.push({
      id: uid("cert"),
      name: c,
      issuer: match?.issuer ?? undefined,
      date: match?.date ?? undefined,
    });
  }
  return out;
}

// Custom sections (certifications-style extras like Awards, Languages,
// Publications) are candidate-level facts, not job-tailored content - none of
// the 4 pipeline stages ever see or rewrite them, so they pass straight
// through from the base resume the same way readHeader() does. The base
// resume's editor stores them as either the older Resumify-native shape
// ({ content: string, type, visible }) or the canonical { bullets } shape
// depending on which editor last touched the row - handle both so a
// section written by either editor still renders here.
function mapCustomSections(baseContent: any): ResumeCustomSection[] {
  const raw: any[] = Array.isArray(baseContent?.customSections) ? baseContent.customSections : [];
  return raw
    .filter((s) => s && typeof s === "object" && s.visible !== false)
    .map((s, index) => {
      let bullets: { id: string; text: string }[];
      if (typeof s.content === "string" && s.content.trim()) {
        bullets = s.type === "paragraph"
          ? [{ id: uid("cs"), text: s.content.trim() }]
          : s.content.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean).map((text: string) => ({ id: uid("cs"), text }));
      } else if (Array.isArray(s.bullets) && s.bullets.length > 0) {
        bullets = s.bullets
          .map((b: any) => ({ id: uid("cs"), text: typeof b === "string" ? b : String(b?.text ?? "").trim() }))
          .filter((b: { id: string; text: string }) => b.text.length > 0);
      } else {
        bullets = [];
      }
      return {
        id: s.id || uid("cs"),
        title: String(s.title ?? "").trim() || "Additional Information",
        content: typeof s.content === "string" ? s.content : undefined,
        type: s.type === "paragraph" ? "paragraph" as const : "bullets" as const,
        placement: s.placement === "left" || s.placement === "right" ? s.placement : undefined,
        order: typeof s.order === "number" ? s.order : index,
        visible: true,
        bullets,
      };
    })
    .filter((s) => s.bullets.length > 0);
}

function mapProjects(projects: FinalResumeV1["projects"]) {
  return projects
    .filter((p) => p && typeof p.name === "string")
    .map((p) => {
      const techLine = Array.isArray(p.technologies) && p.technologies.length > 0 ? `Tech: ${p.technologies.join(", ")}` : "";
      const bullets: { id: string; text: string }[] = [];
      if (p.description) bullets.push({ id: uid("pb"), text: p.description });
      if (techLine) bullets.push({ id: uid("pb"), text: techLine });
      return {
        id: uid("proj"),
        title: p.name,
        description: p.description || undefined,
        bullets,
      };
    });
}

export function finalResumeToStudioDocument(final: RenderableResumeContent, baseContent: any): ResumeDocument {
  const base = baseContent && typeof baseContent === "object" ? baseContent : {};
  const editorBase = studioDocumentToResumeData(base);
  // Summary follows the base resume: the pipeline output wins when it has a
  // summary, the base resume's own summary is the fallback (truthful by
  // construction), and a base resume without one produces no summary block.
  const finalSummaryText = typeof final.summary === "string" ? final.summary.trim() : "";
  const summaryText = finalSummaryText.length > 0 ? final.summary : readBaseSummary(base);
  const summary = summaryText
    ? { id: uid("sum"), text: summaryText }
    : undefined;

  return {
    header: readHeader(base),
    summary,
    skills: mapSkills(final.skills, editorBase.skills),
    skillDisplayMode: editorBase.skills.mode,
    experience: mapExperience(final.experience, base.experience),
    education: mapEducation(final.education, editorBase.education),
    certifications: mapCertifications(final.certifications, base),
    projects: mapProjects(final.projects),
    customSections: mapCustomSections(base),
    pageFormat: editorBase.pageFormat,
    ...pickResumePresentation(base),
  };
}
