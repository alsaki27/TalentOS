import { Pool } from '@neondatabase/serverless';

async function reset() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query(`
    UPDATE jobs 
    SET category_status = 'pending', category_tags = '{}', job_category = NULL, category_relevance_score = NULL, category_error = NULL
    WHERE category_status = 'done' OR category_status = 'needs_review' OR category_status = 'failed'
  `);
  console.log(`Reset ${res.rowCount} jobs back to pending.`);
  await pool.end();
}

reset().catch(console.error);
