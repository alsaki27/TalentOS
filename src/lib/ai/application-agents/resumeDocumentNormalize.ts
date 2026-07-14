// Normalizes a candidate's base_resumes.content into the canonical
// ResumeDocument shape (src/lib/falood/types.ts) before it's handed to the
// Resume Forge / Final Polish agents, and backfills stable ids on whatever
// they hand back.
//
// base_resumes.content is confirmed (in production data, see comments atop
// src/lib/falood/studioDocumentToResumeData.ts) to be a mix of two shapes:
// the canonical ResumeDocument, and the Resumify studio's own native
// ResumeData shape (personalInfo/summary-as-string/skills.categorized/
// experience[].bulletPoints/education[].institution). Detected the same way
// studioDocumentToResumeData.ts does it: presence of personalInfo vs header.

import type {
  ResumeDocument,
  ResumeHeader,
  ResumeBullet,
  SkillSection,
  ExperienceBlock,
  EducationBlock,
  ProjectBlock,
  CertificationBlock,
  ResumeFormatting,
} from "@/lib/falood/types";

const DEFAULT_FORMATTING: ResumeFormatting = {
  styleId: "skarion_compact_professional",
  pageFormat: "letter",
  fontFamily: "Calibri",
  fontSize: 10.5,
  marginTop: 0.5,
  marginRight: 0.5,
  marginBottom: 0.5,
  marginLeft: 0.5,
  sectionSpacing: 8,
  bulletSpacing: 2,
  lineHeight: 1.15,
};

const FONT_SIZE_BY_LABEL: Record<string, number> = { small: 9.5, medium: 10.5, large: 11.5 };

let idCounter = 0;
function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function normalizeHeaderFromResumify(personalInfo: Record<string, unknown>): ResumeHeader {
  return {
    fullName: asString(personalInfo.fullName),
    location: personalInfo.location ? asString(personalInfo.location) : undefined,
    phone: personalInfo.phone ? asString(personalInfo.phone) : undefined,
    email: personalInfo.email ? asString(personalInfo.email) : undefined,
    linkedin: personalInfo.linkedin ? asString(personalInfo.linkedin) : undefined,
    github: personalInfo.github ? asString(personalInfo.github) : undefined,
    portfolio: personalInfo.website ? asString(personalInfo.website) : undefined,
  };
}

function normalizeSkillsFromResumify(skills: Record<string, unknown>): SkillSection[] {
  const categorized = asArray<any>(skills.categorized);
  if (categorized.length > 0) {
    return categorized.map((cat) => ({
      id: asString(cat?.id) || uid("skg"),
      title: asString(cat?.name) || "Skills",
      skills: asArray<string>(cat?.skills).filter((s) => typeof s === "string"),
    }));
  }
  const simple = asArray<string>(skills.simple);
  return simple.length > 0 ? [{ id: uid("skg"), title: "Skills", skills: simple }] : [];
}

function normalizeExperienceFromResumify(experience: unknown[]): ExperienceBlock[] {
  return experience.map((e: any) => ({
    id: asString(e?.id) || uid("exp"),
    title: asString(e?.jobTitle),
    company: asString(e?.company),
    location: e?.location ? asString(e.location) : undefined,
    startDate: asString(e?.startDate),
    endDate: e?.current ? undefined : (e?.endDate ? asString(e.endDate) : undefined),
    isCurrent: Boolean(e?.current),
    bullets: asArray<string>(e?.bulletPoints).map((text, i) => ({
      id: uid(`b-${i}`),
      text: asString(text),
    })),
  }));
}

function normalizeEducationFromResumify(education: unknown[]): EducationBlock[] {
  return education.map((e: any) => ({
    id: asString(e?.id) || uid("edu"),
    degree: asString(e?.degree),
    school: asString(e?.institution),
    location: e?.location ? asString(e.location) : undefined,
    graduationDate: e?.graduationYear ? asString(e.graduationYear) : undefined,
  }));
}

function normalizeProjectsFromResumify(projects: unknown[]): ProjectBlock[] {
  return projects.map((p: any) => ({
    id: asString(p?.id) || uid("proj"),
    name: asString(p?.title),
    description: p?.description ? asString(p.description) : undefined,
    technologies: asArray<string>(p?.technologies),
    bullets: [],
    url: p?.liveUrl ? asString(p.liveUrl) : (p?.githubUrl ? asString(p.githubUrl) : undefined),
  }));
}

function formattingFromResumify(d: Record<string, unknown>): ResumeFormatting {
  return {
    ...DEFAULT_FORMATTING,
    pageFormat: d.pageFormat === "a4" ? "a4" : "letter",
    fontFamily: asString(d.fontFamily) || DEFAULT_FORMATTING.fontFamily,
    fontSize: FONT_SIZE_BY_LABEL[asString(d.fontSize)] ?? DEFAULT_FORMATTING.fontSize,
    marginTop: typeof d.pagePadding === "number" ? d.pagePadding : DEFAULT_FORMATTING.marginTop,
    marginRight: typeof d.pagePadding === "number" ? d.pagePadding : DEFAULT_FORMATTING.marginRight,
    marginBottom: typeof d.pagePadding === "number" ? d.pagePadding : DEFAULT_FORMATTING.marginBottom,
    marginLeft: typeof d.pagePadding === "number" ? d.pagePadding : DEFAULT_FORMATTING.marginLeft,
  };
}

/** Converts the Resumify studio's native ResumeData shape into the canonical ResumeDocument. */
function fromResumifyNative(d: Record<string, unknown>): ResumeDocument {
  const personalInfo = asRecord(d.personalInfo);
  const summaryText = asString(d.summary).trim();
  const skills = asRecord(d.skills);

  return {
    header: normalizeHeaderFromResumify(personalInfo),
    summary: summaryText ? { id: uid("sum"), text: summaryText } : undefined,
    skills: normalizeSkillsFromResumify(skills),
    experience: normalizeExperienceFromResumify(asArray(d.experience)),
    projects: normalizeProjectsFromResumify(asArray(d.projects)),
    education: normalizeEducationFromResumify(asArray(d.education)),
    formatting: formattingFromResumify(d),
  };
}

/** Already-canonical ResumeDocument - fill in any missing pieces rather than re-mapping field names. */
function fromCanonical(d: Record<string, unknown>): ResumeDocument {
  const header = asRecord(d.header);
  const summary = asRecord(d.summary);
  return {
    header: {
      fullName: asString(header.fullName),
      location: header.location ? asString(header.location) : undefined,
      phone: header.phone ? asString(header.phone) : undefined,
      email: header.email ? asString(header.email) : undefined,
      linkedin: header.linkedin ? asString(header.linkedin) : undefined,
      github: header.github ? asString(header.github) : undefined,
      portfolio: header.portfolio ? asString(header.portfolio) : undefined,
    },
    summary: asString(summary.text).trim() ? { id: asString(summary.id) || uid("sum"), text: asString(summary.text) } : undefined,
    skills: asArray<any>(d.skills).map((g) => ({
      id: asString(g?.id) || uid("skg"),
      title: asString(g?.title) || "Skills",
      skills: asArray<string>(g?.skills),
    })),
    experience: asArray<any>(d.experience).map((e) => ({
      id: asString(e?.id) || uid("exp"),
      title: asString(e?.title),
      company: asString(e?.company),
      location: e?.location ? asString(e.location) : undefined,
      startDate: asString(e?.startDate),
      endDate: e?.endDate ? asString(e.endDate) : undefined,
      isCurrent: Boolean(e?.isCurrent),
      bullets: asArray<any>(e?.bullets).map((b) => ({
        id: asString(b?.id) || uid("b"),
        text: asString(b?.text),
        evidenceIds: Array.isArray(b?.evidenceIds) ? b.evidenceIds : undefined,
        confidenceScore: typeof b?.confidenceScore === "number" ? b.confidenceScore : undefined,
        riskLevel: ["low", "medium", "high"].includes(b?.riskLevel) ? b.riskLevel : undefined,
      })),
    })),
    projects: asArray<any>(d.projects).length > 0
      ? asArray<any>(d.projects).map((p) => ({
          id: asString(p?.id) || uid("proj"),
          name: asString(p?.name ?? p?.title),
          description: p?.description ? asString(p.description) : undefined,
          technologies: asArray<string>(p?.technologies),
          bullets: asArray<any>(p?.bullets).map((b) => ({ id: asString(b?.id) || uid("pb"), text: asString(b?.text) })),
          url: p?.url ? asString(p.url) : undefined,
        }))
      : undefined,
    education: asArray<any>(d.education).map((e) => ({
      id: asString(e?.id) || uid("edu"),
      degree: asString(e?.degree),
      school: asString(e?.school),
      location: e?.location ? asString(e.location) : undefined,
      graduationDate: e?.graduationDate ? asString(e.graduationDate) : undefined,
    })),
    certifications: asArray<any>(d.certifications).length > 0
      ? asArray<any>(d.certifications).map((c) => ({
          id: asString(c?.id) || uid("cert"),
          name: asString(c?.name),
          issuer: c?.issuer ? asString(c.issuer) : undefined,
          date: c?.date ? asString(c.date) : undefined,
        }))
      : undefined,
    customSections: asArray<any>(d.customSections).length > 0
      ? asArray<any>(d.customSections).map((c) => ({
          id: asString(c?.id) || uid("cs"),
          title: asString(c?.title),
          bullets: asArray<any>(c?.bullets).map((b) => ({ id: asString(b?.id) || uid("csb"), text: asString(b?.text) })),
        }))
      : undefined,
    formatting: asRecord(d.formatting).styleId
      ? { ...DEFAULT_FORMATTING, ...asRecord(d.formatting) } as ResumeFormatting
      : DEFAULT_FORMATTING,
  };
}

export function normalizeAnyContentToResumeDocument(content: unknown): ResumeDocument {
  const d = asRecord(content);
  if (d.personalInfo && typeof d.personalInfo === "object") {
    return fromResumifyNative(d);
  }
  return fromCanonical(d);
}

/**
 * Defense-in-depth pass over an AI-returned ResumeDocument: backfills any
 * missing or duplicate id so the Application Resume Studio's section editors
 * (which address items by id) and downstream stages never see a blank or
 * colliding id, even if the model dropped one despite being instructed to
 * preserve them.
 */
export function ensureResumeDocumentIds(doc: ResumeDocument): ResumeDocument {
  const seen = new Set<string>();
  function nextId(id: string | undefined, prefix: string): string {
    if (id && id.trim() && !seen.has(id)) {
      seen.add(id);
      return id;
    }
    let fresh = uid(prefix);
    while (seen.has(fresh)) fresh = uid(prefix);
    seen.add(fresh);
    return fresh;
  }
  function fixBullets(bullets: ResumeBullet[] | undefined, prefix: string): ResumeBullet[] {
    return (bullets ?? []).map((b) => ({ ...b, id: nextId(b?.id, prefix) }));
  }

  return {
    ...doc,
    summary: doc.summary ? { ...doc.summary, id: nextId(doc.summary.id, "sum") } : doc.summary,
    skills: (doc.skills ?? []).map((s) => ({ ...s, id: nextId(s?.id, "skg") })),
    experience: (doc.experience ?? []).map((e) => ({
      ...e,
      id: nextId(e?.id, "exp"),
      bullets: fixBullets(e?.bullets, "b"),
    })),
    projects: doc.projects
      ? doc.projects.map((p) => ({ ...p, id: nextId(p?.id, "proj"), bullets: fixBullets(p?.bullets, "pb") }))
      : doc.projects,
    education: (doc.education ?? []).map((e) => ({ ...e, id: nextId(e?.id, "edu") })),
    certifications: doc.certifications
      ? doc.certifications.map((c) => ({ ...c, id: nextId(c?.id, "cert") }))
      : doc.certifications,
    customSections: doc.customSections
      ? doc.customSections.map((c) => ({ ...c, id: nextId(c?.id, "cs"), bullets: fixBullets(c?.bullets, "csb") }))
      : doc.customSections,
  };
}
