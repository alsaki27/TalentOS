import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// Check base_resumes schema
const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'base_resumes' ORDER BY ordinal_position");
console.log("base_resumes columns:", r.rows.map(r2 => r2.column_name).join(", "));

// Check base_resumes content for the test candidate
const cand = await c.query("SELECT id FROM candidates WHERE name LIKE 'Jane Test%' ORDER BY created_at DESC LIMIT 1");
const cid = cand.rows[0]?.id;
const br = await c.query("SELECT id, name, status FROM base_resumes WHERE candidate_id = $1", [cid]);
console.log(`\nbase_resumes for Jane: ${br.rows.length}`);
for (const b of br.rows) console.log(`  ${b.id} ${b.name} ${b.status}`);

// Get the target_job_id
const tj = await c.query("SELECT id, job_id FROM target_jobs WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1", [cid]);
console.log(`\ntarget_job: ${tj.rows[0]?.id} (job: ${tj.rows[0]?.job_id})`);

// Get the resume version content
const rv = await c.query("SELECT id, content FROM application_resume_versions WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1", [cid]);
const content = rv.rows[0]?.content;
console.log(`\nresume version content type: ${typeof content}`);
if (content) console.log("content keys:", Object.keys(content).join(", "));

await c.end();
