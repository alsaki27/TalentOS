import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

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
