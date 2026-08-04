import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

async function checkStaging() {
  const runId = '9c4c6d08-28e5-4f2a-ac70-391394d07ca4';
  try {
    const res = await pool.query("SELECT id, stage, claimed_at, claim_expires_at FROM job_ceo_staging WHERE run_id = $1 AND stage = 'ingested' LIMIT 5", [runId]);
    console.log('STUCK ROWS:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkStaging();
