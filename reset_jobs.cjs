const { Client } = require('pg');
require('dotenv').config({ path: '.env.local' });

async function reset() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`
    UPDATE jobs 
    SET category_status = 'pending', category_tags = '{}', job_category = NULL, category_relevance_score = NULL
    WHERE category_status = 'done' OR category_status = 'needs_review'
  `);
  console.log(`Reset ${res.rowCount} jobs to pending.`);
  await client.end();
}

reset().catch(console.error);
