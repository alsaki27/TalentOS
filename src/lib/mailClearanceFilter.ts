// Keyword match against a job's title/description - jobs have no structured
// clearance field, so this is a best-effort text signal. Federal and
// clearance-required roles are never wanted in the inbox at all: this is a
// permanent exclusion applied to every mail query, not a togglable filter,
// and it applies even with "show hidden" mail included. Shared between
// gmail-communications (the mail list itself) and inbox/counts (category
// breakdown) so both agree on what counts as excluded.
export const CLEARANCE_KEYWORDS = [
  "%security clearance%", "%secret clearance%", "%top secret%", "%ts/sci%",
  "%ts-sci%", "%public trust%", "%dod clearance%", "%government clearance%",
  "%clearance required%", "%clearance eligib%", "%active clearance%",
  "%federal government%", "%federal agency%", "%u.s. citizen%", "%us citizen%",
];

/**
 * Builds the SQL exclusion predicate against a jobs table aliased `j`, using
 * the given already-numbered $N placeholder for the CLEARANCE_KEYWORDS array
 * parameter (added by the caller via its own param-numbering scheme).
 */
export function clearanceExclusionSql(clearanceParam: string): string {
  return `(j.title IS NULL OR j.title NOT ILIKE ANY(${clearanceParam}))
     AND (j.description_text IS NULL OR j.description_text NOT ILIKE ANY(${clearanceParam}))
     AND (j.description_html IS NULL OR j.description_html NOT ILIKE ANY(${clearanceParam}))`;
}
