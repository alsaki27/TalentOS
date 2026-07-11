// Debug the pipeline status and fix the test candidate
import { Client } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB_URL);
await c.connect();

// 1. Check for any workflows
const wf = await c.query(
  "SELECT id, application_id, status, current_stage, last_error, created_at FROM application_ai_workflows ORDER BY created_at DESC LIMIT 5"
);
console.log("=== WORKFLOWS ===");
for (const w of wf.rows) {
  console.log(`${w.id} | ${w.status} | stage=${w.current_stage} | error=${(w.last_error||'').slice(0, 80)} | ${w.created_at}`);

  // Stage runs
  const stages = await c.query(
    "SELECT automation_id, status, attempt_number, error_message FROM application_ai_stage_runs WHERE workflow_id = $1 ORDER BY sequence_number",
    [w.id]
  );
  if (stages.rows.length === 0) console.log("  No stage runs");
  else for (const s of stages.rows) console.log(`  ${s.automation_id}=${s.status}${s.error_message ? ' ERROR: '+s.error_message.slice(0, 80) : ''}`);
}

// 2. Get test candidate
const cand = await c.query("SELECT id, name FROM candidates WHERE name LIKE 'Jane Test%' ORDER BY created_at DESC LIMIT 1");
const candidateId = cand.rows[0]?.id;
console.log(`\nTest candidate: ${cand.rows[0]?.name} (${candidateId})`);

// 3. Check base_resumes
const br = await c.query("SELECT id, name, status FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 3", [candidateId]);
console.log("Base resumes:", br.rows.length);
for (const b of br.rows) console.log(`  ${b.id} | ${b.name} | ${b.status}`);

// 4. Check application_resume_versions
const rv = await c.query("SELECT id, title, source_type, status FROM application_resume_versions WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 3", [candidateId]);
console.log("Resume versions:", rv.rows.length);
for (const r of rv.rows) console.log(`  ${r.id} | ${r.title} | ${r.source_type} | ${r.status}`);

// 5. Check target_jobs
const tj = await c.query("SELECT id, candidate_id, job_id FROM target_jobs WHERE candidate_id = $1", [candidateId]);
console.log("Target jobs:", tj.rows.length);

// 6. Check the application
const app = await c.query(
  "SELECT a.id, a.status, j.title as job FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.candidate_id = $1 ORDER BY a.created_at DESC LIMIT 1",
  [candidateId]
);
console.log(`Application: ${app.rows[0]?.id} | ${app.rows[0]?.status} | ${app.rows[0]?.job}`);

await c.end();
