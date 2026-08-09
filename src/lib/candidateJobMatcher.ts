export interface MatchCandidateContext {
  workAuthorization?: string | null;
  visaStatus?: string | null;
  preferredLocations?: string | null;
  resumeText: string;
}

export interface MatchProfileContext {
  activeTerms: string[];
  dismissedTerms: string[];
  additionalRules?: string | null;
}

export interface MatchJobContext {
  title: string;
  company?: string | null;
  location?: string | null;
  description: string;
  seniorityLevel?: string | null;
  postedAt: string | Date | null;
}

export interface CandidateJobEvaluation {
  score: number;
  tier: "A" | "B" | null;
  outcome: "recommended" | "rejected";
  reason: string;
  matchedTerms: string[];
  dismissedTermHits: string[];
  hardGates: string[];
  scoreBreakdown: {
    title: number;
    skills: number;
    responsibilities: number;
    seniority: number;
    eligibility: number;
    freshness: number;
    penalties: number;
  };
}

export interface CompiledSearchRule {
  type: "maximum_experience" | "excluded_phrase" | "seniority_exclusion" | "human_review";
  operator: "lte" | "not_contains" | "review";
  value: number | string;
  severity: "hard_reject" | "review";
  reason: string;
}

const normalize = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  return terms.map((term) => term.trim()).filter((term) => {
    const key = normalize(term);
    if (key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function includesTerm(text: string, term: string): boolean {
  const needle = normalize(term);
  if (!needle) return false;
  return ` ${text} `.includes(` ${needle} `) || (needle.length >= 5 && text.includes(needle));
}

function extractRequiredYears(text: string): number | null {
  const matches = [...text.matchAll(/(?:at least|minimum|min\.?|requires?|required)?\s*(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s*years?/gi)];
  if (!matches.length) return null;
  return Math.max(...matches.map((match) => Number(match[1])).filter(Number.isFinite));
}

function extractRuleMaximumYears(rules: string): number | null {
  const match = rules.match(/(?:reject|exclude|do not (?:select|recommend)).{0,80}?(?:more than|over|above)\s+(\d{1,2})\s*years?/i);
  return match ? Number(match[1]) : null;
}

function explicitExcludedPhrases(rules: string): string[] {
  const phrases: string[] = [];
  for (const line of rules.split(/[\n;]+/)) {
    const match = line.match(/^\s*(?:reject|exclude|do not (?:select|recommend))\s+(?:roles?|jobs?)?\s*(?:for|with|requiring)?\s*[:\-]?\s*(.+)$/i);
    if (!match) continue;
    const phrase = match[1].replace(/[.!]+$/, "").trim();
    if (phrase && phrase.length <= 80 && !/more than|over|above\s+\d+\s*years?/i.test(phrase)) phrases.push(phrase);
  }
  return uniqueTerms(phrases);
}

export function compileAdditionalRules(rules: string): CompiledSearchRule[] {
  const compiled: CompiledSearchRule[] = [];
  const maximumYears = extractRuleMaximumYears(rules);
  if (maximumYears !== null) compiled.push({
    type: "maximum_experience", operator: "lte", value: maximumYears,
    severity: "hard_reject", reason: `Reject jobs requiring more than ${maximumYears} years of experience`,
  });
  for (const phrase of explicitExcludedPhrases(rules)) compiled.push({
    type: "excluded_phrase", operator: "not_contains", value: phrase,
    severity: "hard_reject", reason: `Reject jobs whose posting contains “${phrase}”`,
  });
  if (/(?:reject|exclude|avoid).{0,40}\b(?:senior|sr\.?|lead|principal|manager|director)\b/i.test(rules)) compiled.push({
    type: "seniority_exclusion", operator: "not_contains", value: "senior leadership title",
    severity: "hard_reject", reason: "Reject senior or leadership roles under the approved profile rule",
  });
  const known = rules.split(/[\n;]+/).filter((line) => line.trim()).length;
  if (known > compiled.length) compiled.push({
    type: "human_review", operator: "review", value: rules.trim().slice(0, 1000),
    severity: "review", reason: "One or more free-text preferences require human interpretation",
  });
  return compiled;
}

export function evaluateCandidateJob(
  candidate: MatchCandidateContext,
  profile: MatchProfileContext,
  job: MatchJobContext,
  options: { now?: Date; freshnessDays?: number; tierAMin?: number; tierBMin?: number } = {},
): CandidateJobEvaluation {
  const now = options.now ?? new Date();
  const freshnessDays = options.freshnessDays ?? 7;
  const tierAMin = options.tierAMin ?? 85;
  const tierBMin = options.tierBMin ?? 70;
  const cutoff = new Date(now.getTime() - freshnessDays * 86_400_000);
  const postedAt = job.postedAt instanceof Date ? job.postedAt : job.postedAt ? new Date(job.postedAt) : null;
  const title = normalize(job.title);
  const description = normalize(job.description);
  const wholeJob = normalize(`${job.title} ${job.seniorityLevel ?? ""} ${job.location ?? ""} ${job.description}`);
  const resume = normalize(candidate.resumeText);
  const activeTerms = uniqueTerms(profile.activeTerms);
  const dismissedTerms = uniqueTerms(profile.dismissedTerms);
  const matchedTerms = activeTerms.filter((term) => includesTerm(wholeJob, term));
  const titleMatches = activeTerms.filter((term) => includesTerm(title, term));
  const descriptionMatches = activeTerms.filter((term) => includesTerm(description, term));
  const dismissedTermHits = dismissedTerms.filter((term) => includesTerm(wholeJob, term));
  const hardGates: string[] = [];

  if (!postedAt || Number.isNaN(postedAt.getTime())) hardGates.push("Posting date is missing or invalid");
  else if (postedAt.getTime() > now.getTime()) hardGates.push("Posting date is in the future");
  else if (postedAt.getTime() < cutoff.getTime()) hardGates.push(`Job is older than ${freshnessDays} days`);
  if (!description || description.length < 120) hardGates.push("Job description is missing or too thin to verify fit");
  if (!activeTerms.length) hardGates.push("Approved profile has no active search terms");

  const authorization = normalize(`${candidate.workAuthorization ?? ""} ${candidate.visaStatus ?? ""}`);
  const requiresClearance = /(?:active |current )?(?:security |secret |top secret |ts\/sci )clearance|required security clearance/.test(wholeJob);
  const hasClearance = /(?:active |current )?(?:security |secret |top secret |ts\/sci )clearance/.test(resume);
  if (requiresClearance && !hasClearance) hardGates.push("Required security clearance is not proven by the resume");
  const requiresCitizen = /(?:u\.?s\.?|united states) citizen(?:ship)? (?:is )?(?:required|only)|must be (?:a )?(?:u\.?s\.?|united states) citizen/.test(wholeJob);
  const provesCitizen = /(?:u\.?s\.?|united states) citizen/.test(authorization);
  if (requiresCitizen && !provesCitizen) hardGates.push("Required U.S. citizenship is not proven in the candidate profile");
  const requiresSponsorshipFree = /(?:no|without) (?:visa )?sponsorship|must be authorized to work.{0,40}without sponsorship/.test(wholeJob);
  const needsSponsorship = /need|require|sponsor|h-?1b|opt|cpt/.test(authorization) && !/no sponsorship|does not require/.test(authorization);
  if (requiresSponsorshipFree && needsSponsorship) hardGates.push("Job does not offer sponsorship required by the candidate");
  const requiredCredentials = [
    { label: "Professional Engineer (PE) license", job: /(?:professional engineer|p\.?e\.?).{0,35}(?:license|licensure|must|required)|(?:must|required).{0,35}(?:professional engineer|p\.?e\.? license)/, resume: /professional engineer|p\.?e\.? license/ },
    { label: "PMP certification", job: /(?:pmp|project management professional).{0,30}(?:must|required)|(?:must|required).{0,30}(?:pmp|project management professional)/, resume: /pmp|project management professional/ },
    { label: "CCNA certification", job: /ccna.{0,30}(?:must|required)|(?:must|required).{0,30}ccna/, resume: /ccna/ },
    { label: "registered nurse license", job: /(?:registered nurse|rn).{0,30}(?:license|must|required)/, resume: /registered nurse|rn license/ },
  ];
  for (const credential of requiredCredentials) {
    if (credential.job.test(wholeJob) && !credential.resume.test(resume)) {
      hardGates.push(`Required ${credential.label} is not proven by the resume`);
    }
  }

  const rules = profile.additionalRules ?? "";
  const requiredYears = extractRequiredYears(job.description);
  const maximumYears = extractRuleMaximumYears(rules);
  if (maximumYears !== null && requiredYears !== null && requiredYears > maximumYears) {
    hardGates.push(`Job requires ${requiredYears} years, above the approved ${maximumYears}-year limit`);
  }
  for (const phrase of explicitExcludedPhrases(rules)) {
    if (includesTerm(wholeJob, phrase)) hardGates.push(`Additional rule excludes “${phrase}”`);
  }

  const seniorJob = /\b(senior|sr|staff|principal|lead|manager|director|head|vp)\b/.test(`${title} ${normalize(job.seniorityLevel)}`);
  const seniorApproved = activeTerms.some((term) => /\b(senior|sr|staff|principal|lead|manager|director|head|vp)\b/.test(normalize(term)));

  const titleScore = Math.min(30, titleMatches.length ? 18 + titleMatches.length * 6 : 0);
  const skillsScore = Math.min(25, descriptionMatches.length * 4);
  const responsibilitiesScore = Math.min(20, Math.round((matchedTerms.length / Math.max(8, activeTerms.length)) * 20));
  const seniorityScore = seniorJob && !seniorApproved ? 2 : 10;
  const eligibilityScore = hardGates.some((gate) => /citizenship|sponsorship|clearance/.test(gate.toLowerCase())) ? 0 : 10;
  const freshnessScore = postedAt && !Number.isNaN(postedAt.getTime()) && postedAt >= cutoff && postedAt <= now ? 5 : 0;
  const penalties = Math.min(25, dismissedTermHits.length * 8 + (seniorJob && !seniorApproved ? 8 : 0));
  const score = Math.max(0, Math.min(100, titleScore + skillsScore + responsibilitiesScore + seniorityScore + eligibilityScore + freshnessScore - penalties));
  const tier = hardGates.length ? null : score >= tierAMin ? "A" : score >= tierBMin ? "B" : null;
  const outcome = tier ? "recommended" : "rejected";
  const reason = hardGates.length
    ? hardGates.join("; ")
    : outcome === "recommended"
      ? `${tier === "A" ? "Strong" : "Good"} fit: ${matchedTerms.slice(0, 6).join(", ") || "approved profile alignment"}`
      : `Score ${score} is below the ${tierBMin}-point review threshold`;

  return {
    score, tier, outcome, reason, matchedTerms, dismissedTermHits, hardGates,
    scoreBreakdown: { title: titleScore, skills: skillsScore, responsibilities: responsibilitiesScore, seniority: seniorityScore, eligibility: eligibilityScore, freshness: freshnessScore, penalties },
  };
}
