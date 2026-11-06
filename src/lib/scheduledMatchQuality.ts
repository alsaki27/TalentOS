/** Admission policy for automated suggestions. Manual extension captures keep their review flow. */
export const SCHEDULED_MATCH_POLICY_VERSION = "precision-v1";
export const SCHEDULED_MATCH_MIN_SCORE = 85;

export interface MatchRequirementEvidence {
  requirement: string;
  assessment: "met" | "gap" | "unknown";
  jd_quote: string;
  resume_quote: string;
}
export interface ScheduledMatchAssessment {
  role_fit: "aligned" | "mismatch" | "unknown";
  seniority_fit: "aligned" | "mismatch" | "unknown";
  experience_fit: "meets" | "shortfall" | "unknown" | "not_stated";
  preferences_fit: "compatible" | "conflict" | "unknown";
  requirements: MatchRequirementEvidence[];
}
export interface ScheduledMatchQuality {
  policyVersion: typeof SCHEDULED_MATCH_POLICY_VERSION;
  assessment?: ScheduledMatchAssessment;
  reasons: string[];
  inputHashes?: { resumeContent: string; jobDescription: string };
}

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
const invalid = (message: string): never => { throw new Error(`Invalid scheduled match evidence: ${message}`); };

/** Quotes must be present in the exact redacted input supplied to the model. */
export function parseScheduledAssessment(value: unknown, description: string, resume: string): ScheduledMatchAssessment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("assessment is missing");
  const row = value as Record<string, unknown>;
  const enumValue = <T extends string>(key: string, allowed: readonly T[]): T => {
    if (typeof row[key] !== "string" || !allowed.includes(row[key] as T)) return invalid(`${key} is invalid`);
    return row[key] as T;
  };
  if (!Array.isArray(row.requirements) || row.requirements.length < 3 || row.requirements.length > 6) {
    return invalid("three to six core requirements are required");
  }
  const seen = new Set<string>();
  const requirements = row.requirements.map((item: unknown): MatchRequirementEvidence => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return invalid("requirement is invalid");
    const r = item as Record<string, unknown>;
    if (typeof r.requirement !== "string" || !r.requirement.trim() || r.requirement.length > 160) return invalid("requirement label is invalid");
    if (!["met", "gap", "unknown"].includes(String(r.assessment))) return invalid("requirement assessment is invalid");
    if (typeof r.jd_quote !== "string" || r.jd_quote.trim().length < 20 || r.jd_quote.length > 300 || !normalize(description).includes(normalize(r.jd_quote))) {
      return invalid("job quote is missing or is not in the supplied description");
    }
    const key = normalize(r.jd_quote);
    if (seen.has(key)) return invalid("duplicate job requirement quote");
    seen.add(key);
    if (typeof r.resume_quote !== "string" || r.resume_quote.length > 300) return invalid("resume quote is invalid");
    if (r.assessment === "met" && (r.resume_quote.trim().length < 20 || !normalize(resume).includes(normalize(r.resume_quote)))) {
      return invalid("a met requirement has no supporting resume quote");
    }
    if (r.resume_quote && !normalize(resume).includes(normalize(r.resume_quote))) return invalid("resume quote is not in the supplied resume");
    return { requirement: r.requirement.trim(), assessment: r.assessment as MatchRequirementEvidence["assessment"], jd_quote: r.jd_quote.trim(), resume_quote: r.resume_quote.trim() };
  });
  // An attractive set of three easy duties must not hide an explicit mandatory
  // experience/credential clause elsewhere in the JD. Ambiguous omissions hold
  // the pair rather than manufacture a positive recommendation.
  for (const clause of description.split(/[\n.!?;]+/).map(normalize)) {
    const mandatory = clause.replace(/\bno (?:security )?clearance (?:is )?(?:required|needed)\b|\b(?:security )?clearance (?:is )?not (?:required|needed)\b/g, "");
    if (!/\b(minimum|at least|must|requires?|required|mandatory)\b/.test(mandatory)
      || !/\b(years?|yrs?|licen[cs]e|licensure|certification|clearance)\b/.test(mandatory)) continue;
    const years=mandatory.match(/\b\d+(?:\s*[-–]\s*\d+)?\+?\s*(?:years?|yrs?)\b/)?.[0];
    if (!requirements.some(r => {
      const quote=normalize(r.jd_quote).replace(/[.!?;]+$/, "");
      return (clause.includes(quote) || quote.includes(clause))
        && (years ? quote.includes(years) : /\b(years?|yrs?|licen[cs]e|licensure|certification|clearance)\b/.test(quote));
    })) return invalid("an explicit mandatory experience or credential clause was omitted");
    if (/\b(years?|yrs?)\b/.test(mandatory) && row.experience_fit === "not_stated") return invalid("mandatory experience was marked not stated");
  }
  return {
    role_fit: enumValue("role_fit", ["aligned", "mismatch", "unknown"]),
    seniority_fit: enumValue("seniority_fit", ["aligned", "mismatch", "unknown"]),
    experience_fit: enumValue("experience_fit", ["meets", "shortfall", "unknown", "not_stated"]),
    preferences_fit: enumValue("preferences_fit", ["compatible", "conflict", "unknown"]),
    requirements,
  };
}

export function scheduledSuggestionQuality(input: {
  tier: string; score: number; hardGates: string[]; assessment?: ScheduledMatchAssessment;
  inputHashes?: ScheduledMatchQuality["inputHashes"];
}): ScheduledMatchQuality {
  const reasons: string[] = [];
  if (input.tier !== "strong") reasons.push(`AI tier is ${input.tier}; automated suggestions require Strong.`);
  if (!Number.isInteger(input.score) || input.score < SCHEDULED_MATCH_MIN_SCORE || input.score > 100) reasons.push(`AI score must be an integer from ${SCHEDULED_MATCH_MIN_SCORE} to 100.`);
  reasons.push(...input.hardGates);
  const a = input.assessment;
  if (!a) reasons.push("Structured job-to-resume evidence is missing.");
  else {
    if (a.requirements.length < 3) reasons.push("At least three core requirements need evidence.");
    if (a.role_fit !== "aligned") reasons.push(`Role family is ${a.role_fit}.`);
    if (a.seniority_fit !== "aligned") reasons.push(`Seniority is ${a.seniority_fit}.`);
    if (!["meets", "not_stated"].includes(a.experience_fit)) reasons.push(`Required experience is ${a.experience_fit}.`);
    if (a.preferences_fit !== "compatible") reasons.push(`Candidate preferences are ${a.preferences_fit}.`);
    for (const r of a.requirements) if (r.assessment !== "met") reasons.push(`${r.requirement}: ${r.assessment}.`);
  }
  return { policyVersion: SCHEDULED_MATCH_POLICY_VERSION, assessment: a, reasons: [...new Set(reasons)], inputHashes: input.inputHashes };
}

export function scheduledJobQualityReasons(job: { title: string; company: string | null; posted_at: string | null }, description: string, freshnessDays: number, now = new Date()): string[] {
  const reasons: string[] = [];
  if (!job.title.trim() || !job.company?.trim()) reasons.push("Job title or employer is missing.");
  if (description.trim().length < 500) reasons.push("Job description is too thin for an evidence-based recommendation (minimum 500 characters).");
  const posted = job.posted_at ? new Date(job.posted_at) : null;
  // Publisher dates are often date-only. Compare UTC calendar dates to avoid midnight/timezone artifacts.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const postedDay = posted && Number.isFinite(posted.getTime()) ? Date.UTC(posted.getUTCFullYear(), posted.getUTCMonth(), posted.getUTCDate()) : null;
  if (postedDay === null) reasons.push("Publisher posting date is missing or invalid; ingestion time cannot prove freshness.");
  else if (postedDay > today) reasons.push("Publisher posting date is in the future.");
  else if (postedDay < today - freshnessDays * 86_400_000) reasons.push(`Publisher posting date is older than ${freshnessDays} days.`);
  return reasons;
}
