import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

async function fixDb() {
  try {
    console.log("Dropping old constraint...");
    await pool.query('ALTER TABLE job_ceo_staging DROP CONSTRAINT IF EXISTS job_ceo_staging_stage_check;');
    
    console.log("Adding new constraint...");
    await pool.query("ALTER TABLE job_ceo_staging ADD CONSTRAINT job_ceo_staging_stage_check CHECK (stage IN ('ingested', 'qa_passed', 'qa_dropped', 'researched', 'matched', 'logged', 'error', 'no_description'));");

    console.log("Checking the stuck run...");
    const res = await pool.query("SELECT * FROM job_ceo_runs WHERE id = '2e9e0a65-c5bd-49d3-984f-6ec92a8fc4e3'");
    console.log('RUN:', res.rows[0]);
    
    const counts = await pool.query("SELECT stage, count(*) FROM job_ceo_staging WHERE run_id = '2e9e0a65-c5bd-49d3-984f-6ec92a8fc4e3' GROUP BY stage");
    console.log('STAGING COUNTS:', counts.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

fixDb();
