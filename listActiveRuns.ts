import { Pool } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: databaseUrl });

async function listActiveRuns() {
  try {
    const res = await pool.query("SELECT id, status, created_at, updated_at FROM job_ceo_runs WHERE status IN ('ingesting','qa','deep_fetch','matchmaking') ORDER BY created_at ASC");
    console.log('ACTIVE RUNS:', res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

listActiveRuns();
