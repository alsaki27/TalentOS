// Repairs application_ai_workflows rows stuck in the "forced completed"
// state: status='completed' with completed_at IS NULL. That combination is
// impossible through any real code path in this app — createWorkflow()
// always inserts 'queued', finalizeWorkflow()'s completion transaction and
// updateWorkflowStatus() both always stamp completed_at the moment they set
// status='completed'. So a row with status='completed' and no completed_at
// was written directly against the database, outside this application,
// bypassing the real pipeline entirely (no resume ever generated for most
// of them; ae_stage/current_stage left mid-air). completed_at IS NULL is
// therefore a precise, data-proven signature — not a guess, and not tied to
// any specific candidate or workflow ID.
//
// This does not hand-write any resume content, score, or stage value.
// For each affected workflow it uses the SAME functions the app's own UI
// already calls:
//   - If a real, successful application_final_polish artifact already
//     exists (the AI genuinely finished before something force-completed
//     the row): finalizeWorkflow() — the real completion path — so the
//     already-paid-for AI output gets a proper application_resume_versions
//     row instead of being discarded.
//   - Otherwise: rerunFromStage(id, 0) — the same function behind the
//     Kanban board's "Rerun from Job Lens" button — puts the workflow back
//     into the normal queued state so the existing dispatcher (self-chaining
//     backgroundDispatch + the 5-minute GitHub Actions cron) picks it up and
//     runs the real four-agent pipeline, exactly like any other workflow.
//
// Defaults to a dry run; nothing is written unless --apply is passed,
// matching this repo's convention for every other backfill/repair script.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/restart-forced-completed-workflows.ts [--apply] [--limit=N]

import { query, queryOne, execute } from "../src/server/db/neon";
import { listArtifacts } from "../src/server/repositories/applicationAiWorkflowRepository";
import { finalizeWorkflow } from "../src/lib/ai/application-agents/finalizationService";
import { rerunFromStage } from "../src/server/services/applicationAiWorkflowService";

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
  }>(
    `SELECT w.id, w.application_id, c.name AS candidate_name, j.title AS job_title, j.company, w.created_at
     FROM application_ai_workflows w
     JOIN applications a ON a.id = w.application_id
     JOIN candidates c ON c.id = a.candidate_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE w.status = 'completed' AND w.completed_at IS NULL
     ORDER BY w.created_at DESC
     LIMIT $1`,
    [limit]
  );

  console.log(`Found ${rows.length} workflow(s) with status='completed' and completed_at IS NULL.\n`);

  let finalizedReal = 0;
  let requeued = 0;
  let errored = 0;
  const problems: string[] = [];

  for (const row of rows) {
    const label = `${row.candidate_name} — "${row.job_title ?? "?"}" @ ${row.company ?? "?"} (workflow ${row.id}, created ${row.created_at})`;

    const artifacts = await listArtifacts(row.id);
    const finalPolish = artifacts.find((a) => a.automation_id === "application_final_polish");

    if (finalPolish) {
      if (!apply) {
        console.log(`WOULD FINALIZE (real Final Polish output already exists): ${label}`);
        continue;
      }
      try {
        const versionId = await finalizeWorkflow(row.id, undefined, artifacts);
        if (versionId) {
          console.log(`FINALIZED: ${label} -> resume version ${versionId}`);
          finalizedReal++;
        } else {
          console.log(`FINALIZE RETURNED NULL (unexpected — check manually): ${label}`);
          errored++;
          problems.push(label);
        }
      } catch (err: any) {
        console.error(`FINALIZE FAILED: ${label}\n    ${err?.message ?? err}`);
        errored++;
        problems.push(`${label} — ${err?.message ?? err}`);
      }
    } else {
      if (!apply) {
        console.log(`WOULD RE-QUEUE from stage 0 (no real AI output exists yet): ${label}`);
        continue;
      }
      try {
        await rerunFromStage(row.id, 0);
        console.log(`RE-QUEUED: ${label}`);
        requeued++;
      } catch (err: any) {
        console.error(`RE-QUEUE FAILED: ${label}\n    ${err?.message ?? err}`);
        errored++;
        problems.push(`${label} — ${err?.message ?? err}`);
      }
    }
  }

  if (apply && requeued > 0) {
    // Same as every other real retry/rerun/restart action in this app
    // (see src/app/api/application-ai-workflows/[id]/route.ts) — kick the
    // dispatcher once so processing starts promptly instead of waiting for
    // the next 5-minute cron tick. The cron keeps driving it from here.
    const baseUrl = process.env.TALENTOS_BASE_URL || "https://talent.skarion.com";
    try {
      const res = await fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
      });
      console.log(`\nKicked dispatcher: HTTP ${res.status}`);
    } catch (err: any) {
      console.warn(`\nCould not kick dispatcher (the 5-minute cron will still pick these up): ${err?.message ?? err}`);
    }
  }

  console.log("\n================ SUMMARY ================");
  console.log(`Total: ${rows.length}`);
  if (apply) {
    console.log(`Finalized with real AI output: ${finalizedReal}`);
    console.log(`Re-queued into the normal pipeline: ${requeued}`);
    console.log(`Errors: ${errored}`);
    if (problems.length > 0) {
      console.log(`\nNeeds manual review:`);
      problems.forEach((p) => console.log(`  - ${p}`));
    }
  } else {
    console.log("\nThis was a dry run — re-run with --apply to actually repair these.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Script failed:", err);
    process.exit(1);
  });
