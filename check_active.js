const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf-8').split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=')[1].replace(/\r/g, '').replace(/"/g, '');
const pool = new Pool({ connectionString: env });

async function checkActiveRuns() {
  try {
    const res = await pool.query("SELECT id, status, created_at FROM job_ceo_runs WHERE status IN ('ingesting','qa','deep_fetch','matchmaking') ORDER BY created_at ASC");
    console.log('Active Runs:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

checkActiveRuns();
