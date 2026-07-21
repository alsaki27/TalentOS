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
  skills: { id: string; title: string; skills: string[] }[];
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
  return entries.map((e) => ({
    id: uid("exp"),
    title: e.title,
    company: e.company,
    location: e.location ?? undefined,
    startDate: e.startDate ?? "",
    endDate: e.endDate ?? undefined,
    bullets: e.bullets.map((b) => ({ id: uid("b"), text: b })),
  }));
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
    return skills.map((g) => ({ id: uid("skg"), title: g.title, skills: [...g.skills] }));
  }
  // Fall back to the base resume's own categorized groups only if the agent pipeline
  // returned nothing at all (e.g. an older run predating the categorized-skills fix).
  const baseSkills: any[] = Array.isArray(baseContent?.skills) ? baseContent.skills : [];
  return baseSkills.map((g) => ({
    id: uid("skg"),
    title: g?.title ?? "Skills",
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

export function finalResumeToStudioDocument(final: FinalResumeV1, baseContent: any): ResumeDocument {
  const base = baseContent && typeof baseContent === "object" ? baseContent : {};
  const summary = final.summary && final.summary.trim().length > 0
    ? { id: uid("sum"), text: final.summary }
    : undefined;

  return {
    header: readHeader(base),
    summary,
    skills: mapSkills(final.skills, base),
    experience: mapExperience(final.experience),
    education: mapEducation(final.education),
    certifications: mapCertifications(final.certifications, base),
    projects: mapProjects(final.projects),
  };
}