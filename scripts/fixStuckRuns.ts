import { Pool } from '@neondatabase/serverless';

const pool = new Pool({ connectionString: 'postgresql://neondb_owner:npg_Gj1bqgAwf0mE@ep-withered-leaf-at0ubn6s-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require' });

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
