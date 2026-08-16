import type { ExperienceEntry } from "./schemas";

type UnknownRecord = Record<string, unknown>;

export interface EducationEntry {
  degree: string;
  school: string;
  field: string | null;
  graduationDate: string | null;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Legacy resume imports occasionally store identity fields as small objects
 * ({ text }, { value }, { name }) instead of strings. Read those shapes without
 * ever calling string methods on an unknown value.
 */
export function readResumeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!isRecord(value)) return "";

  for (const key of ["text", "value", "name", "label", "title"]) {
    const nested = value[key];
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "";
}

export function normalizeResumeText(value: unknown): string {
  return readResumeText(value)
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeResumeBullet(value: unknown): string | null {
  const text = readResumeText(value);
  return text || null;
}

function readBullets(entry: unknown): string[] {
  if (!isRecord(entry)) return [];
  const raw = Array.isArray(entry.bullets)
    ? entry.bullets
    : Array.isArray(entry.bulletPoints)
      ? entry.bulletPoints
      : [];
  return raw.map(normalizeResumeBullet).filter((bullet): bullet is string => bullet !== null);
}

function readEvidenceIds(entry: unknown): string[] {
  if (!isRecord(entry) || !Array.isArray(entry.evidenceIds)) return [];
  return entry.evidenceIds.filter((id): id is string => typeof id === "string");
}

function sameText(a: unknown, b: unknown): boolean {
  const left = normalizeResumeText(a);
  const right = normalizeResumeText(b);
  return Boolean(left && right && left === right);
}

function similarText(a: unknown, b: unknown): boolean {
  const left = normalizeResumeText(a);
  const right = normalizeResumeText(b);
  if (left.length < 4 || right.length < 4) return false;
  return left.includes(right) || right.includes(left);
}

function experienceMatchScore(base: UnknownRecord, candidate: UnknownRecord, sameIndex: boolean): number {
  let score = 0;
  let identityMatched = false;
  if (sameText(base.company, candidate.company)) { score += 10; identityMatched = true; }
  else if (similarText(base.company, candidate.company)) { score += 5; identityMatched = true; }
  if (sameText(base.title, candidate.title)) { score += 10; identityMatched = true; }
  else if (similarText(base.title, candidate.title)) { score += 5; identityMatched = true; }
  if (!identityMatched) return 0;
  if (sameText(base.startDate, candidate.startDate)) score += 3;
  if (sameText(base.endDate, candidate.endDate)) score += 3;
  if (sameIndex) score += 1;
  return score;
}

function bestUnusedMatch(
  base: UnknownRecord,
  candidates: unknown[],
  used: Set<number>,
  baseIndex: number,
  scoreEntry: (baseEntry: UnknownRecord, candidate: UnknownRecord, sameIndex: boolean) => number,
  minimumScore: number
): UnknownRecord | null {
  let best: { entry: UnknownRecord; index: number; score: number } | null = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (used.has(index) || !isRecord(candidate)) continue;
    const score = scoreEntry(base, candidate, index === baseIndex);
    if (score >= minimumScore && (!best || score > best.score)) {
      best = { entry: candidate, index, score };
    }
  }
  if (!best) return null;
  used.add(best.index);
  return best.entry;
}

function readYear(value: unknown): number | null {
  const text = readResumeText(value);
  const match = text.match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * A base resume occasionally has a corrupted/mistyped end date (confirmed
 * live: a candidate's base resume had startDate "Jul 2025" / endDate
 * "Jan 2001" - end 24 years before start - for what was actually their
 * current role, and the pipeline faithfully reproduced it onto the exported
 * PDF since dates are otherwise taken verbatim from the base resume by
 * design). This is the one narrow exception to "never touch base resume
 * dates": a chronologically impossible end date is dropped (never invented
 * as "Present" - we don't actually know that's true, just that the stored
 * value is wrong) rather than rendered as-is. A single bad date in one
 * candidate's base resume out of 33 scanned live - not a systemic pattern,
 * but worth guarding against wherever it next occurs.
 */
function sanitizeEndDate(rawStartDate: string | null, rawEndDate: string | null, label: string): string | null {
  if (!rawStartDate || !rawEndDate) return rawEndDate;
  const startYear = readYear(rawStartDate);
  const endYear = readYear(rawEndDate);
  if (startYear !== null && endYear !== null && endYear < startYear) {
    console.warn(
      `[resumeIntegrity] Dropping impossible end date for "${label}": "${rawEndDate}" is before start date "${rawStartDate}". Source data needs correction.`
    );
    return null;
  }
  return rawEndDate;
}

/**
 * Make the base resume authoritative for employment identity. The AI may tailor
 * bullets, but it cannot add, remove, reorder, rename, relocate, or redate jobs.
 */
export function enforceExperienceIntegrity(
  generatedEntries: unknown[],
  baseEntries: unknown[]
): ExperienceEntry[] {
  const validBase = baseEntries.filter(
    (entry): entry is UnknownRecord => isRecord(entry) && Boolean(readResumeText(entry.title))
  );
  if (validBase.length === 0) {
    return generatedEntries.filter(isRecord).map((entry) => {
      const startDate = readResumeText(entry.startDate) || null;
      const rawEndDate = readResumeText(entry.endDate) || null;
      return {
        title: readResumeText(entry.title),
        company: readResumeText(entry.company),
        location: readResumeText(entry.location) || null,
        startDate,
        endDate: sanitizeEndDate(startDate, rawEndDate, readResumeText(entry.title)),
        bullets: readBullets(entry),
        evidenceIds: readEvidenceIds(entry),
      };
    }).filter((entry) => Boolean(entry.title));
  }

  const used = new Set<number>();
  return validBase.map((base, index) => {
    const generated = bestUnusedMatch(
      base,
      generatedEntries,
      used,
      index,
      experienceMatchScore,
      5
    );
    const tailoredBullets = generated ? readBullets(generated) : [];
    const startDate = readResumeText(base.startDate) || null;
    const rawEndDate = readResumeText(base.endDate) || null;
    return {
      title: readResumeText(base.title),
      company: readResumeText(base.company),
      location: readResumeText(base.location) || null,
      startDate,
      endDate: sanitizeEndDate(startDate, rawEndDate, readResumeText(base.title)),
      bullets: tailoredBullets.length > 0 ? tailoredBullets : readBullets(base),
      evidenceIds: generated ? readEvidenceIds(generated) : [],
    };
  });
}

/** Make the base resume authoritative for every education fact, including month. */
export function enforceEducationIntegrity(
  generatedEntries: unknown[],
  baseEntries: unknown[]
): EducationEntry[] {
  const validBase = baseEntries.filter(
    (entry): entry is UnknownRecord =>
      isRecord(entry) && Boolean(readResumeText(entry.degree)) && Boolean(readResumeText(entry.school))
  );
  if (validBase.length === 0) {
    return generatedEntries.filter(isRecord).map((entry) => ({
      degree: readResumeText(entry.degree),
      school: readResumeText(entry.school),
      field: readResumeText(entry.field) || null,
      graduationDate: readResumeText(entry.graduationDate) || null,
    })).filter((entry) => Boolean(entry.degree && entry.school));
  }

  return validBase.map((base) => ({
    degree: readResumeText(base.degree),
    school: readResumeText(base.school),
    field: readResumeText(base.field) || null,
    graduationDate: readResumeText(base.graduationDate) || null,
  }));
}
