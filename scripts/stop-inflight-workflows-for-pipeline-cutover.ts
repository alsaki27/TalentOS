// One-time pipeline cutover (2026-09-29): stop every application_ai_workflow
// still actively running the OLD pipeline (queued or running) and mark it
// failed with an explicit reason, so none of them finish mid-flight under a
// mix of old/new prompt and schema behavior once the Waste Removal & Quality
// Hardening plan's changes deploy. The user will manually retry each one
// (Application Queue's "Retry" action resumes from its current stage - see
// retryWorkflow - and works on any workflow left in status 'failed').
//
// Deliberately excludes 'waiting' (human_review) workflows: those already
// finished generation and are just paused for a human decision on already-
// produced output - nothing about them is "currently generating," so
// stopping them would only destroy good, completed work for no reason.
//
// Reversible: this only sets status='failed' + last_error, it never deletes
// artifacts, stage runs, or the workflow row itself - Retry/Restart both
// still work normally afterward.
//
// Usage: npx tsx --env-file=.env scripts/stop-inflight-workflows-for-pipeline-cutover.ts

import { query } from "../src/server/db/neon";
import { failWorkflowForCutover } from "../src/server/services/applicationAiWorkflowService";

const REASON = "Stopped for pipeline cutover (2026-09-29): superseded by the AI Resume Pipeline Waste Removal & Quality Hardening plan. Retry manually once the candidate/job is ready to re-run under the new pipeline.";

interface Row {
  id: string;
  application_id: string;
  status: string;
  current_stage: number;
  started_by: string | null;
  created_at: string;
}

async function main() {
  const rows = await query<Row>(
    `SELECT id, application_id, status, current_stage, started_by, created_at
       FROM application_ai_workflows
      WHERE status IN ('queued', 'running')
      ORDER BY created_at ASC`
  );

  console.log(`Found ${rows.length} in-flight workflow(s) (status queued/running) to stop.\n`);
  for (const r of rows) {
    console.log(`  ${r.id}  app=${r.application_id}  status=${r.status}  stage=${r.current_stage}  started_by=${r.started_by ?? "(system)"}  created_at=${r.created_at}`);
  }
  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log(`\nMarking all ${rows.length} workflow(s) as failed...`);
  let done = 0;
  for (const r of rows) {
    await failWorkflowForCutover(r.id, REASON);
    done++;
  }
  console.log(`\nDone. ${done} workflow(s) marked failed and their applications synced to resume_generation_status='failed'.`);
  console.log(`Retry any of them later via the Application Queue's "Retry" action (resumes from its current stage) or "Restart" (from scratch).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("stop-inflight-workflows-for-pipeline-cutover failed:", err);
  process.exit(1);
});
