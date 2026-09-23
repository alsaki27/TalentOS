import fs from 'fs';
import path from 'path';
const envFile = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
for (const line of envFile.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) process.env.DATABASE_URL = line.split('=')[1].trim();
  if (line.startsWith('NEON_DATABASE_URL=')) process.env.NEON_DATABASE_URL = line.split('=')[1].trim();
}
import { query } from '../src/server/db/neon.ts';

async function run() {
  const res = await query(`
    SELECT id, actor_source, status, error, created_at, completed_at, apify_run_id
    FROM job_agent_runs 
    WHERE actor_source IN ('google', 'linkedin') 
    ORDER BY created_at DESC 
    LIMIT 10
  `);
  console.log(JSON.stringify(res, null, 2));
}

run().catch(console.error);
