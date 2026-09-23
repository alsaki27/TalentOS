const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8').split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].replace(/\r/g, '').replace(/"/g, '');
const pool = new Pool({ connectionString: env });

async function checkRun(runIdPrefix) {
  const query = `
    SELECT
      s.id as staging_id,
      s.stage,
      s.logged_job_id,
      j.id as job_id,
      j.source,
      j.title,
      j.company
    FROM job_ceo_staging s
    LEFT JOIN jobs j ON s.logged_job_id = j.id
    WHERE s.run_id::text LIKE $1 || '%'
      AND s.stage = 'logged';
  `;
  const res = await pool.query(query, [runIdPrefix]);
  
  const totalLogged = res.rows.length;
  const inJobsTable = res.rows.filter(r => r.job_id != null).length;
  const missing = res.rows.filter(r => r.job_id == null).length;
  
  const sources = {};
  for (const r of res.rows) {
    if (r.job_id) {
      sources[r.source] = (sources[r.source] || 0) + 1;
    }
  }
  
  console.log(`\nRun: ${runIdPrefix}`);
  console.log(`- Total logged in staging: ${totalLogged}`);
  console.log(`- Found in jobs table: ${inJobsTable}`);
  console.log(`- Missing from jobs table: ${missing}`);
  console.log(`- Sources in jobs table: ${JSON.stringify(sources)}`);
}

async function run() {
  await checkRun('f8b5b0ff');
  await checkRun('d1c6a221');
  await checkRun('e7040cd3');
  await pool.end();
}

run().catch(console.error);
