import { Client } from "@neondatabase/serverless";

const DB = process.env.DATABASE_URL; if (!DB) process.exit(1);
const c = new Client(DB); await c.connect();

async function q(sql, ...args) {
  try { await c.query(sql, args); return true; }
  catch(e) { if(!e.message.match(/exists|must be owner|does not exist/)) console.error(e.message.slice(0,100)); return false; }
}

// Unique constraints
await q("ALTER TABLE candidates DROP CONSTRAINT IF EXISTS candidate_number_unique");
await q("ALTER TABLE candidates ADD CONSTRAINT candidate_number_unique UNIQUE (candidate_number)");
await q("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS job_number_unique");
await q("ALTER TABLE jobs ADD CONSTRAINT job_number_unique UNIQUE (job_number)");
await q("ALTER TABLE applications DROP CONSTRAINT IF EXISTS app_number_unique");
await q("ALTER TABLE applications ADD CONSTRAINT app_number_unique UNIQUE (app_number)");

// Sequences + backfill
await q("CREATE SEQUENCE IF NOT EXISTS candidate_number_seq START 10001");
await q("UPDATE candidates SET candidate_number = nextval('candidate_number_seq') WHERE candidate_number IS NULL");
await q("CREATE SEQUENCE IF NOT EXISTS job_number_seq START 10001");
await q("UPDATE jobs SET job_number = nextval('job_number_seq') WHERE job_number IS NULL");
await q("CREATE SEQUENCE IF NOT EXISTS app_number_seq START 10001");
await q("UPDATE applications SET app_number = nextval('app_number_seq') WHERE app_number IS NULL");

// application_resume_versions linkage
await q("ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS application_id uuid REFERENCES applications(id)");
await q("ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES jobs(id)");
await q("ALTER TABLE application_resume_versions ADD COLUMN IF NOT EXISTS workflow_id uuid REFERENCES application_ai_workflows(id)");
await q("CREATE INDEX IF NOT EXISTS arv_application_idx ON application_resume_versions (application_id)");
await q("CREATE INDEX IF NOT EXISTS arv_job_idx ON application_resume_versions (job_id)");
await q("CREATE INDEX IF NOT EXISTS arv_workflow_idx ON application_resume_versions (workflow_id)");
await q("CREATE INDEX IF NOT EXISTS arv_candidate_idx ON application_resume_versions (candidate_id)");

// Add ai_agent source_type
await q(`ALTER TABLE application_resume_versions DROP CONSTRAINT IF EXISTS app_resume_versions_source_type_check`);
await q(`ALTER TABLE application_resume_versions ADD CONSTRAINT app_resume_versions_source_type_check CHECK (source_type = ANY (ARRAY['base_resume','original_resume','blank','manual','ai_agent']))`);

// Application result fields
await q("ALTER TABLE applications ADD COLUMN IF NOT EXISTS ai_workflow_id uuid");
await q("ALTER TABLE applications ADD COLUMN IF NOT EXISTS tailored_resume_version_id uuid");
await q(`ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_status text DEFAULT 'not_started' CHECK (resume_generation_status = ANY (ARRAY['not_started','queued','job_analysis','resume_drafting','resume_review','human_review','finalizing','ready','failed','cancelled']))`);
await q("ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_started_at timestamptz");
await q("ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_completed_at timestamptz");
await q("ALTER TABLE applications ADD COLUMN IF NOT EXISTS resume_generation_error text");

// Verify
const ns = await c.query("SELECT COUNT(*) FILTER (WHERE candidate_number IS NOT NULL) as c, COUNT(*) FILTER (WHERE job_number IS NOT NULL) as j FROM (SELECT candidate_number FROM candidates) sub1, (SELECT job_number FROM jobs) sub2");
console.log("Candidates with numbers:", (await c.query("SELECT COUNT(*) FILTER (WHERE candidate_number IS NOT NULL) AS n FROM candidates")).rows[0].n);
console.log("Jobs with numbers:", (await c.query("SELECT COUNT(*) FILTER (WHERE job_number IS NOT NULL) AS n FROM jobs")).rows[0].n);
const ac = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name='applications' AND column_name IN ('resume_generation_status','ai_workflow_id')");
console.log("Application cols:", ac.rows.map(r=>r.column_name).join(","));
await c.end();
console.log("Done.");
