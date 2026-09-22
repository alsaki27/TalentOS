// Recovers application_ai_workflows rows that were incorrectly marked
// 'failed' with "No Final Polish artifact found" even though a real,
// complete application_final_polish artifact exists for them. Root cause:
// Cloudflare Hyperdrive query caching (enabled on the talentos-pg binding
// since the 2026-09-21 VPS migration) served finalizeWorkflow()'s
// listArtifacts() call a stale pre-artifact result read moments earlier in
// the same request. Fixed going forward in finalizationService.ts /
// applicationAiWorkflowService.ts (finalizeWorkflow now takes a preloaded
// artifact list instead of re-querying). This script repairs the rows that
// were already marked failed before that fix was deployed.
//
// Only ever touches a workflow when ALL of these hold:
//   - status = 'failed'
//   - a real application_final_polish artifact exists for it
//   - the application has NOT already been linked to a resume version
//     (so this can never overwrite a real, already-finalized resume)
//
// Defaults to a dry run; nothing is written unless --apply is passed,
// matching this repo's convention for every other backfill/repair script.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/recover-orphaned-resume-workflows.ts [--apply] [--limit=N]

import { query, queryOne } from "../src/server/db/neon";
import { listArtifacts } from "../src/server/repositories/applicationAiWorkflowRepository";
import { finalizeWorkflow } from "../src/lib/ai/application-agents/finalizationService";

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  return { apply, limit: limitArg ? parseInt(limitArg.split("=")[1], 10) : 1000 };
}

async function main() {
  const { apply, limit } = parseArgs();
  console.log(`Mode: ${apply ? "APPLY (will write repairs)" : "DRY RUN (no writes)"} — limit ${limit}\n`);

  const rows = await query<{
    id: string;
    application_id: string;
    candidate_name: string;
    job_title: string | null;
    company: string | null;
    created_at: string;
    recovery_count: number;
  }>(
    `SELECT w.id, w.application_id, c.name AS candidate_name,
            j.title AS job_title, j.company, w.created_at, w.recovery_count
     FROM application_ai_workflows w
     JOIN applications a ON a.id = w.application_id
     JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE w.status = 'failed'
       AND EXISTS (
         SELECT 1 FROM application_ai_artifacts art
         WHERE art.workflow_id = w.id AND art.automation_id = 'application_final_polish'
       )
       AND a.tailored_resume_version_id IS NULL
     ORDER BY w.created_at DESC
     LIMIT $1`,
    [limit]
  );

  console.log(`Found ${rows.length} orphaned workflow(s) with a real Final Polish artifact and no linked resume.\n`);

  let recovered = 0;
  let stillFailed = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const label = `${row.candidate_name} — "${row.job_title ?? "?"}" @ ${row.company ?? "?"} (workflow ${row.id}, created ${row.created_at}, recovery_count=${row.recovery_count})`;

    if (!apply) {
      console.log(`WOULD RECOVER: ${label}`);
      continue;
    }

    try {
      // No lockVersion: this workflow is 'failed', not 'running' — there is
      // no live claim to protect, this is an offline repair. Pass a fresh,
      // just-fetched artifact list (this script call is far outside any
      // Hyperdrive cache window) rather than relying on a cached read.
      const artifacts = await listArtifacts(row.id);
      const versionId = await finalizeWorkflowWithArtifacts(row.id, artifacts);
      if (versionId) {
        console.log(`RECOVERED: ${label} -> resume version ${versionId}`);
        recovered++;
      } else {
        console.log(`STILL INCOMPLETE (no final_polish data on the artifact?): ${label}`);
        stillFailed++;
        failures.push(label);
      }
    } catch (err: any) {
      console.error(`FAILED TO RECOVER: ${label}\n    ${err?.message ?? err}`);
      stillFailed++;
      failures.push(`${label} — ${err?.message ?? err}`);
    }
  }

  console.log("\n================ SUMMARY ================");
  console.log(`Candidates: ${rows.length}`);
  if (apply) {
    console.log(`Recovered:   ${recovered}`);
    console.log(`Still bad:   ${stillFailed}`);
    if (failures.length > 0) {
      console.log(`\nNeeds manual review:`);
      failures.forEach((f) => console.log(`  - ${f}`));
    }
  } else {
    console.log("\nThis was a dry run — re-run with --apply to actually recover these.");
  }
}

async function finalizeWorkflowWithArtifacts(workflowId: string, artifacts: Awaited<ReturnType<typeof listArtifacts>>) {
  // finalizeWorkflow only takes (id, lockVersion, preloadedArtifacts) — no
  // separate "artifacts-only" entry point exists, so call it directly with
  // lockVersion undefined (offline repair, no live claim) and the fresh list.
  return finalizeWorkflow(workflowId, undefined, artifacts);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Recovery script failed:", err);
    process.exit(1);
  });
