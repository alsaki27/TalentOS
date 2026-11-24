type ResumeRecord = Record<string, unknown>;

function record(value: unknown): ResumeRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ResumeRecord : {};
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function entries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function labels(value: unknown, fields: string[]): string[] {
  return entries(value).map((item) => {
    const row = record(item);
    return typeof item === "string" ? item.trim() : fields.map((field) => text(row[field])).filter(Boolean).join(" — ");
  }).filter(Boolean);
}

/** A read-only view of parser output or a saved Resume Studio document.
 * Never pass unvalidated JSON objects through to React or profile updates.
 */
export function getCandidateResumePreview(value: unknown) {
  const parsed = record(value);
  const header = record(parsed.header);
  const personalInfo = record(parsed.personalInfo);
  const contact = {
    name: text(header.fullName, personalInfo.fullName, personalInfo.name, parsed.name),
    email: text(header.email, personalInfo.email, parsed.email),
    phone: text(header.phone, personalInfo.phone, parsed.phone),
    location: text(header.location, personalInfo.location, parsed.location),
    linkedin_url: text(header.linkedin, personalInfo.linkedin, parsed.linkedin_url),
    github_url: text(header.github, personalInfo.github, parsed.github_url),
    portfolio_url: text(header.portfolio, personalInfo.portfolio, personalInfo.website, parsed.portfolio_url),
  };
  const skillGroups: { title: string; skills: string[] }[] = [];
  const flatSkills: string[] = [];
  for (const item of entries(parsed.skills)) {
    if (typeof item === "string") {
      if (item.trim()) flatSkills.push(item.trim());
      continue;
    }
    const group = record(item);
    const skills = entries(group.skills).map((skill) => text(skill)).filter(Boolean);
    if (skills.length) skillGroups.push({ title: text(group.title), skills });
  }
  if (flatSkills.length) skillGroups.unshift({ title: "", skills: flatSkills });

  const experience = labels(parsed.experience, ["company", "title"]);
  const education = labels(parsed.education, ["school", "degree"]);
  const certifications = entries(parsed.certifications).map((item) => {
    const row = record(item);
    return text(item, row.name, row.title);
  }).filter(Boolean);
  const summary = text(parsed.summary, record(parsed.summary).text);
  const parseError = parsed.parse_error
    ? text(parsed.parse_error, record(parsed.parse_error).message) || "The resume could not be parsed."
    : "";
  return {
    contact, skillGroups, experience, education, certifications, summary, parseError,
    skillCount: skillGroups.reduce((total, group) => total + group.skills.length, 0),
    hasContent: Boolean(Object.values(contact).some(Boolean) || summary || skillGroups.length || experience.length || education.length || certifications.length),
  };
}
