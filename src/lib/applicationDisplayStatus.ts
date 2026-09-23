// Shared "raw application status -> dashboard display bucket" mapping, used
// by both /api/candidate-dashboard (all-candidates view) and
// /api/candidates/[id]/applications/dashboard (per-candidate Applications
// tab) so the two surfaces can never drift out of agreement on what counts
// as what - they were previously two independent copies of this exact
// table.
//
// Bug fixed here: 'assigned' / 'stacked' / 'in_progress' (an application an
// AE has picked up but not yet actually applied) were bucketed into
// "Applied", the same bucket as a genuinely-applied application - so the
// dashboard's "Applied" count was really "applied or still being worked",
// nearly equal to the grand total. They now bucket into "In Progress"
// instead. 'applied' itself, and everything from 'replied' (Screening)
// through 'withdrawn' (Rejected), is unchanged - those are real,
// human-confirmed pipeline stages and were never the problem.
export const DISPLAY_GROUPS: Record<string, string> = {
  applied: "Applied",
  replied: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Rejected",
  assigned: "In Progress",
  stacked: "In Progress",
  in_progress: "In Progress",
};

// Inverse of DISPLAY_GROUPS: display group -> raw status/ae_stage values
// that belong to it, so a "statusGroup" filter can be pushed into SQL.
export const STATUSES_BY_GROUP: Record<string, string[]> = {};
for (const rawStatusKey in DISPLAY_GROUPS) {
  const groupName = DISPLAY_GROUPS[rawStatusKey];
  if (!STATUSES_BY_GROUP[groupName]) STATUSES_BY_GROUP[groupName] = [];
  STATUSES_BY_GROUP[groupName].push(rawStatusKey);
}

// The computed "display status" every filter/sort/count query must agree on:
// applications marked applied via ae_stage collapse to the raw "applied"
// status regardless of the legacy a.status value underneath - but only while
// the AE pipeline itself is what set ae_stage='applied'. Without the
// "AND a.status IN (...)" guard, an application the AI email-triage pipeline
// later moved to e.g. 'interview' would still display as "Applied" forever,
// since ae_stage stays 'applied' from the original AE hand-off and this
// expression would keep masking the real status underneath it.
export const STATUS_EXPR = "(CASE WHEN a.ae_stage = 'applied' AND a.status IN ('assigned', 'stacked', 'in_progress') THEN 'applied' ELSE a.status END)";

/** Zero-initialized display-bucket counts, so every dashboard filter box always has a value, never appears only when non-zero. */
export function emptyStatusCounts(): Record<string, number> {
  return { Applied: 0, "In Progress": 0, Screening: 0, Interview: 0, Offer: 0, Rejected: 0 };
}
