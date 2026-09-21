import { Pool } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });

async function fixStuckRuns() {
  try {
    const res = await pool.query("UPDATE job_ceo_runs SET status = 'completed' WHERE status IN ('ingesting', 'qa', 'deep_fetch', 'matchmaking') RETURNING id");
    console.log('Fixed stuck runs:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

fixStuckRuns();
