import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

async function testQuery() {
  const runId = '9c4c6d08-28e5-4f2a-ac70-391394d07ca4';
  try {
    const res = await pool.query(`
      SELECT id FROM job_ceo_staging
      WHERE stage = $2 AND run_id = $1
        AND (claim_expires_at IS NULL OR claim_expires_at < NOW())
      ORDER BY created_at ASC
      LIMIT $3
    `, [runId, 'ingested', 20]);
    console.log('QUERY RES:', res.rows.length);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

testQuery();
