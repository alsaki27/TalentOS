import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

async function checkRun(runId: string) {
  try {
    const res = await pool.query("SELECT * FROM job_ceo_runs WHERE id = $1", [runId]);
    console.log(`\n=== RUN ${runId} ===`);
    console.log('RUN STATUS:', res.rows[0]);
    
    const counts = await pool.query("SELECT stage, count(*) FROM job_ceo_staging WHERE run_id = $1 GROUP BY stage", [runId]);
    console.log('STAGING COUNTS:', counts.rows);

    const errors = await pool.query("SELECT stage, last_error FROM job_ceo_staging WHERE run_id = $1 AND last_error IS NOT NULL LIMIT 5", [runId]);
    if (errors.rows.length > 0) {
       console.log('LAST ERRORS:', errors.rows);
    }
  } catch (err) {
    console.error(err);
  }
}

async function main() {
    await checkRun('9c4c6d08-28e5-4f2a-ac70-391394d07ca4');
    await checkRun('46cd0dba-2a93-4a91-b30a-9d5a015ca146');
    pool.end();
}

main();
