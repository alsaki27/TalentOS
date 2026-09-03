import { query, execute } from "../src/server/db/neon";
async function main() {
  const cols = await query<any>(`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name LIKE 'job_analysis%'
    ORDER BY column_name
  `);
  console.log("Current job_analysis* columns:", JSON.stringify(cols, null, 2));

  const hasMainColumn = cols.some((c: any) => c.column_name === "job_analysis");
  if (!hasMainColumn) {
    console.log("\nMISSING: job_analysis jsonb column. Adding it now...");
    await execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_analysis jsonb");
    console.log("Added.");
  } else {
    console.log("\njob_analysis column already present.");
  }

  const finalCols = await query<any>(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name LIKE 'job_analysis%'
    ORDER BY column_name
  `);
  console.log("\nFinal job_analysis* columns:", JSON.stringify(finalCols, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
