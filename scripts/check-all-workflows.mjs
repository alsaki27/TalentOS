import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// All workflows with their app info
const all = await c.query(`
  SELECT w.id, w.application_id, w.status, w.current_stage, w.last_error, w.created_at,
    c.name as candidate, j.title as job
  FROM application_ai_workflows w
  JOIN applications a ON w.application_id = a.id
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  ORDER BY w.created_at DESC
`);
console.log(`=== ALL WORKFLOWS (${all.rows.length}) ===`);
for (const w of all.rows) {
  console.log(`\n${w.id}`);
  console.log(`  App: ${w.application_id}`);
  console.log(`  Candidate: ${w.candidate}`);
  console.log(`  Job: ${w.job}`);
  console.log(`  Status: ${w.status} | Stage: ${w.current_stage}`);
  console.log(`  Error: ${w.last_error || "none"}`);
  console.log(`  Created: ${w.created_at}`);

  // Stage runs
  const stages = await c.query(`
    SELECT sequence_number, automation_id, status, attempt_number, error_message
    FROM application_ai_stage_runs WHERE workflow_id = $1 ORDER BY sequence_number
  `, [w.id]);
  console.log(`  Stages: ${stages.rows.length > 0 ? stages.rows.map(s => `${s.automation_id}=${s.status}`).join(", ") : "none"}`);
}

// Check if the deploy pipeline ran the migrations for the 4 agent automations
const agents = await c.query("SELECT id, label FROM ai_automations WHERE group_label = 'Agent Pipeline'");
console.log(`\n=== AGENT AUTOMATIONS ===`);
for (const a of agents.rows) console.log(`  ${a.id}: ${a.label}`);

await c.end();
