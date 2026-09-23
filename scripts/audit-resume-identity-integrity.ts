// Scans AI-tailored resumes across candidates and reports (or, with --apply,
// repairs) any drift on identity fields — personal info, job identity, and
// education identity — versus each resume's current base resume. Defaults to
// a dry run; nothing is written unless --apply is passed, matching this
// repo's convention for every other backfill/retriage script.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/audit-resume-identity-integrity.ts [--limit=200] [--candidate=<id>] [--apply]

import { query } from "../src/server/db/neon";
import { auditAndRepairResumeVersionIdentity } from "../src/lib/ai/application-agents/postFinalizeIdentityAudit";

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const candidateArg = args.find((a) => a.startsWith("--candidate="));
  return {
    apply,
    limit: limitArg ? parseInt(limitArg.split("=")[1], 10) : 200,
    candidateId: candidateArg ? candidateArg.split("=")[1] : null,
  };
}

async function main() {
  const { apply, limit, candidateId } = parseArgs();
  console.log(`Mode: ${apply ? "APPLY (will write repairs)" : "DRY RUN (no writes)"} — limit ${limit}${candidateId ? `, candidate ${candidateId}` : ""}\n`);

  const rows = await query<{
    id: string;
    candidate_id: string;
    candidate_name: string;
    job_title: string | null;
    company: string | null;
    created_at: string;
  }>(
    `SELECT arv.id, arv.candidate_id, c.name AS candidate_name, j.title AS job_title, j.company, arv.created_at
     FROM application_resume_versions arv
     JOIN candidates c ON c.id = arv.candidate_id
     LEFT JOIN jobs j ON j.id = arv.job_id
     WHERE arv.source_type = 'ai_agent' AND arv.base_resume_id IS NOT NULL
       ${candidateId ? "AND arv.candidate_id = $2" : ""}
     ORDER BY arv.created_at DESC
     LIMIT $1`,
    candidateId ? [limit, candidateId] : [limit]
  );

  console.log(`Checking ${rows.length} tailored resume version(s)...\n`);

  let checked = 0;
  let withMismatches = 0;
  let repaired = 0;
  const unrepairable: string[] = [];

  for (const row of rows) {
    const result = await auditAndRepairResumeVersionIdentity(row.id, { dryRun: !apply });
    if (!result.checked) continue;
    checked++;
    if (result.mismatches.length === 0) continue;

    withMismatches++;
    const label = `${row.candidate_name} — "${row.job_title ?? "?"}" @ ${row.company ?? "?"} (resume ${row.id}, ${row.created_at})`;
    console.log(`\n${apply && result.changed ? "REPAIRED" : "MISMATCH"}: ${label}`);
    result.mismatches.forEach((m) => console.log(`    ${m}`));
    if (apply && result.changed) repaired++;
    if (result.mismatches.some((m) => m.includes("not auto-repaired"))) unrepairable.push(label);
  }

  console.log("\n\n================ SUMMARY ================");
  console.log(`Checked:        ${checked}`);
  console.log(`With mismatch:  ${withMismatches}`);
  if (apply) console.log(`Repaired:       ${repaired}`);
  if (unrepairable.length > 0) {
    console.log(`\nNeeds human review (count mismatch, not auto-repaired):`);
    unrepairable.forEach((l) => console.log(`  - ${l}`));
  }
  if (withMismatches === 0) {
    console.log("\nNo identity-field drift found across any checked resume.");
  } else if (!apply) {
    console.log("\nThis was a dry run — re-run with --apply to write these repairs.");
  }
}

main().catch((err) => {
  console.error("Audit script failed:", err);
  process.exit(1);
});
