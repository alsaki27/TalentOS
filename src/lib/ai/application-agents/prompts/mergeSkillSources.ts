// Shared by jobLens.ts and resumeForge.ts's prompt builders.
//
// candidates.verified_skills and candidate_source_of_truth.confirmed_skills
// are two genuinely separate DB columns, each maintained by a different part
// of the app - but every prompt that used both sent them as two
// un-deduplicated JSON arrays with no indication that the same skill could
// appear in both, wasting tokens and giving the model no reason to treat a
// skill named in both lists as more certain than one named in only one.
// Merging them here removes the literal duplication while keeping the
// distinction (via a provenance suffix) a model could plausibly use to
// weight its confidence.

/**
 * Merges two skill-name lists into one deduplicated list, case/whitespace-
 * insensitively, tagging each unique skill with which source(s) named it.
 * Preserves the confirmed-skills list's order first (it is the broader,
 * primary source per every prompt's own wording), then appends any
 * verified-only skills in their given order.
 */
export function mergeSkillSources(confirmedSkills: string[], verifiedSkills: string[]): string[] {
  const normalize = (s: string) => s.trim().toLowerCase();

  const confirmedSet = new Set(confirmedSkills.filter((s) => typeof s === "string" && s.trim()).map(normalize));
  const verifiedSet = new Set(verifiedSkills.filter((s) => typeof s === "string" && s.trim()).map(normalize));

  const seen = new Set<string>();
  const merged: string[] = [];

  const tagFor = (key: string): string => {
    const inConfirmed = confirmedSet.has(key);
    const inVerified = verifiedSet.has(key);
    if (inConfirmed && inVerified) return "(verified, confirmed)";
    if (inVerified) return "(verified)";
    return "(confirmed)";
  };

  for (const raw of confirmedSkills) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = normalize(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(`${raw.trim()} ${tagFor(key)}`);
  }
  for (const raw of verifiedSkills) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = normalize(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(`${raw.trim()} ${tagFor(key)}`);
  }

  return merged;
}
