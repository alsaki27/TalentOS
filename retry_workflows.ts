import { query } from "./src/server/db/neon";
import { retryWorkflow } from "./src/server/services/applicationAiWorkflowService";

async function main() {
  const since = "2026-08-24T23:00:00Z";
  console.log(`Finding failed workflows since ${since}...`);

  const failedWorkflows = await query<{ id: string }>(
    `SELECT id FROM application_ai_workflows WHERE status = 'failed' AND created_at >= $1`,
    [since]
  );

  console.log(`Found ${failedWorkflows?.length ?? 0} failed workflows.`);

  let retried = 0;
  for (const wf of failedWorkflows ?? []) {
    try {
      await retryWorkflow(wf.id);
      console.log(`Successfully retried workflow: ${wf.id}`);
      retried++;
    } catch (err) {
      console.error(`Failed to retry workflow ${wf.id}:`, err);
    }
  }

  console.log(`Finished retrying ${retried} workflows.`);
  process.exit(0);
}

main().catch(console.error);
