import { query, execute } from "../src/server/db/neon";
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

async function main() {
  console.log("Creating archived_jobs table if it does not exist...");
  await execute(`
    CREATE TABLE IF NOT EXISTS archived_jobs (
        LIKE jobs INCLUDING ALL
    );
  `);
  console.log("Table archived_jobs ensured.");

  console.log("Archiving jobs created before 2026-07-10...");
  
  // Start a transaction for safe migration
  await execute("BEGIN");
  try {
    const insertRes = await query(`
      INSERT INTO archived_jobs
      SELECT * FROM jobs 
      WHERE created_at < '2026-07-10'
      ON CONFLICT (id) DO NOTHING
      RETURNING id;
    `);
    console.log(`Successfully archived ${insertRes.length} jobs.`);

    const deleteRes = await query(`
      DELETE FROM jobs 
      WHERE created_at < '2026-07-10'
      RETURNING id;
    `);
    console.log(`Successfully deleted ${deleteRes.length} jobs from main table.`);

    await execute("COMMIT");
    console.log("Migration complete!");
  } catch (error) {
    await execute("ROLLBACK");
    console.error("Migration failed, rolled back:", error);
  }
}

main().catch(console.error);
