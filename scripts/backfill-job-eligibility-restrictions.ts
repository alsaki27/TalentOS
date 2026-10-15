// One-off backfill for migration 119 (jobs.eligibility_restricted and its
// sibling columns). Live job-writing paths already compute these at write
// time going forward (jobsRepository.ts's createJob/createJobs/updateJob/
// recordEnrichmentAttempt, and the manual edit-job PATCH route) - this
// script only catches rows that existed before that wiring shipped.
//
// Scope (per explicit instruction, not assumed): jobs created in the last 10
// days (an easily-checkable, bounded window to confirm correctness) PLUS
// every job that has ever been logged to a candidate (has at least one row
// in `applications`), regardless of age - a real EXISTS join against
// applications.job_id, not an approximation.
//
// Dry-run by default: prints how many rows would flip eligibility_restricted
// to true, plus a sample of the matched evidence text, and writes nothing.
// Pass --confirm to actually apply the UPDATE. Only ever writes the 6
// eligibility columns - never touches title, company, is_active, or
// anything else.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-job-eligibility-restrictions.ts
//   npx tsx --env-file=.env.local scripts/backfill-job-eligibility-restrictions.ts --confirm

import { query, execute } from "../src/server/db/neon";
import { detectJobEligibilityRestrictions } from "../src/lib/jobEligibilityRestrictions";

const CONFIRM = process.argv.includes("--confirm");
const BATCH_SIZE = 500;
const SAMPLE_SIZE = 10;

interface CandidateRow {
  id: string;
  title: string | null;
  company: string | null;
  description_text: string | null;
}

async function loadCandidateRows(): Promise<CandidateRow[]> {
  return query<CandidateRow>(
    `SELECT id, title, company, description_text
     FROM jobs
     WHERE created_at >= NOW() - INTERVAL '10 days'
        OR id IN (SELECT DISTINCT job_id FROM applications WHERE job_id IS NOT NULL)`
  );
}

async function main() {
  console.log(`Loading candidate rows (last 10 days OR already logged to a candidate)...`);
  const rows = await loadCandidateRows();
  console.log(`Loaded ${rows.length} candidate row(s).\n`);

  const toUpdate: { id: string; title: string | null; company: string | null; detection: ReturnType<typeof detectJobEligibilityRestrictions> }[] = [];
  for (const row of rows) {
    const detection = detectJobEligibilityRestrictions(row.description_text);
    if (detection.eligibilityRestricted) {
      toUpdate.push({ id: row.id, title: row.title, company: row.company, detection });
    }
  }

  console.log(`${toUpdate.length} of ${rows.length} candidate row(s) would be tagged as eligibility_restricted.\n`);
  console.log(`Sample of up to ${SAMPLE_SIZE} matches (review before confirming):\n`);
  for (const match of toUpdate.slice(0, SAMPLE_SIZE)) {
    console.log(`  - "${match.title ?? "?"}" @ "${match.company ?? "?"}" (${match.id})`);
    console.log(`      citizenship: ${match.detection.requiresCitizenship} ${match.detection.citizenshipCountries ? `(${match.detection.citizenshipCountries.join(", ")})` : ""}`);
    console.log(`      export control / clearance: ${match.detection.exportControlRestricted}`);
    console.log(`      evidence: ${match.detection.evidence}`);
  }
  if (toUpdate.length > SAMPLE_SIZE) {
    console.log(`  ...and ${toUpdate.length - SAMPLE_SIZE} more not shown.`);
  }

  if (!CONFIRM) {
    console.log(`\nDry run only - nothing was written. Re-run with --confirm to apply ${toUpdate.length} update(s).`);
    return;
  }

  console.log(`\n--confirm passed. Writing ${toUpdate.length} update(s) in batches of ${BATCH_SIZE}...`);
  let written = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    for (const match of batch) {
      await execute(
        `UPDATE jobs SET
           eligibility_restricted = $1,
           requires_citizenship = $2,
           citizenship_countries = $3,
           export_control_restricted = $4,
           eligibility_restriction_evidence = $5,
           eligibility_detected_at = NOW()
         WHERE id = $6`,
        [
          match.detection.eligibilityRestricted,
          match.detection.requiresCitizenship,
          match.detection.citizenshipCountries,
          match.detection.exportControlRestricted,
          match.detection.evidence,
          match.id,
        ]
      );
      written++;
    }
    console.log(`  ...written ${written}/${toUpdate.length}`);
  }
  console.log(`Done. ${written} job(s) updated.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
