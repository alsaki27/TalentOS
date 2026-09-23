// src/lib/ai/application-agents/requirementCoverage.ts
// Deterministic requirement-coverage engine shared by Resume Forge, Final
// Polish, and finalization scoring. No AI calls - pure functions over the
// classified job analysis (requirementAnalysis) and a draft's text.
//
// The single source of truth for:
//   - "did the draft actually surface this supported requirement?"
//   - "is this absence a candidate evidence gap or a missed tailoring pass?"

import type {
  RequirementAnalysisEntry,
  RequirementCoverageRow,
  ResumeDraftV1,
} from "./schemas";

/**
 * Tokens that can never prove keyword coverage by themselves. Multi-word JD
 * requirements like "5+ years OSP design" carry these as qualifiers - a
 * match on "years" must not count as surfacing the requirement.
 */
const NON_SIGNIFICANT_TOKENS = new Set([
  "years",
  "year",
  "with",
  "plus",
  "must",
  "have",
  "has",
  "required",
  "preferred",
  "experience",
  "experiencein",
  "and",
  "the",
  "for",
  "per",
  "of",
  "strong",
  "knowledge",
  "working",
  "work",
  "using",
  "proficiency",
  "familiarity",
  "understanding",
  "ability",
  "skills",
  "skill",
]);

/**
 * Split a requirement phrase into tokens that can meaningfully prove
 * coverage. Alphanumeric runs (dots treated as separators so "Node.js"
 * yields the meaningful token "node"); 2-letter ALL-CAPS acronyms are kept
 * (PE, QA, OS) while other short tokens, pure-numeric tokens ("5+"), and
 * qualifier words are dropped.
 */
export function significantTokens(value: string): string[] {
  const rawTokens = value.match(/[a-z0-9+#]+/gi) ?? [];
  const tokens: string[] = [];
  for (const raw of rawTokens) {
    const token = raw.toLocaleLowerCase("en-US");
    if (NON_SIGNIFICANT_TOKENS.has(token)) continue;
    if (!/[a-z]/i.test(token)) continue; // "5+" style numeric qualifiers
    if (token.length >= 3) {
      tokens.push(token);
      continue;
    }
    if (token.length === 2 && raw === raw.toUpperCase()) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * True when any significant token of the requirement appears in the text.
 * Intentional substring semantics ("AutoCAD" matches "AutoCAD Civil 3D"),
 * case-insensitive, tolerance for punctuation differences.
 */
export function requirementMatchesText(requirement: string, text: string): boolean {
  if (!requirement || !text) return false;
  const tokens = significantTokens(requirement);
  if (tokens.length === 0) return false;
  const normalized = text.toLocaleLowerCase("en-US");
  return tokens.some((token) => normalized.includes(token));
}

/** Every searchable chunk of the draft, keyed by where a keyword lives. */
export function draftTextLocations(draft: Pick<ResumeDraftV1, "skills" | "experience">): {
  skillsText: string;
  bulletsText: string;
} {
  const skillsText = (draft.skills ?? [])
    .map((group) => (group.skills ?? []).join(" "))
    .join(" ");
  const bulletsText = (draft.experience ?? [])
    .map((entry) => (entry.bullets ?? []).join(" "))
    .join(" ");
  return { skillsText, bulletsText };
}

/**
 * Build the coverage matrix for a draft against the classified requirements.
 * surfaced=false rows are the gaps; gapReason explains whether the gap is a
 * candidate evidence gap (nothing could truthfully be added) or a missed
 * tailoring pass (supported material exists but the draft didn't use it).
 */
export function buildRequirementCoverage(
  analysis: { requirementAnalysis?: RequirementAnalysisEntry[] } | null | undefined,
  draft: Pick<ResumeDraftV1, "skills" | "experience">
): RequirementCoverageRow[] {
  const entries = Array.isArray(analysis?.requirementAnalysis) ? analysis.requirementAnalysis : [];
  const { skillsText, bulletsText } = draftTextLocations(draft);
  return entries.map((entry) => {
    const inSkills = requirementMatchesText(entry.requirement, skillsText);
    const inBullets = requirementMatchesText(entry.requirement, bulletsText);
    const surfaced = inSkills || inBullets;
    const placement: RequirementCoverageRow["placement"] =
      inSkills && inBullets ? "both" : inSkills ? "skills" : inBullets ? "bullet" : "none";

    // Re-derive addability here (not trusting the input) so this helper stays
    // authoritative even when called with un-normalized analysis data: a
    // supported requirement is addable only when it cites source evidence.
    const supported =
      entry.status === "supported_by_resume" || entry.status === "supported_but_not_surfaced";
    const addable = supported && entry.safeToAdd === true && (entry.sourceEvidence?.length ?? 0) > 0;

    let gapReason: RequirementCoverageRow["gapReason"] = null;
    if (!surfaced) {
      if (entry.status === "unsupported" || entry.status === "hard_blocker") {
        gapReason = "candidate_evidence_gap";
      } else if (addable) {
        gapReason = "missed_tailoring";
      }
    }

    return {
      requirement: entry.requirement,
      status: entry.status,
      surfaced,
      placement,
      gapReason,
    };
  });
}

/**
 * Supported requirements the draft failed to surface. These are the only
 * items the bounded "supported but missed" retry may ask the agent to weave
 * in - unsupported/hard_blocker items are never retried (no prompt can
 * truthfully add a missing credential).
 */
export function listMissedSupported(rows: RequirementCoverageRow[]): RequirementCoverageRow[] {
  return rows.filter(
    (row) => !row.surfaced && row.gapReason === "missed_tailoring"
  );
}

/** Gap rows that are candidate evidence gaps - surfaced to the AE as "candidate evidence gap", never as AI failure. */
export function listEvidenceGaps(rows: RequirementCoverageRow[]): RequirementCoverageRow[] {
  return rows.filter((row) => row.gapReason === "candidate_evidence_gap");
}
