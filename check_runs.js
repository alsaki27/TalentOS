const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8').split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].replace(/\r/g, '').replace(/"/g, '');
const pool = new Pool({ connectionString: env });

async function checkRuns() {
  try {
    const res = await pool.query("SELECT * FROM job_ceo_runs");
    const runs = res.rows.filter(r => r.id.startsWith('c08e233d') || r.id.startsWith('19e81cd1'));
    console.log('Runs:', runs);
    
    for (const run of runs) {
      const stageCounts = await pool.query("SELECT stage, count(*) FROM job_ceo_staging WHERE run_id = $1 GROUP BY stage", [run.id]);
      console.log(`Run ${run.id} stages:`, stageCounts.rows);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkRuns();
