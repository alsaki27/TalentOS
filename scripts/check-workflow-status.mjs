import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// 1. Find the latest workflow for our test app
const wf = await c.query(`
  SELECT w.*, a.status as app_status, c.name as candidate, j.title as job
  FROM application_ai_workflows w
  JOIN applications a ON w.application_id = a.id
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  WHERE c.name LIKE 'Jane Test%'
  ORDER BY w.created_at DESC LIMIT 1
`);
if (wf.rows.length > 0) {
  console.log("=== WORKFLOW ===");
  console.log(`ID: ${wf.rows[0].id}`);
  console.log(`Status: ${wf.rows[0].status}`);
  console.log(`Stage: ${wf.rows[0].current_stage}`);
  console.log(`Error: ${wf.rows[0].last_error || "none"}`);
  console.log(`Created: ${wf.rows[0].created_at}`);
  console.log(`Started: ${wf.rows[0].started_at || "never"}`);
  console.log(`Completed: ${wf.rows[0].completed_at || "not yet"}`);

  // 2. Check stage runs
  const stages = await c.query(`
    SELECT * FROM application_ai_stage_runs
    WHERE workflow_id = $1
    ORDER BY sequence_number, attempt_number
  `, [wf.rows[0].id]);
  console.log(`\n=== STAGE RUNS (${stages.rows.length}) ===`);
  for (const s of stages.rows) {
    console.log(`  Stage ${s.sequence_number} (${s.automation_id})`);
    console.log(`    Status: ${s.status}`);
    console.log(`    Attempt: ${s.attempt_number}`);
    console.log(`    Provider: ${s.provider || "?"}`);
    console.log(`    Model: ${s.model || "?"}`);
    console.log(`    Error: ${s.error_message || "none"}`);
    console.log(`    Tokens: in=${s.input_tokens || 0} out=${s.output_tokens || 0}`);
    console.log(`    Cost: $${s.estimated_cost_usd || 0}`);
    console.log(`    Latency: ${s.latency_ms || 0}ms`);
    console.log(`    Started: ${s.started_at || "never"}`);
    console.log(`    Completed: ${s.completed_at || "not yet"}`);
  }

  // 3. Check artifacts
  const artifacts = await c.query(`
    SELECT * FROM application_ai_artifacts
    WHERE workflow_id = $1
    ORDER BY sequence_number
  `, [wf.rows[0].id]);
  console.log(`\n=== ARTIFACTS (${artifacts.rows.length}) ===`);
  for (const a of artifacts.rows) {
    console.log(`  ${a.automation_id} (v${a.schema_version})`);
    const data = a.data;
    if (data && typeof data === 'object') {
      if (data.skills) console.log(`    Skills: ${data.skills.length}`);
      if (data.experience) console.log(`    Experience: ${data.experience.length}`);
      if (data.requiredSkills) console.log(`    Required skills: ${data.requiredSkills.length}`);
      if (data.atsScore !== undefined) console.log(`    ATS Score: ${data.atsScore}`);
      if (data.recruiterScore !== undefined) console.log(`    Recruiter: ${data.recruiterScore}`);
      if (data.finalQaScore !== undefined) console.log(`    QA Score: ${data.finalQaScore}`);
      if (data.exportReady !== undefined) console.log(`    Export ready: ${data.exportReady}`);
    }
  }
} else {
  console.log("No workflow found for test candidate");
}

// 4. Check usage events for recent activity
const usage = await c.query(`
  SELECT automation_id, provider, outcome, COUNT(*)::int as calls,
    COALESCE(SUM(estimated_cost_usd), 0) as cost
  FROM ai_usage_events
  WHERE created_at > NOW() - interval '1 hour'
  GROUP BY automation_id, provider, outcome
  ORDER BY automation_id
`);
console.log(`\n=== USAGE EVENTS (last hour) ===`);
if (usage.rows.length === 0) console.log("  No usage events recorded");
else for (const u of usage.rows) {
  console.log(`  ${u.automation_id} | ${u.provider} | ${u.outcome} | ${u.calls} calls | $${u.cost}`);
}

// 5. Check application_resume_versions for the test app
const versions = await c.query(`
  SELECT id, title, source_type, created_at
  FROM application_resume_versions
  WHERE candidate_id = (SELECT candidate_id FROM applications WHERE id = $1)
  ORDER BY created_at DESC LIMIT 5
`, [wf.rows[0]?.application_id || "00000000-0000-0000-0000-000000000000"]);
console.log(`\n=== RESUME VERSIONS ===`);
if (versions.rows.length === 0) console.log("  No resume versions found");
else for (const v of versions.rows) {
  console.log(`  ${v.id} | ${v.title || "untitled"} | source=${v.source_type} | ${v.created_at}`);
}

await c.end();
