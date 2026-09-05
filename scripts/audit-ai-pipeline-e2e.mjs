// Read-only E2E audit for real, completed application pipeline logs.
// It intentionally reads stored stage/input/output records and never creates,
// retries, updates, or finalizes an application.

import { neon } from "@neondatabase/serverless";

const rawUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || process.env.TALENTOS_DB_URL;
if (!rawUrl) throw new Error("A configured TalentOS database URL is required");

const url = new URL(rawUrl);
url.searchParams.delete("channel_binding");
const sql = neon(url.toString());
const primaryAgents = [
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
];

const workflows = await sql.query(
  `SELECT w.id AS workflow_id, w.application_id, w.status, w.current_stage,
          w.created_at, w.completed_at
     FROM application_ai_workflows w
     JOIN application_ai_stage_runs sr ON sr.workflow_id = w.id
    WHERE w.status = 'completed'
    GROUP BY w.id, w.application_id, w.status, w.current_stage, w.created_at, w.completed_at
   HAVING COUNT(DISTINCT sr.automation_id) FILTER (
            WHERE sr.automation_id = ANY($1::text[]) AND sr.status = 'success'
          ) = 4
    ORDER BY w.completed_at DESC NULLS LAST, w.created_at DESC
    LIMIT 10`,
  [primaryAgents],
);

if (workflows.length < 10) {
  throw new Error(`Only ${workflows.length} completed four-stage logs were available for the read-only E2E audit`);
}

const ids = workflows.map((row) => row.workflow_id);
const stageRuns = await sql.query(
  `SELECT id, workflow_id, automation_id, sequence_number, attempt_number,
          status, input_artifact_id, output_artifact_id, provider, model,
          latency_ms, error_code
     FROM application_ai_stage_runs
    WHERE workflow_id = ANY($1::uuid[])
    ORDER BY workflow_id, sequence_number, attempt_number`,
  [ids],
);
const artifacts = await sql.query(
  `SELECT id, workflow_id, automation_id, sequence_number, schema_version,
          content_hash
     FROM application_ai_artifacts
    WHERE workflow_id = ANY($1::uuid[])
    ORDER BY workflow_id, sequence_number, created_at`,
  [ids],
);

const artifactIds = new Set(artifacts.map((row) => row.id));
const byWorkflow = new Map(ids.map((id) => [id, []]));
for (const row of stageRuns) byWorkflow.get(row.workflow_id)?.push(row);

const results = workflows.map((workflow) => {
  const rows = byWorkflow.get(workflow.workflow_id) ?? [];
  const successful = rows.filter((row) => row.status === "success" && primaryAgents.includes(row.automation_id));
  const duplicateSuccessfulSequences = primaryAgents.filter(
    (agent) => successful.filter((row) => row.automation_id === agent).length !== 1,
  );
  const missingLinkedArtifacts = successful.filter(
    (row) => !row.input_artifact_id || !row.output_artifact_id ||
      !artifactIds.has(row.input_artifact_id) || !artifactIds.has(row.output_artifact_id),
  );
  const sequence = successful.map((row) => row.sequence_number).sort((a, b) => a - b);
  const passed = workflow.current_stage >= 4 &&
    sequence.join(",") === "1,2,3,4" &&
    duplicateSuccessfulSequences.length === 0 &&
    missingLinkedArtifacts.length === 0;

  return {
    workflow_id: workflow.workflow_id,
    application_id: workflow.application_id,
    completed_at: workflow.completed_at,
    stage_count: rows.length,
    successful_stage_count: successful.length,
    sequence,
    duplicate_successful_sequences: duplicateSuccessfulSequences,
    missing_linked_artifacts: missingLinkedArtifacts.map((row) => row.automation_id),
    passed,
  };
});

const report = {
  command: "audit_ai_pipeline_e2e",
  mode: "verify",
  environment: "production-read-only",
  scope: { workflow_count: workflows.length, agents: primaryAgents },
  counts: {
    selected: results.length,
    passed: results.filter((row) => row.passed).length,
    failed: results.filter((row) => !row.passed).length,
    stage_rows_read: stageRuns.length,
    artifacts_read: artifacts.length,
  },
  results,
  mutation: { attempted: false, rows_changed: 0 },
};

console.log(JSON.stringify(report, null, 2));
