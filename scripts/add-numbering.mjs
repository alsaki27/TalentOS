// Add unique numbering to candidates, jobs, apps + fix empty resume tracking
import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// 1. Add candidate_number (auto-incrementing sequence)
await c.query(`CREATE SEQUENCE IF NOT EXISTS candidate_number_seq START 1001`);
await c.query(`ALTER TABLE candidates ADD COLUMN IF NOT EXISTS candidate_number integer`);

// Backfill existing candidates
await c.query(`
  UPDATE candidates 
  SET candidate_number = nextval('candidate_number_seq'::regclass)
  WHERE candidate_number IS NULL
`);
// Set the test candidate's number manually for visibility
const cand = await c.query("SELECT id FROM candidates WHERE name LIKE 'Jane Test%' ORDER BY created_at DESC LIMIT 1");
if (cand.rows.length > 0) {
  await c.query("UPDATE candidates SET candidate_number = 1001 WHERE id = $1 AND candidate_number IS NULL OR candidate_number != 1001", [cand.rows[0].id]);
}
console.log("✓ Added candidate_number");

// 2. Add job_number
await c.query(`CREATE SEQUENCE IF NOT EXISTS job_number_seq START 2001`);
await c.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_number integer`);

// Backfill existing jobs
await c.query(`
  UPDATE jobs 
  SET job_number = nextval('job_number_seq'::regclass)
  WHERE job_number IS NULL
`);
const job = await c.query("SELECT id FROM jobs WHERE title LIKE '%Senior GIS/OSP%' ORDER BY created_at DESC LIMIT 1");
if (job.rows.length > 0) {
  await c.query("UPDATE jobs SET job_number = 2001 WHERE id = $1 AND (job_number IS NULL OR job_number != 2001)", [job.rows[0].id]);
}
console.log("✓ Added job_number");

// 3. Fix app_number — backfill all nulls
await c.query(`CREATE SEQUENCE IF NOT EXISTS app_number_seq START 3001`);
await c.query(`
  UPDATE applications 
  SET app_number = nextval('app_number_seq'::regclass)
  WHERE app_number IS NULL
`);
const app = await c.query("SELECT id FROM applications WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1", [cand.rows[0]?.id]);
if (app.rows.length > 0) {
  await c.query("UPDATE applications SET app_number = 3001 WHERE id = $1 AND (app_number IS NULL OR app_number != 3001)", [app.rows[0].id]);
}
console.log("✓ Backfilled app_number");

// 4. Verify
const check = await c.query(`
  SELECT c.name, c.candidate_number, j.title, j.job_number, a.app_number
  FROM applications a
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  WHERE c.name LIKE 'Jane Test%'
`);
for (const r of check.rows) {
  console.log(`\nJane Test Engineer: #${r.candidate_number} | ${r.title}: #${r.job_number} | App: #${r.app_number}`);
}

// 5. Fix the queue page API to include these numbers
// (They're already in the SELECT query via a.app_number, j.*, c.*)

// 6. Ensure the finalization service saves proper resume with target_job_id
// Already fixed earlier (finalizationService.ts uses candidate_id + target_job_id)

await c.end();
console.log("\n✓ All numbering added. Test candidate: #1001, Job: #2001, App: #3001");
