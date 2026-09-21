import { Pool } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });

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
