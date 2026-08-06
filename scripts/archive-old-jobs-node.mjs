import fs from 'fs';
import path from 'path';
import { neon } from '@neondatabase/serverless';

// Poor man's dotenv
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = match[2] || '';
      // Remove surrounding quotes if they exist
      val = val.replace(/^['"](.*)['"]$/, '$1').trim();
      process.env[match[1]] = val;
    }
  });
}

const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
if (!dbUrl) {
  console.error("No DB URL found.");
  process.exit(1);
}

const sql = neon(dbUrl);

async function run() {
  console.log("Creating archived_jobs table...");
  await sql`CREATE TABLE IF NOT EXISTS archived_jobs (LIKE jobs INCLUDING ALL)`;
  
  console.log("Archiving jobs before 2026-07-10...");
  
  const insertRes = await sql`
    INSERT INTO archived_jobs
    SELECT * FROM jobs 
    WHERE created_at < '2026-07-10'
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  console.log(`Archived ${insertRes.length} jobs.`);

  const delRes = await sql`
    DELETE FROM jobs 
    WHERE created_at < '2026-07-10'
    RETURNING id
  `;
  console.log(`Deleted ${delRes.length} jobs.`);
}

run().catch(console.error);
