// src/server/services/readinessService.ts
// TalentOS Readiness Engine — pure, deterministic scoring.
// Ported from talentOS-B packages/readiness-engine/src/index.ts (verbatim logic).
// Zero dependencies. The readiness engine computes a skill-match score by
// intersecting a known skill vocabulary with JD text terms, then checking
// which of those required skills the candidate has evidenced.
//
// evidencedSkills is computed from the candidate's verified_skills text[]
// column UNION skills referenced in candidate_evidence.related_skills,
// per the schema-overlap resolution (no separate candidate_skills table).

export interface ReadinessInput {
  jdText: string;
  evidencedSkills: string[];
  claimedSkills: string[];
  knownSkillVocabulary: string[];
}

export interface ReadinessOutput {
  required: string[];
  matched: string[];
  missing: string[];
  flagged: string[];
  score: number;
  threshold: number;
}

export const DEFAULT_THRESHOLD = 70;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.#+]/g, '')
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;|()]+/)
    .map(normalize)
    .filter(Boolean);
}

/**
 * Pure, deterministic readiness score.
 *
 *   required = vocabulary ∩ terms(jdText)
 *   matched  = required ∩ evidencedSkills
 *   missing  = required − matched
 *   flagged  = claimedSkills − evidencedSkills
 *   score    = required.length ? round(100 * |matched| / |required|) : 50
 */
export function computeReadinessScore(
  input: ReadinessInput,
  threshold: number = DEFAULT_THRESHOLD
): ReadinessOutput {
  const normalizedVocabulary = input.knownSkillVocabulary.map(normalize);
  const normalizedEvidenced = input.evidencedSkills.map(normalize);
  const normalizedClaimed = input.claimedSkills.map(normalize);
  const jdTerms = new Set(tokenize(input.jdText));

  const required = normalizedVocabulary.filter((w) => jdTerms.has(w));
  const matched = required.filter((w) => normalizedEvidenced.includes(w));
  const missing = required.filter((w) => !normalizedEvidenced.includes(w));
  const flagged = normalizedClaimed.filter((w) => !normalizedEvidenced.includes(w));

  const score = required.length > 0
    ? Math.round((100 * matched.length) / required.length)
    : 50;

  return { required, matched, missing, flagged, score, threshold };
}

/**
 * Compute evidencedSkills from the candidate's verified_skills column
 * UNION skills referenced in candidate_evidence.related_skills.
 * This replaces the separate candidate_skills table per the schema-overlap
 * resolution — no parallel skill ledger.
 */
export async function getEvidencedSkills(
  candidateId: string,
  queryFn: (sql: string, params: any[]) => Promise<any[]>
): Promise<{ evidenced: string[]; claimed: string[] }> {
  const verifiedSkillsRow = await queryFn(
    `SELECT verified_skills FROM candidates WHERE id = $1`,
    [candidateId]
  );

  const verifiedSkills: string[] = verifiedSkillsRow[0]?.verified_skills ?? [];

  const evidenceRows = await queryFn(
    `SELECT DISTINCT unnest(related_skills) AS skill FROM candidate_evidence
     WHERE candidate_id = $1`,
    [candidateId]
  );

  const evidenceSkills: string[] = evidenceRows.map((r: any) => r.skill).filter(Boolean);

  const evidenced = Array.from(new Set([...verifiedSkills, ...evidenceSkills]));

  // "Claimed" = evidenced (from verified_skills) — if we can't distinguish
  // verified from claimed yet, they're the same set. When evidence rows
  // exist but verified_skills is empty, claimed = evidence skills.
  const claimed = evidenced.length > 0 ? evidenced : [];

  return { evidenced, claimed };
}