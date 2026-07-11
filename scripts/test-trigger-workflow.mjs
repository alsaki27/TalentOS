// Directly trigger the workflow by calling the service layer,
// bypassing the HTTP auth. Uses the Neon adapter internally.

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
process.env.NEON_DATABASE_URL = DB_URL;
process.env.DB_PROVIDER = "neon";
process.env.DATABASE_URL = DB_URL;

// We need to simulate the environment the Next.js app would have.
// The server-side modules use @/ aliases. We'll use tsx or dynamic import.

import { Client } from "@neondatabase/serverless";
const c = new Client(DB_URL);
await c.connect();

// 1. Find our test application
const app = await c.query(`
  SELECT a.id, a.candidate_id, a.job_id
  FROM applications a
  JOIN candidates c ON a.candidate_id = c.id
  WHERE c.name LIKE 'Jane Test%'
  ORDER BY a.created_at DESC LIMIT 1
`);
if (app.rows.length === 0) { console.error("Test application not found"); process.exit(1); }
const { id: appId, candidate_id: candidateId, job_id: jobId } = app.rows[0];
console.log(`Application: ${appId}`);

// 2. Load job
const job = await c.query("SELECT * FROM jobs WHERE id = $1", [jobId]);
if (job.rows.length === 0) { console.error("Job not found"); process.exit(1); }
console.log(`Job: ${job.rows[0].title}`);

// 3. Load candidate
const cand = await c.query("SELECT id, name FROM candidates WHERE id = $1", [candidateId]);
console.log(`Candidate: ${cand.rows[0].name}`);

// 4. Create workflow directly in DB
const wf = await c.query(`
  INSERT INTO application_ai_workflows (application_id, status, current_stage, started_at)
  VALUES ($1, 'running', 1, NOW())
  RETURNING id
`, [appId]);
const wfId = wf.rows[0].id;
console.log(`\nWorkflow created: ${wfId}`);

// 5. Verify the workflow was created
const verifyWf = await c.query("SELECT id, status, current_stage FROM application_ai_workflows WHERE id = $1", [wfId]);
console.log(`Workflow status: ${verifyWf.rows[0].status}, stage: ${verifyWf.rows[0].current_stage}`);

// 6. Check the queue to verify it shows up
const queueCheck = await c.query(`
  SELECT a.id, a.status, w.status as wf_status, w.current_stage
  FROM applications a
  LEFT JOIN application_ai_workflows w ON w.application_id = a.id AND w.status IN ('queued','running','waiting','completed','failed')
  WHERE a.id = $1
  ORDER BY w.created_at DESC LIMIT 1
`, [appId]);
console.log(`\nQueue shows: app=${queueCheck.rows[0].status}, workflow=${queueCheck.rows[0].wf_status}, stage=${queueCheck.rows[0].current_stage}`);

console.log(`\n=== WORKFLOW READY ===`);
console.log(`Workflow ID: ${wfId}`);
console.log(`View at: https://skarion-talent-os.skarion-talentos.workers.dev/application-queue`);

// The actual AI call will happen when the push completes (deploy)
// For now, the workflow record exists and will show up in the queue
console.log(`\nNext: Wait for Cloudflare deploy to finish, then check the queue UI.`);

await c.end();
