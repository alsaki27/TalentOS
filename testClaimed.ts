import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

async function testQuery() {
  const runId = '9c4c6d08-28e5-4f2a-ac70-391394d07ca4';
  try {
    const res = await pool.query(`
      SELECT count(*) FROM job_ceo_staging
      WHERE run_id = $1 AND claimed_at IS NOT NULL
    `, [runId]);
    console.log('CLAIMED COUNT:', res.rows[0].count);
    
    const res2 = await pool.query(`
      SELECT count(*) FROM job_ceo_staging
      WHERE run_id = '46cd0dba-2a93-4a91-b30a-9d5a015ca146' AND claimed_at IS NOT NULL
    `);
    console.log('CLAIMED COUNT 2:', res2.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

testQuery();
