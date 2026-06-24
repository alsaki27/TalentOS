import type {
  ResumeDocument,
  ExperienceBlock,
  EducationBlock,
  SkillSection,
  ProjectBlock,
  CertificationBlock,
  ResumeCustomSection,
} from "@/lib/falood/types";

// ─── Helpers ───

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// ─── Content Commands ───

export function addExperience(content: ResumeDocument): ResumeDocument {
  const newExp: ExperienceBlock = {
    id: uid(),
    title: "New Position",
    company: "Company Name",
    startDate: new Date().getFullYear().toString(),
    bullets: [
      { id: uid(), text: "Describe your responsibilities and achievements here." },
    ],
  };
  return { ...content, experience: [...content.experience, newExp] };
}

export function addEducation(content: ResumeDocument): ResumeDocument {
  const newEdu: EducationBlock = {
    id: uid(),
    degree: "Degree",
    school: "School Name",
  };
  return { ...content, education: [...content.education, newEdu] };
}

export function addSkillSection(content: ResumeDocument): ResumeDocument {
  const newSection: SkillSection = {
    id: uid(),
    title: "New Category",
    skills: [],
  };
  return { ...content, skills: [...content.skills, newSection] };
}

export function addProject(content: ResumeDocument): ResumeDocument {
  const newProj: ProjectBlock = {
    id: uid(),
    name: "New Project",
    bullets: [
      { id: uid(), text: "Describe the project and your contributions." },
    ],
  };
  return { ...content, projects: [...(content.projects ?? []), newProj] };
}

export function addCertification(content: ResumeDocument): ResumeDocument {
  const newCert: CertificationBlock = {
    id: uid(),
    name: "Certification Name",
  };
  return { ...content, certifications: [...(content.certifications ?? []), newCert] };
}

export function addCustomSection(content: ResumeDocument): ResumeDocument {
  const newSection: ResumeCustomSection = {
    id: uid(),
    title: "Custom Section",
    bullets: [{ id: uid(), text: "Add your content here." }],
  };
  return { ...content, customSections: [...(content.customSections ?? []), newSection] };
}

export function sortSkills(content: ResumeDocument): ResumeDocument {
  return {
    ...content,
    skills: content.skills.map((section) => ({
      ...section,
      skills: [...section.skills].sort((a, b) => a.localeCompare(b)),
    })),
  };
}

export function removeEmptySections(content: ResumeDocument): ResumeDocument {
  return {
    ...content,
    summary: content.summary?.text?.trim() ? content.summary : undefined,
    skills: content.skills
      .filter((s) => s.title.trim() || s.skills.length > 0)
      .map((s) => ({ ...s, skills: s.skills.filter((sk) => sk.trim()) })),
    experience: content.experience
      .filter((e) => e.title.trim() || e.company.trim() || e.bullets.length > 0)
      .map((e) => ({
        ...e,
        bullets: e.bullets.filter((b) => b.text.trim()),
      })),
    projects: (content.projects ?? [])
      .filter((p) => p.name.trim() || p.bullets.length > 0)
      .map((p) => ({
        ...p,
        bullets: p.bullets.filter((b) => b.text.trim()),
      })),
    education: content.education.filter((e) => e.degree.trim() || e.school.trim()),
    certifications: (content.certifications ?? []).filter((c) => c.name.trim()),
    customSections: (content.customSections ?? [])
      .filter((s) => s.title.trim() || s.bullets.length > 0)
      .map((s) => ({
        ...s,
        bullets: s.bullets.filter((b) => b.text.trim()),
      })),
  };
}

export function formatResume(content: ResumeDocument): ResumeDocument {
  // Deep clone to ensure clean formatting
  return JSON.parse(JSON.stringify(content));
}

export function estimatePages(content: ResumeDocument): number {
  const text = JSON.stringify(content);
  // Rough heuristic: ~2800 chars ≈ 1 page for a dense resume
  return Math.max(1, Math.round((text.length / 2800) * 10) / 10);
}

export function pageStatus(content: ResumeDocument): { label: string; color: string } {
  const pages = estimatePages(content);
  if (pages <= 1) return { label: `1 page — good`, color: "var(--accent)" };
  if (pages <= 1.2) return { label: `${pages.toFixed(1)} pages — close`, color: "var(--warn)" };
  return { label: `${pages.toFixed(1)} pages — over`, color: "var(--danger)" };
}

// ─── Diff ───

export interface DiffItem {
  path: string;
  type: "added" | "removed" | "modified" | "unchanged";
  oldValue?: unknown;
  newValue?: unknown;
}

function diffValue(a: unknown, b: unknown, path: string): DiffItem[] {
  if (a === b) return [];

  if (Array.isArray(a) && Array.isArray(b)) {
    const items: DiffItem[] = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= a.length) {
        items.push({ path: `${path}[${i}]`, type: "added", newValue: b[i] });
      } else if (i >= b.length) {
        items.push({ path: `${path}[${i}]`, type: "removed", oldValue: a[i] });
      } else {
        items.push(...diffValue(a[i], b[i], `${path}[${i}]`));
      }
    }
    return items;
  }

  if (a && b && typeof a === "object" && typeof b === "object") {
    const items: DiffItem[] = [];
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of keys) {
      const hasA = key in (a as object);
      const hasB = key in (b as object);
      if (!hasA) {
        items.push({
          path: `${path}.${key}`,
          type: "added",
          newValue: (b as Record<string, unknown>)[key],
        });
      } else if (!hasB) {
        items.push({
          path: `${path}.${key}`,
          type: "removed",
          oldValue: (a as Record<string, unknown>)[key],
        });
      } else {
        items.push(
          ...diffValue(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key],
            `${path}.${key}`,
          ),
        );
      }
    }
    return items;
  }

  return [{ path, type: "modified", oldValue: a, newValue: b }];
}

export function diffResume(original: ResumeDocument, current: ResumeDocument): DiffItem[] {
  return diffValue(original, current, "root");
}

// ─── Command Palette ───

export interface EditorCommand {
  id: string;
  label: string;
  type: "modify" | "ui";
}

export const EDITOR_COMMANDS: EditorCommand[] = [
  { id: "add-experience", label: "Add Experience", type: "modify" },
  { id: "add-education", label: "Add Education", type: "modify" },
  { id: "add-skill-section", label: "Add Skill Section", type: "modify" },
  { id: "add-project", label: "Add Project", type: "modify" },
  { id: "add-certification", label: "Add Certification", type: "modify" },
  { id: "add-custom-section", label: "Add Custom Section", type: "modify" },
  { id: "sort-skills", label: "Sort Skills Alphabetically", type: "modify" },
  { id: "remove-empty", label: "Remove Empty Sections", type: "modify" },
  { id: "format", label: "Format JSON", type: "ui" },
  { id: "one-page", label: "Show Page Estimate", type: "ui" },
  { id: "diff", label: "Toggle Diff View", type: "ui" },
  { id: "reset", label: "Reset to Original", type: "ui" },
];

export function executeCommand(commandId: string, content: ResumeDocument): ResumeDocument {
  switch (commandId) {
    case "add-experience":
      return addExperience(content);
    case "add-education":
      return addEducation(content);
    case "add-skill-section":
      return addSkillSection(content);
    case "add-project":
      return addProject(content);
    case "add-certification":
      return addCertification(content);
    case "add-custom-section":
      return addCustomSection(content);
    case "sort-skills":
      return sortSkills(content);
    case "remove-empty":
      return removeEmptySections(content);
    default:
      return content;
  }
}

export function isValidResume(obj: unknown): obj is ResumeDocument {
  if (!obj || typeof obj !== "object") return false;
  const doc = obj as Record<string, unknown>;

  if (!doc.header || typeof doc.header !== "object") return false;
  const header = doc.header as Record<string, unknown>;
  if (typeof header.fullName !== "string") return false;

  if (!Array.isArray(doc.skills)) return false;
  if (!Array.isArray(doc.experience)) return false;
  if (!Array.isArray(doc.education)) return false;

  if (!doc.formatting || typeof doc.formatting !== "object") return false;
  const formatting = doc.formatting as Record<string, unknown>;
  if (typeof formatting.styleId !== "string") return false;
  if (typeof formatting.fontFamily !== "string") return false;
  if (typeof formatting.fontSize !== "number") return false;

  return true;
}
