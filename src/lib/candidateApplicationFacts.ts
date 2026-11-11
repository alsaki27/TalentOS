export const APPLICATION_FACT_KINDS = ["text", "boolean", "integer", "decimal", "date", "option"] as const;
export const APPLICATION_FACT_DISPOSITIONS = ["known", "unknown", "declined"] as const;
export const APPLICATION_FACT_SOURCES = ["profile", "candidate_attested", "document"] as const;

export const APPLICATION_FACT_PROFILE_FIELDS = {
  name: "Full name",
  email: "Email address",
  phone: "Phone number",
  linkedin_url: "LinkedIn URL",
  github_url: "GitHub URL",
  portfolio_url: "Portfolio URL",
} as const;

export type ApplicationFactProfileField = keyof typeof APPLICATION_FACT_PROFILE_FIELDS;
export type ApplicationFactProfile = Partial<Record<ApplicationFactProfileField, string | null>>;
export type ApplicationFactValueKind = typeof APPLICATION_FACT_KINDS[number];
export type ApplicationFactDisposition = typeof APPLICATION_FACT_DISPOSITIONS[number];
export type ApplicationFactSource = typeof APPLICATION_FACT_SOURCES[number];
export type ApplicationFactValue = string | number | boolean;

export interface ApplicationFactDraft {
  jobId: string | null;
  section: string;
  question: string;
  valueKind: ApplicationFactValueKind;
  disposition: ApplicationFactDisposition;
  value: ApplicationFactValue | null;
  sourceKind: ApplicationFactSource;
  sourceRef: string;
  expiresAt: string | null;
}

export interface CandidateApplicationFact extends ApplicationFactDraft {
  id: string;
  candidateId: string;
  revision: number;
  reviewState: "draft" | "approved" | "revoked";
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export type ApplicationFactBlockReason = "unknown" | "declined" | "expired" | "conflict" | "unreviewed";
export type ApplicationFactEvidence = { factId: string; revision: number; sourceRef: string };

export interface ApprovedApplicationAnswers {
  answers: Record<string, string>;
  evidence: Record<string, ApplicationFactEvidence>;
  blocked: { question: string; reason: ApplicationFactBlockReason }[];
}

export function normalizeApplicationQuestion(question: string): string {
  return question.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .trim().replace(/\s+/g, " ").toLowerCase();
}

export function isApplicationFactUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatApplicationFactValue(value: ApplicationFactValue): string {
  return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
}

export function parseApplicationFactDraft(input: unknown): ApplicationFactDraft | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const section = typeof body.section === "string" ? body.section.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const sourceRef = typeof body.sourceRef === "string" ? body.sourceRef.trim() : "";
  const { valueKind, disposition, sourceKind } = body;
  if (!section || section.length > 80 || !question || question.length > 400 ||
      !normalizeApplicationQuestion(question) || !sourceRef || sourceRef.length > 300 ||
      !isOneOf(valueKind, APPLICATION_FACT_KINDS) ||
      !isOneOf(disposition, APPLICATION_FACT_DISPOSITIONS) ||
      !isOneOf(sourceKind, APPLICATION_FACT_SOURCES)) return null;

  const jobId = body.jobId ?? null;
  if (jobId !== null && !isApplicationFactUuid(jobId)) return null;
  const expiry = body.expiresAt ?? null;
  if (expiry !== null && (
    typeof expiry !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(expiry) ||
    !isCalendarDate(expiry.slice(0, 10)) || !Number.isFinite(Date.parse(expiry))
  )) return null;

  let value: ApplicationFactValue | null = null;
  if (disposition === "known") {
    const raw = body.value;
    if (valueKind === "text" || valueKind === "date" || valueKind === "option") {
      if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 1500) return null;
      value = raw.trim();
      if (valueKind === "date" && !isCalendarDate(value)) return null;
    } else if (valueKind === "boolean") {
      if (typeof raw !== "boolean") return null;
      value = raw;
    } else {
      if (typeof raw !== "number" || !Number.isFinite(raw) ||
          (valueKind === "integer" && !Number.isSafeInteger(raw))) return null;
      value = raw;
    }
  } else if (body.value !== undefined && body.value !== null) {
    return null;
  }
  if (sourceKind === "profile" && (
    !Object.prototype.hasOwnProperty.call(APPLICATION_FACT_PROFILE_FIELDS, sourceRef) ||
    valueKind !== "text" || disposition !== "known"
  )) return null;

  return {
    section, question, sourceRef, valueKind, disposition, sourceKind, value,
    jobId: jobId?.toLowerCase() ?? null,
    expiresAt: expiry === null ? null : new Date(expiry).toISOString(),
  };
}

export function profileMatchesApplicationFact(
  fact: Pick<ApplicationFactDraft, "sourceKind" | "sourceRef" | "value">,
  profile: ApplicationFactProfile,
): boolean {
  if (fact.sourceKind !== "profile") return true;
  const currentValue = Object.prototype.hasOwnProperty.call(APPLICATION_FACT_PROFILE_FIELDS, fact.sourceRef)
    ? profile[fact.sourceRef as ApplicationFactProfileField]
    : undefined;
  return typeof currentValue === "string" && currentValue.trim() === fact.value;
}

/**
 * Current revisions only. A blocked job-specific record takes precedence over
 * candidate-wide answers. Duplicate active records in the same scope conflict.
 */
export function resolveApplicationFacts(
  facts: CandidateApplicationFact[],
  candidateId: string,
  jobId: string,
  profile: ApplicationFactProfile,
  questions?: readonly string[],
  now = Date.now(),
): ApprovedApplicationAnswers {
  const current = new Map<string, CandidateApplicationFact>();
  for (const fact of facts) {
    if (fact.candidateId !== candidateId) continue;
    const previous = current.get(fact.id);
    if (!previous || fact.revision > previous.revision) current.set(fact.id, fact);
  }

  const byQuestion = new Map<string, CandidateApplicationFact[]>();
  for (const fact of current.values()) {
    if (fact.jobId !== null && fact.jobId !== jobId) continue;
    const key = normalizeApplicationQuestion(fact.question);
    const matches = byQuestion.get(key) ?? [];
    matches.push(fact);
    byQuestion.set(key, matches);
  }

  const requested = questions === undefined
    ? [...byQuestion.values()].map((matches) => matches.find((fact) => fact.jobId === jobId)?.question ?? matches[0].question)
    : [...new Set(questions)];
  const answers: [string, string][] = [];
  const evidence: [string, ApplicationFactEvidence][] = [];
  const blocked: ApprovedApplicationAnswers["blocked"] = [];
  for (const question of requested) {
    const matches = byQuestion.get(normalizeApplicationQuestion(question)) ?? [];
    const specific = matches.filter((fact) => fact.jobId === jobId);
    const applicable = specific.length ? specific : matches;
    const active = applicable.filter((fact) => fact.reviewState !== "revoked");
    if (active.length !== 1) {
      blocked.push({ question, reason: active.length > 1 ? "conflict" : applicable.length ? "unreviewed" : "unknown" });
      continue;
    }

    const [fact] = active;
    let reason: ApplicationFactBlockReason | undefined;
    if (fact.reviewState !== "approved" || !fact.reviewedBy || !fact.reviewedAt ||
        !profileMatchesApplicationFact(fact, profile)) reason = "unreviewed";
    else if (fact.expiresAt && !(Date.parse(fact.expiresAt) > now)) reason = "expired";
    else if (fact.disposition !== "known") reason = fact.disposition;
    else if (fact.value === null) reason = "unknown";
    if (reason || fact.value === null) {
      blocked.push({ question, reason: reason ?? "unknown" });
      continue;
    }

    answers.push([question, formatApplicationFactValue(fact.value)]);
    evidence.push([question, { factId: fact.id, revision: fact.revision, sourceRef: `${fact.sourceKind}:${fact.sourceRef}` }]);
  }
  return { answers: Object.fromEntries(answers), evidence: Object.fromEntries(evidence), blocked };
}
