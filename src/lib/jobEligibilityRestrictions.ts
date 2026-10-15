// src/lib/jobEligibilityRestrictions.ts
// Deterministic (zero AI cost) detection of two distinct eligibility concerns
// in a job posting's free text:
//   1. requiresCitizenship - the posting requires citizenship of a specific
//      country (not just "authorized to work here", which is the existing,
//      separate jobs.work_authorization AI-classified field - see that
//      column's own comment history for why citizenship and sponsorship are
//      kept apart).
//   2. exportControlRestricted - ITAR/export-control/security-clearance
//      language, common on aerospace/defense postings.
//
// Patterns mirror this codebase's existing regex style
// (src/lib/ai/job-agents/fetchJobPage.ts's looksLikeLoginWall/
// looksLikeErrorPage: one named, commented pattern per concern) and extend
// the vocabulary already proven in src/lib/candidateJobMatcher.ts's
// requiresCitizen/requiresClearance and src/lib/mailClearanceFilter.ts's
// CLEARANCE_KEYWORDS - re-expressed here rather than imported, so this module
// stays self-contained and neither of those existing, already-live files
// needs to change.
//
// Pure function: no DB, no network, no AI call. Safe to run synchronously on
// every write of a job's description_text.

export interface JobEligibilityDetection {
  eligibilityRestricted: boolean;
  requiresCitizenship: boolean;
  citizenshipCountries: string[] | null;
  exportControlRestricted: boolean;
  evidence: string | null;
}

const EMPTY_RESULT: JobEligibilityDetection = {
  eligibilityRestricted: false,
  requiresCitizenship: false,
  citizenshipCountries: null,
  exportControlRestricted: false,
  evidence: null,
};

// Same shape as candidateJobMatcher.ts's proven requiresCitizen regex,
// scoped specifically to the US.
const US_CITIZEN_PATTERN =
  /(?:u\.?s\.?|united states) citizen(?:ship)? (?:is )?(?:required|only)|must be (?:a )?(?:u\.?s\.?|united states) citizen/i;

const CANADA_CITIZEN_PATTERN =
  /(?:canadian|canada) citizen(?:ship)? (?:is )?(?:required|only)|must be (?:a )?canadian citizen/i;

// Generic "other nations" detector: reads the demonym/country directly out of
// the sentence instead of matching against an enumerated list, so a British,
// Australian, German, etc. citizenship requirement is caught without
// hardcoding every country name. Deliberately anchored to the same
// "must be a/an ... citizen" / "citizenship ... required|only" grammatical
// shape as the US/Canada patterns above, to avoid firing on unrelated prose
// that merely mentions a nationality in passing (e.g. "experience with
// German clients").
// No /i flag: the trigger words are spelled out in both cases explicitly
// instead, so the demonym/country capture group can keep requiring a
// capital first letter (a real proper-noun signal) without that
// requirement being silently defeated by a case-insensitive flag.
const GENERIC_CITIZEN_PATTERN =
  /\b[Mm]ust be an? ([A-Z][a-z]+(?: [A-Z][a-z]+)?) citizen\b|\b[Cc]itizenship of (?:the )?([A-Z][a-z]+(?: [A-Z][a-z]+)*) (?:is )?(?:required|only)\b/;

// ITAR / export-control. "EAR" (Export Administration Regulations) is kept as
// a case-sensitive literal, never case-insensitive - a case-insensitive /ear/
// would false-positive on ordinary manufacturing-job prose like "hearing
// protection required" or "ear protection", the exact false-positive
// discipline fetchJobPage.ts already documents for sign\s*(in|up|on) vs.
// "$500 Signing Bonus".
const EXPORT_CONTROL_PATTERN =
  /\bITAR\b|export[\s-]control(?:led)?|export administration regulations|\bEAR\b|U\.?S\.? Person\b|22 ?CFR|8 ?U\.?S\.?C\.? ?1324b/;

// Security clearance vocabulary already proven in mailClearanceFilter.ts's
// CLEARANCE_KEYWORDS and candidateJobMatcher.ts's requiresClearance.
const CLEARANCE_PATTERN =
  /(?:active |current |eligible (?:to obtain|for) )?(?:security |secret |top secret |ts\/sci |public trust |dod |government )clearance|clearance (?:required|eligib)/i;

const SNIPPET_RADIUS = 80;
const MAX_EVIDENCE_LENGTH = 300;

function extractSnippet(text: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + snippet + (end < text.length ? "…" : "");
}

/** Minimal shape any of the 4 UI surfaces' row/job objects need for display. */
export interface JobEligibilityFields {
  requires_citizenship?: boolean | null;
  citizenship_countries?: string[] | null;
  export_control_restricted?: boolean | null;
}

/**
 * Short badge label (full matched text goes in the badge's title/tooltip
 * instead) - shared by the Jobs page, Application Queue, and
 * ApplicationsDataTable (Candidate Dashboard + Candidate Profile) so the
 * wording never drifts between surfaces.
 */
export function formatEligibilityRestrictionLabel(job: JobEligibilityFields): string {
  if (job.requires_citizenship && job.export_control_restricted) return "Citizenship + export control";
  if (job.requires_citizenship) {
    const countries = job.citizenship_countries ?? [];
    return countries.length > 0 ? `Citizenship: ${countries.join(", ")}` : "Citizenship required";
  }
  return "Export control / clearance";
}

export function detectJobEligibilityRestrictions(
  text: string | null | undefined
): JobEligibilityDetection {
  if (!text || text.length < 10) return EMPTY_RESULT;

  const countries: string[] = [];
  const evidenceParts: string[] = [];

  if (US_CITIZEN_PATTERN.test(text)) {
    countries.push("United States");
    const m = US_CITIZEN_PATTERN.exec(text);
    if (m) evidenceParts.push(extractSnippet(text, m.index, m[0].length));
  }
  if (CANADA_CITIZEN_PATTERN.test(text)) {
    countries.push("Canada");
    const m = CANADA_CITIZEN_PATTERN.exec(text);
    if (m) evidenceParts.push(extractSnippet(text, m.index, m[0].length));
  }
  const genericMatch = GENERIC_CITIZEN_PATTERN.exec(text);
  if (genericMatch) {
    const demonym = (genericMatch[1] ?? genericMatch[2] ?? "").trim();
    if (demonym && !countries.some((c) => c.toLowerCase() === demonym.toLowerCase())) {
      countries.push(demonym);
      evidenceParts.push(extractSnippet(text, genericMatch.index, genericMatch[0].length));
    }
  }

  let exportControlRestricted = false;
  const exportMatch = EXPORT_CONTROL_PATTERN.exec(text);
  if (exportMatch) {
    exportControlRestricted = true;
    evidenceParts.push(extractSnippet(text, exportMatch.index, exportMatch[0].length));
  }
  const clearanceMatch = CLEARANCE_PATTERN.exec(text);
  if (clearanceMatch) {
    exportControlRestricted = true;
    evidenceParts.push(extractSnippet(text, clearanceMatch.index, clearanceMatch[0].length));
  }

  const requiresCitizenship = countries.length > 0;
  const eligibilityRestricted = requiresCitizenship || exportControlRestricted;
  if (!eligibilityRestricted) return EMPTY_RESULT;

  const evidence = evidenceParts.join(" | ").slice(0, MAX_EVIDENCE_LENGTH);

  return {
    eligibilityRestricted,
    requiresCitizenship,
    citizenshipCountries: requiresCitizenship ? countries : null,
    exportControlRestricted,
    evidence: evidence || null,
  };
}
