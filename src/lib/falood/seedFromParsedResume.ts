import type { ParsedResume } from "@/lib/resumeParsing";
import type {
  CertificationBlock,
  EducationBlock,
  ExperienceBlock,
  ProjectBlock,
  ResumeBullet,
  ResumeCustomSection,
  ResumeDocument,
  ResumeFormatting,
  SkillSection,
} from "@/lib/falood/types";

// #region debug-point D:seed-builder-debug
function reportSeedBuilderDebug(
  hypothesisId: "A" | "B" | "C" | "D" | "E",
  msg: string,
  data: Record<string, unknown> = {}
) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "base-resume-load-loop",
      runId: "pre-fix",
      hypothesisId,
      location: "src/lib/falood/seedFromParsedResume.ts",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

type CandidateSeedInfo = {
  name: string;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  portfolio_url?: string | null;
};

type ParsedResumeLike = Partial<ParsedResume> & Record<string, unknown>;

const KNOWN_PARSED_KEYS = new Set([
  "name",
  "email",
  "phone",
  "location",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "summary",
  "skills",
  "experience",
  "education",
  "certifications",
  "projects",
  "customSections",
  "header",
  "personalInfo",
  "formatting",
  "raw_text",
  "sections",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toLineArray(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s*-]+/, "").trim())
      .filter(Boolean);
  }

  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (typeof item === "number" || typeof item === "boolean") return String(item);
      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

function makeBullet(id: string, text: string): ResumeBullet | null {
  const trimmed = text.trim();
  return trimmed ? { id, text: trimmed } : null;
}

function buildBulletsFromUnknown(value: unknown, prefix: string): ResumeBullet[] {
  const record = asRecord(value);
  if (typeof value === "string") {
    return toLineArray(value)
      .map((line, index) => makeBullet(`${prefix}-${index}`, line))
      .filter((bullet): bullet is ResumeBullet => Boolean(bullet));
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => buildBulletsFromUnknown(item, `${prefix}-${index}`));
  }

  if (!record) return [];

  if (Array.isArray(record.bullets)) {
    const heading = [
      asTrimmedString(record.title),
      asTrimmedString(record.name),
      asTrimmedString(record.role),
      asTrimmedString(record.company),
      asTrimmedString(record.organization),
      asTrimmedString(record.date),
    ]
      .filter(Boolean)
      .join(" | ");
    const headingBullet = heading ? [makeBullet(`${prefix}-heading`, heading)].filter((bullet): bullet is ResumeBullet => Boolean(bullet)) : [];
    return [
      ...headingBullet,
      ...buildBulletsFromUnknown(record.bullets, `${prefix}-bullets`),
    ];
  }

  if (typeof record.content === "string") {
    return buildBulletsFromUnknown(record.content, `${prefix}-content`);
  }

  const scalarValues = [
    "title",
    "name",
    "label",
    "role",
    "position",
    "company",
    "organization",
    "school",
    "issuer",
    "degree",
    "subtitle",
    "date",
    "year",
    "location",
    "description",
    "summary",
    "text",
    "url",
  ]
    .map((key) => asTrimmedString(record[key]))
    .filter(Boolean) as string[];

  if (scalarValues.length > 0) {
    return [makeBullet(`${prefix}-0`, scalarValues.join(" | "))].filter((bullet): bullet is ResumeBullet => Boolean(bullet));
  }

  return [];
}

function humanizeKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function splitSkillItems(value: string): string[] {
  const items: string[] = [];
  let current = "";
  let nestingDepth = 0;

  for (const char of value) {
    if (char === "(" || char === "[" || char === "{") {
      nestingDepth += 1;
      current += char;
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      nestingDepth = Math.max(0, nestingDepth - 1);
      current += char;
      continue;
    }

    const isSeparator =
      nestingDepth === 0 &&
      (char === "," ||
        char === ";" ||
        char === "|" ||
        char === "\n" ||
        char === "\r" ||
        /[•●▪◦]/.test(char));

    if (isSeparator) {
      const item = current.trim();
      if (item) items.push(item);
      current = "";
      continue;
    }

    current += char;
  }

  const finalItem = current.trim();
  if (finalItem) items.push(finalItem);

  return items;
}

// Words that are clearly fragments of compound skill/category names, not real titles.
const FRAGMENT_CATEGORY_TITLES = new Set([
  "as", "xgs", "detail", "cross", "skills", "engineering",
  "communication", "design", "technical", "analytical",
  "pon", "built", "oriented", "functional",
]);

function isValidCategoryTitle(title: string): boolean {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 3) return false;
  // Reject single-word fragment titles
  if (FRAGMENT_CATEGORY_TITLES.has(normalized.toLowerCase())) return false;
  // A real category title should be at least 2 words or 10+ chars
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount < 2 && normalized.length < 10) return false;
  return true;
}

function splitCategorizedSkillEntry(value: string): { title: string; content: string } | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const colonIndex = normalized.indexOf(":");
  const dashIndex = normalized.indexOf(" - ");

  let separatorIndex = -1;
  let separatorLength = 0;

  if (colonIndex !== -1 && (dashIndex === -1 || colonIndex < dashIndex)) {
    separatorIndex = colonIndex;
    separatorLength = 1;
  } else if (dashIndex !== -1) {
    separatorIndex = dashIndex;
    separatorLength = 3;
  }

  if (separatorIndex === -1) return null;

  const title = normalized.slice(0, separatorIndex).trim();
  const content = normalized.slice(separatorIndex + separatorLength).trim();
  if (!title || !content) return null;

  return { title, content };
}

function parseCategorizedSkillString(value: string, indexPrefix: number): SkillSection[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const directEntry = splitCategorizedSkillEntry(trimmed);
  if (directEntry && isValidCategoryTitle(directEntry.title)) {
    const directSkills = splitSkillItems(directEntry.content);
    return directSkills.length > 0
      ? [{
          id: `skills-${indexPrefix}-1`,
          title: directEntry.title,
          skills: directSkills,
        }]
      : [];
  }

  let segments = trimmed
    .replace(/[•●▪◦]/g, "\n")
    .split(/\r?\n|\s+\|\s+|\s*;\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const labelMatches = trimmed.match(/\b[A-Za-z][A-Za-z0-9,&+/\- ]{2,80}:\s/g) ?? [];
  if (segments.length <= 1 && labelMatches.length > 1) {
    segments = trimmed
      .split(/(?=\b[A-Za-z][A-Za-z0-9,&+/\- ]{2,80}:\s)/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  return segments
    .map((segment, segmentIndex) => {
      const entry = splitCategorizedSkillEntry(segment);
      if (!entry || !isValidCategoryTitle(entry.title)) return null;

      const skills = splitSkillItems(entry.content);
      return entry.title && skills.length > 0
        ? {
            id: `skills-${indexPrefix}-${segmentIndex + 1}`,
            title: entry.title,
            skills,
          }
        : null;
    })
    .filter((section): section is SkillSection => Boolean(section));
}

function normalizeHeader(parsed: ParsedResumeLike, candidate: CandidateSeedInfo) {
  const header = asRecord(parsed.header);
  const personalInfo = asRecord(parsed.personalInfo);

  return {
    fullName:
      asTrimmedString(header?.fullName) ||
      asTrimmedString(personalInfo?.fullName) ||
      asTrimmedString(personalInfo?.name) ||
      asTrimmedString(parsed.name) ||
      candidate.name,
    email:
      asTrimmedString(header?.email) ||
      asTrimmedString(personalInfo?.email) ||
      asTrimmedString(parsed.email) ||
      candidate.email ||
      undefined,
    phone:
      asTrimmedString(header?.phone) ||
      asTrimmedString(personalInfo?.phone) ||
      asTrimmedString(parsed.phone) ||
      candidate.phone ||
      undefined,
    linkedin:
      asTrimmedString(header?.linkedin) ||
      asTrimmedString(personalInfo?.linkedin) ||
      asTrimmedString(parsed.linkedin_url) ||
      candidate.linkedin_url ||
      undefined,
    github:
      asTrimmedString(header?.github) ||
      asTrimmedString(personalInfo?.github) ||
      asTrimmedString(parsed.github_url) ||
      candidate.github_url ||
      undefined,
    portfolio:
      asTrimmedString(header?.portfolio) ||
      asTrimmedString(personalInfo?.portfolio) ||
      asTrimmedString(personalInfo?.website) ||
      asTrimmedString(parsed.portfolio_url) ||
      candidate.portfolio_url ||
      undefined,
    location:
      asTrimmedString(header?.location) ||
      asTrimmedString(personalInfo?.location) ||
      asTrimmedString(parsed.location) ||
      undefined,
  };
}

function normalizeSkills(rawSkills: unknown): SkillSection[] {
  const skillsRecord = asRecord(rawSkills);

  if (skillsRecord?.mode === "categorized" && Array.isArray(skillsRecord.categorized)) {
    const normalized = skillsRecord.categorized
      .map((category, index) => {
        const record = asRecord(category);
        if (!record) return null;
        const title = asTrimmedString(record.name) || asTrimmedString(record.title) || `Skills ${index + 1}`;
        const skills = Array.isArray(record.skills)
          ? record.skills.map((skill) => asTrimmedString(skill)).filter((skill): skill is string => Boolean(skill))
          : [];
        return title && skills.length
          ? {
              id: asTrimmedString(record.id) || `skills-${index + 1}`,
              title,
              skills,
            }
          : null;
      })
      .filter((section): section is SkillSection => Boolean(section));
    // #region debug-point D:normalize-skills-categorized-mode
    reportSeedBuilderDebug("D", "builder normalized skills from categorized mode", {
      rawSkills,
      normalizedSections: normalized,
    });
    // #endregion
    return normalized;
  }

  if (skillsRecord?.mode === "simple") {
    const simpleSkills = Array.isArray(skillsRecord.simple)
      ? skillsRecord.simple.map((skill) => asTrimmedString(skill)).filter((skill): skill is string => Boolean(skill))
      : [];
    const normalized = simpleSkills.length ? [{ id: "skills-1", title: "Skills", skills: simpleSkills }] : [];
    // #region debug-point D:normalize-skills-simple-mode
    reportSeedBuilderDebug("D", "builder normalized skills from simple mode", {
      rawSkills,
      normalizedSections: normalized,
    });
    // #endregion
    return normalized;
  }

  if (skillsRecord && !Array.isArray(rawSkills)) {
    const objectSections = Object.entries(skillsRecord)
      .filter(([, value]) => Array.isArray(value))
      .map(([title, value], index) => ({
        id: `skills-${index + 1}`,
        title: humanizeKey(title),
        skills: (value as unknown[])
          .map((skill) => asTrimmedString(skill))
          .filter((skill): skill is string => Boolean(skill)),
      }))
      .filter((section) => section.skills.length > 0);
    if (objectSections.length > 0) {
      // #region debug-point D:normalize-skills-object-shape
      reportSeedBuilderDebug("D", "builder normalized skills from object-shaped input", {
        rawSkills,
        normalizedSections: objectSections,
      });
      // #endregion
      return objectSections;
    }
  }

  if (!Array.isArray(rawSkills)) {
    // #region debug-point D:normalize-skills-empty
    reportSeedBuilderDebug("D", "builder received non-array skills input", {
      rawSkills,
      normalizedSections: [],
    });
    // #endregion
    return [];
  }

  const groupedSections: SkillSection[] = [];
  const simpleSkills: string[] = [];

  rawSkills.forEach((skillGroup) => {
    if (typeof skillGroup === "string") {
      const skill = asTrimmedString(skillGroup);
      if (!skill) return;

      const categorizedSections = parseCategorizedSkillString(skill, groupedSections.length + 1);
      if (categorizedSections.length > 0) {
        groupedSections.push(...categorizedSections);
      } else {
        simpleSkills.push(skill);
      }
      return;
    }

    const record = asRecord(skillGroup);
    if (!record) return;

    const title = asTrimmedString(record.title) || asTrimmedString(record.name);
    const skills = Array.isArray(record.skills)
      ? record.skills.map((skill) => asTrimmedString(skill)).filter((skill): skill is string => Boolean(skill))
      : [];

    if (title && skills.length > 0) {
      groupedSections.push({
        id: asTrimmedString(record.id) || `skills-${groupedSections.length + 1}`,
        title,
        skills,
      });
      return;
    }

    const singleSkill = asTrimmedString(record.skill) || asTrimmedString(record.name);
    if (singleSkill) simpleSkills.push(singleSkill);
  });

  // Repair: if the grouped sections contain obviously malformed categories
  // (fragment titles like "As", "XGS", "Detail"), the AI likely mangled them.
  // In that case, discard the groupings and return everything as a flat list.
  if (groupedSections.length > 0) {
    const malformedCount = groupedSections.filter(
      (s) => FRAGMENT_CATEGORY_TITLES.has(s.title.toLowerCase()) || (s.title.split(/\s+/).length < 2 && s.title.length < 8)
    ).length;

    if (malformedCount > 0) {
      // Flatten all grouped skills + simpleSkills into one "Technical Skills" section
      const allSkills = [
        ...groupedSections.flatMap((s) => s.skills),
        ...simpleSkills,
      ];
      const normalized = allSkills.length > 0
        ? [{ id: "skills-1", title: "Technical Skills", skills: allSkills }]
        : [];
      // #region debug-point D:normalize-skills-repaired
      reportSeedBuilderDebug("D", "builder repaired malformed grouped skill categories", {
        rawSkills,
        groupedSections,
        simpleSkills,
        normalizedSections: normalized,
      });
      // #endregion
      return normalized;
    }

    if (simpleSkills.length > 0) {
      groupedSections.push({
        id: `skills-${groupedSections.length + 1}`,
        title: "Skills",
        skills: simpleSkills,
      });
    }
    // #region debug-point D:normalize-skills-grouped
    reportSeedBuilderDebug("D", "builder grouped categorized skill strings", {
      rawSkills,
      groupedSections,
      simpleSkills,
      normalizedSections: groupedSections,
    });
    // #endregion
    return groupedSections;
  }

  const flatSkills = rawSkills
    .map((skill) => asTrimmedString(skill))
    .filter((skill): skill is string => Boolean(skill));
  const normalized = flatSkills.length ? [{ id: "skills-1", title: "Skills", skills: flatSkills }] : [];
  // #region debug-point D:normalize-skills-flat
  reportSeedBuilderDebug("D", "builder normalized flat skill list", {
    rawSkills,
    normalizedSections: normalized,
  });
  // #endregion
  return normalized;
}

function normalizeExperience(rawExperience: unknown): ExperienceBlock[] {
  if (!Array.isArray(rawExperience)) return [];

  return rawExperience.reduce<ExperienceBlock[]>((acc, item, index) => {
      const record = asRecord(item);
      if (!record) return acc;

      const bullets = Array.isArray(record.bullets)
        ? record.bullets
            .map((bullet, bulletIndex) => {
              if (typeof bullet === "string") {
                return makeBullet(`exp-${index}-bullet-${bulletIndex}`, bullet);
              }
              const bulletRecord = asRecord(bullet);
              return bulletRecord?.text
                ? makeBullet(`exp-${index}-bullet-${bulletIndex}`, String(bulletRecord.text))
                : null;
            })
            .filter((bullet): bullet is ResumeBullet => Boolean(bullet))
        : typeof record.description === "string" && record.description.trim()
          ? [makeBullet(`exp-${index}-bullet-0`, record.description.trim())].filter((bullet): bullet is ResumeBullet => Boolean(bullet))
          : [];

      const title = asTrimmedString(record.title) || asTrimmedString(record.jobTitle) || "";
      const company = asTrimmedString(record.company) || "";
      if (!title && !company && bullets.length === 0) return acc;

      const endDate = asTrimmedString(record.endDate) || asTrimmedString(record.end_date);
      acc.push({
        id: asTrimmedString(record.id) || `exp-${index}`,
        title,
        company,
        location: asTrimmedString(record.location) || undefined,
        startDate: asTrimmedString(record.startDate) || asTrimmedString(record.start_date) || "",
        endDate: endDate || undefined,
        isCurrent: !endDate,
        bullets,
      });
      return acc;
    }, []);
}

function normalizeEducation(rawEducation: unknown): EducationBlock[] {
  if (!Array.isArray(rawEducation)) return [];

  return rawEducation.reduce<EducationBlock[]>((acc, item, index) => {
      const record = asRecord(item);
      if (!record) return acc;

      const degree = asTrimmedString(record.degree) || "";
      const school = asTrimmedString(record.school) || asTrimmedString(record.institution) || "";
      if (!degree && !school) return acc;

      acc.push({
        id: asTrimmedString(record.id) || `edu-${index}`,
        degree,
        school,
        location: asTrimmedString(record.location) || undefined,
        graduationDate:
          asTrimmedString(record.graduationDate) ||
          asTrimmedString(record.graduation_year) ||
          undefined,
      });
      return acc;
    }, []);
}

function normalizeCertifications(rawCertifications: unknown): CertificationBlock[] {
  if (!Array.isArray(rawCertifications)) return [];

  return rawCertifications
    .map((item, index) => {
      if (typeof item === "string") {
        const name = asTrimmedString(item);
        return name ? { id: `cert-${index}`, name } : null;
      }

      const record = asRecord(item);
      if (!record) return null;
      const name = asTrimmedString(record.name) || asTrimmedString(record.title);
      return name
        ? {
            id: asTrimmedString(record.id) || `cert-${index}`,
            name,
            issuer: asTrimmedString(record.issuer) || undefined,
            date: asTrimmedString(record.date) || undefined,
          }
        : null;
    })
    .filter((item): item is CertificationBlock => Boolean(item));
}

function normalizeProjects(rawProjects: unknown): ProjectBlock[] {
  if (!Array.isArray(rawProjects)) return [];

  return rawProjects.reduce<ProjectBlock[]>((acc, item, index) => {
      const record = asRecord(item);
      if (!record) return acc;

      const bullets = Array.isArray(record.bullets)
        ? record.bullets
            .map((bullet, bulletIndex) => {
              if (typeof bullet === "string") {
                return makeBullet(`project-${index}-bullet-${bulletIndex}`, bullet);
              }
              const bulletRecord = asRecord(bullet);
              return bulletRecord?.text
                ? makeBullet(`project-${index}-bullet-${bulletIndex}`, String(bulletRecord.text))
                : null;
            })
            .filter((bullet): bullet is ResumeBullet => Boolean(bullet))
        : [];

      const description = asTrimmedString(record.description);
      const name = asTrimmedString(record.name) || asTrimmedString(record.title);
      if (!name && !description && bullets.length === 0) return acc;

      acc.push({
        id: asTrimmedString(record.id) || `project-${index}`,
        name: name || `Project ${index + 1}`,
        description: description || undefined,
        technologies: Array.isArray(record.technologies)
          ? record.technologies
              .map((technology) => asTrimmedString(technology))
              .filter((technology): technology is string => Boolean(technology))
          : undefined,
        bullets,
        url: asTrimmedString(record.url) || asTrimmedString(record.liveUrl) || undefined,
      });
      return acc;
    }, []);
}

function normalizeExistingCustomSections(rawCustomSections: unknown): ResumeCustomSection[] {
  if (!Array.isArray(rawCustomSections)) return [];

  return rawCustomSections
    .map((section, index) => {
      const record = asRecord(section);
      if (!record) return null;

      const title = asTrimmedString(record.title) || asTrimmedString(record.name) || `Custom Section ${index + 1}`;
      const bullets = Array.isArray(record.bullets)
        ? record.bullets
            .map((bullet, bulletIndex) => {
              if (typeof bullet === "string") {
                return makeBullet(`custom-${index}-${bulletIndex}`, bullet);
              }
              const bulletRecord = asRecord(bullet);
              return bulletRecord?.text
                ? makeBullet(`custom-${index}-${bulletIndex}`, String(bulletRecord.text))
                : null;
            })
            .filter((bullet): bullet is ResumeBullet => Boolean(bullet))
        : buildBulletsFromUnknown(record.content ?? record.items, `custom-${index}`);

      return bullets.length > 0
        ? {
            id: asTrimmedString(record.id) || `custom-${index}`,
            title,
            bullets,
          }
        : null;
    })
    .filter((section): section is ResumeCustomSection => Boolean(section));
}

function normalizeUnknownSections(parsed: ParsedResumeLike): ResumeCustomSection[] {
  return Object.entries(parsed)
    .filter(([key, value]) => !KNOWN_PARSED_KEYS.has(key) && value != null)
    .map(([key, value], index) => {
      const bullets = buildBulletsFromUnknown(value, `custom-extra-${index}`);
      if (bullets.length === 0) return null;

      return {
        id: `custom-extra-${index}`,
        title: humanizeKey(key),
        bullets,
      };
    })
    .filter((section): section is ResumeCustomSection => Boolean(section));
}

export function buildResumeDocumentFromParsedResume(
  parsed: ParsedResumeLike,
  candidate: CandidateSeedInfo,
  formatting: ResumeFormatting,
): ResumeDocument {
  const skills = normalizeSkills(parsed.skills);
  const experience = normalizeExperience(parsed.experience);
  const education = normalizeEducation(parsed.education);
  const certifications = normalizeCertifications(parsed.certifications);
  const projects = normalizeProjects(parsed.projects);
  const customSections = [
    ...normalizeExistingCustomSections(parsed.customSections),
    ...normalizeUnknownSections(parsed),
  ];

  // #region debug-point D:build-resume-document
  reportSeedBuilderDebug("D", "builder created resume document seed from parsed resume", {
    parsedRawText: typeof parsed.raw_text === "string" ? parsed.raw_text : null,
    parsedSkills: Array.isArray(parsed.skills) ? parsed.skills : parsed.skills ?? null,
    normalizedSkillSections: skills,
    experienceCount: experience.length,
    educationCount: education.length,
    certificationsCount: certifications.length,
    projectCount: projects.length,
    customSectionCount: customSections.length,
  });
  // #endregion

  return {
    header: normalizeHeader(parsed, candidate),
    summary: asTrimmedString(parsed.summary)
      ? { id: "summary-1", text: asTrimmedString(parsed.summary)! }
      : undefined,
    skills,
    experience,
    education,
    projects: projects.length ? projects : undefined,
    certifications: certifications.length ? certifications : [],
    customSections: customSections.length ? customSections : undefined,
    formatting,
  };
}
