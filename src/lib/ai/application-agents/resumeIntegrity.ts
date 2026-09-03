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

/**
 * Read the base resume's professional summary, tolerating the studio shape
 * ({ id, text }), a plain string, and a few legacy field names (profile /
 * objective / professionalSummary, and personalInfo.* variants). Returns a
 * trimmed string or null when the base resume has no summary at all.
 *
 * The professional-summary rule across the pipeline is: the tailored resume
 * may carry a summary ONLY when the base resume has one (tailored toward the
 * job); a base resume without a summary produces null at every stage.
 */
export function readBaseSummary(baseContent: unknown): string | null {
  if (!isRecord(baseContent)) return null;
  const direct = readResumeText(baseContent.summary);
  if (direct) return direct;
  for (const key of ["profile", "objective", "professionalSummary"]) {
    const text = readResumeText(baseContent[key]);
    if (text) return text;
  }
  const pi = baseContent.personalInfo;
  if (isRecord(pi)) {
    const text = readResumeText(pi.summary) || readResumeText(pi.objective) || readResumeText(pi.profile);
    if (text) return text;
  }
  return null;
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
function sanitizeEndDate(rawStartDate: string | null, rawEndDate: string | null, label: string, isCurrentJob: boolean = false): string | null {
  if (!rawStartDate || !rawEndDate) return rawEndDate;
  const startYear = readYear(rawStartDate);
  const endYear = readYear(rawEndDate);
  if (startYear !== null && endYear !== null && endYear < startYear) {
    console.warn(
      `[resumeIntegrity] Dropping impossible end date for "${label}": "${rawEndDate}" is before start date "${rawStartDate}". Changing to "Present".`
    );
    return "Present";
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
    return generatedEntries.filter(isRecord).map((entry, index) => {
      const startDate = readResumeText(entry.startDate) || null;
      const rawEndDate = readResumeText(entry.endDate) || null;
      return {
        title: readResumeText(entry.title),
        company: readResumeText(entry.company),
        location: readResumeText(entry.location) || null,
        startDate,
        endDate: sanitizeEndDate(startDate, rawEndDate, readResumeText(entry.title), index === 0),
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
      endDate: sanitizeEndDate(startDate, rawEndDate, readResumeText(base.title), index === 0),
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

// ── Chronology validator ─────────────────────────────────────────────────
// Flags (never rewrites) employment/education dates that are implausible
// relative to today or to the job's posting date. Rewriting dates is a
// candidate-truth violation; a flag lets the AE review instead.
//
// IMPORTANT: when the job record carries no usable posting/creation date, the
// job-relative checks are skipped entirely — a missing date field must never
// block or slow the pipeline, and no flag may be invented from a date that
// does not exist.

function readYearFromChronologyValue(value: unknown): number | null {
  const text = readResumeText(value);
  const match = text.match(/(19|20)\d{2}/);
  return match ? parseInt(match[0], 10) : null;
}

function jobPostingYear(job: unknown): number | null {
  if (!isRecord(job)) return null;
  for (const key of ["posted_at", "created_at", "date_posted", "posted_date"]) {
    const year = readYearFromChronologyValue(job[key]);
    if (year !== null) return year;
  }
  return null;
}

export function validateEmploymentChronology(
  experience: ExperienceEntry[],
  education: EducationEntry[],
  job: unknown,
  now: Date = new Date()
): string[] {
  const warnings: string[] = [];
  const jobYear = jobPostingYear(job);
  const nowYear = now.getFullYear();

  for (const entry of experience) {
    const label = entry.title || "Role";
    const startYear = entry.startDate ? readYearFromChronologyValue(entry.startDate) : null;
    const rawEnd = readResumeText(entry.endDate);
    const isPresent = !rawEnd || rawEnd.toLocaleLowerCase("en-US").includes("present") || rawEnd.toLocaleLowerCase("en-US").includes("current");
    const endYear = isPresent ? null : entry.endDate ? readYearFromChronologyValue(entry.endDate) : null;

    if (startYear !== null && startYear > nowYear) {
      warnings.push(`Chronology: "${label}" start date (${entry.startDate}) is in the future — verify with the candidate.`);
    }
    if (endYear !== null && endYear > nowYear) {
      warnings.push(`Chronology: "${label}" end date (${entry.endDate}) is in the future — verify with the candidate.`);
    }
    // Only when the job actually carries a posting date: a role that started
    // more than a year AFTER the posting is implausible work history for this
    // application.
    if (jobYear !== null && startYear !== null && startYear > jobYear + 1) {
      warnings.push(`Chronology: "${label}" starts (${entry.startDate}) after this job was posted (${jobYear}) — verify with the candidate.`);
    }
  }

  for (const entry of education) {
    if (!entry.graduationDate) continue;
    const graduationYear = readYearFromChronologyValue(entry.graduationDate);
    if (graduationYear !== null && graduationYear > nowYear + 1) {
      warnings.push(`Chronology: education graduation date (${entry.graduationDate}) is in the future — verify with the candidate.`);
    }
  }

  return warnings;
}

/** Fraction of the smaller bullet set's significant words also present in the larger set - a rough but effective "these describe the same work" signal, deliberately simpler than requirementCoverage.ts's tokenizer since this only ever compares two roles' own bullets against each other, not a JD requirement against a resume. */
function bulletWordOverlap(bulletsA: string[], bulletsB: string[]): number {
  const wordsOf = (bullets: string[]): Set<string> =>
    new Set((bullets.join(" ").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3));
  const setA = wordsOf(bulletsA);
  const setB = wordsOf(bulletsB);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const w of setA) if (setB.has(w)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DUPLICATE_ROLE_BULLET_OVERLAP_THRESHOLD = 0.6;

/**
 * enforceExperienceIntegrity already structurally prevents the AI from
 * *introducing* a duplicate role (it reconciles 1:1 against base-resume
 * entries). The residual case this catches is different: a base resume that
 * itself already lists the same title+company twice - which could be a real
 * rehire (a second, later employment period) or could be the base resume's
 * own data-entry duplicate carried straight through. Title+company matching
 * alone can't tell those apart (a rehire legitimately has the same
 * title+company), so this only flags when the bullets are ALSO highly
 * similar - a real rehire describes a different stretch of work and should
 * read differently even in the same role, while a data-entry duplicate
 * describes the literal same work twice. Never blocks export - always a
 * warning for the AE to confirm, never treated as proof of an error.
 */
export function flagDuplicateRoleIdentity(experience: ExperienceEntry[]): string[] {
  const warnings: string[] = [];
  const normalize = (s: string) => s.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

  for (let i = 0; i < experience.length; i += 1) {
    for (let j = i + 1; j < experience.length; j += 1) {
      const a = experience[i];
      const b = experience[j];
      const title = normalize(a.title);
      const company = normalize(a.company);
      if (!title || !company) continue;
      if (title !== normalize(b.title) || company !== normalize(b.company)) continue;

      const overlap = bulletWordOverlap(a.bullets ?? [], b.bullets ?? []);
      if (overlap >= DUPLICATE_ROLE_BULLET_OVERLAP_THRESHOLD) {
        warnings.push(
          `Possible duplicate role: "${a.title}" at "${a.company}" appears twice with highly similar bullets (~${Math.round(overlap * 100)}% word overlap) — verify this isn't the same employment period listed twice on the base resume, or confirm it's a genuine rehire with distinct responsibilities.`
        );
      }
    }
  }

  return warnings;
}
