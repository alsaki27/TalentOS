import { query } from "./src/server/db/neon.ts";

async function check() {
  const runs = await query("SELECT id, status, ingested_count, kept_count, last_error FROM job_ceo_runs WHERE status != 'completed' ORDER BY created_at ASC LIMIT 10");
  console.log("ACTIVE RUNS:");
  console.table(runs);

  const stagingCounts = await query("SELECT run_id, stage, COUNT(*) FROM job_ceo_staging GROUP BY run_id, stage LIMIT 10");
  console.log("STAGING COUNTS:");
  console.table(stagingCounts);
}

check().catch(console.error);
