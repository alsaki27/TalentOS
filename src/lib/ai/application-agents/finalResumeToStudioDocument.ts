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
import { readBaseSummary } from "./resumeIntegrity";

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
  location?: string;
  phone?: string;
  email?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface ResumeDocument {
  header: ResumeDocumentHeader;
  summary?: { id: string; text: string };
  skills: { id: string; name: string; skills: string[] }[];
  experience: {
    id: string;
    title: string;
    company: string;
    location?: string;
    startDate: string;
    endDate?: string;
    bullets: { id: string; text: string }[];
  }[];
  education: { id: string; degree: string; school: string; graduationDate?: string }[];
  certifications?: { id: string; name: string; issuer?: string; date?: string }[];
  projects?: {
    id: string;
    title: string;
    description?: string;
    bullets: { id: string; text: string }[];
  }[];
  customSections?: {
    id: string;
    title: string;
    bullets: { id: string; text: string }[];
  }[];
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
    email: baseContent?.personalInfo?.email ?? undefined,
    phone: baseContent?.personalInfo?.phone ?? undefined,
    location: baseContent?.personalInfo?.location ?? undefined,
    linkedin: baseContent?.personalInfo?.linkedin ?? undefined,
    github: baseContent?.personalInfo?.github ?? undefined,
    portfolio: baseContent?.personalInfo?.website ?? baseContent?.personalInfo?.portfolio ?? undefined,
  };
}

function mapExperience(entries: ExperienceEntry[]) {
  return entries.map((e) => {
    const isCurrent = !e.endDate || e.endDate.trim().toLowerCase() === "present";
    return {
      id: uid("exp"),
      title: e.title,
      company: e.company,
      location: e.location ?? undefined,
      startDate: e.startDate ?? "",
      endDate: isCurrent ? undefined : (e.endDate ?? undefined),
      isCurrent,
      bullets: e.bullets.map((b) => ({ id: uid("b"), text: b })),
    };
  });
}

function mapEducation(edu: FinalResumeV1["education"]) {
  return edu.map((e) => ({
    id: uid("edu"),
    degree: e.degree,
    school: e.school,
    graduationDate: e.graduationDate ?? undefined,
  }));
}

function mapSkills(skills: FinalResumeV1["skills"], baseContent: any) {
  if (skills.length > 0) {
    return skills.map((g) => ({ id: uid("skg"), name: (g as any).name ?? g.title, skills: [...g.skills] }));
  }
  // Fall back to the base resume's own categorized groups only if the agent pipeline
  // returned nothing at all (e.g. an older run predating the categorized-skills fix).
  const baseSkills: any[] = Array.isArray(baseContent?.skills) 
    ? baseContent.skills 
    : (Array.isArray(baseContent?.skills?.categorized) ? baseContent.skills.categorized : []);
  
  return baseSkills.map((g) => ({
    id: uid("skg"),
    name: g?.name ?? g?.title ?? "Skills",
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
function mapCustomSections(baseContent: any): { id: string; title: string; bullets: { id: string; text: string }[] }[] {
  const raw: any[] = Array.isArray(baseContent?.customSections) ? baseContent.customSections : [];
  return raw
    .filter((s) => s && typeof s === "object" && s.visible !== false)
    .map((s) => {
      let bullets: { id: string; text: string }[];
      if (Array.isArray(s.bullets) && s.bullets.length > 0) {
        bullets = s.bullets
          .map((b: any) => ({ id: uid("cs"), text: typeof b === "string" ? b : String(b?.text ?? "").trim() }))
          .filter((b: { id: string; text: string }) => b.text.length > 0);
      } else if (typeof s.content === "string" && s.content.trim()) {
        bullets = s.type === "paragraph"
          ? [{ id: uid("cs"), text: s.content.trim() }]
          : s.content.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean).map((text: string) => ({ id: uid("cs"), text }));
      } else {
        bullets = [];
      }
      return { id: uid("cs"), title: String(s.title ?? "").trim() || "Additional Information", bullets };
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
    skills: mapSkills(final.skills, base),
    experience: mapExperience(final.experience),
    education: mapEducation(final.education),
    certifications: mapCertifications(final.certifications, base),
    projects: mapProjects(final.projects),
    customSections: mapCustomSections(base),
  };
}