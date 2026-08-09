import fs from 'fs';
import path from 'path';
const envFile = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
for (const line of envFile.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) process.env.DATABASE_URL = line.split('=')[1].trim();
  if (line.startsWith('NEON_DATABASE_URL=')) process.env.NEON_DATABASE_URL = line.split('=')[1].trim();
}
import { query } from '../src/server/db/neon.ts';

async function run() {
  const tokenRes = await query(`SELECT token_encrypted FROM job_agent_apify_tokens LIMIT 1`);
  const token = tokenRes[0].token_encrypted;
  
  // Try fetching info about one of the failed runs
  const apifyRunId = 'YMIyvXKnXWzlDXgnl';
  const url = `https://api.apify.com/v2/actor-runs/${apifyRunId}?token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

run().catch(console.error);
