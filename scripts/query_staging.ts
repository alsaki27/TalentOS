import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query("SELECT id, job_title, source_url, qa_reason, stage FROM job_ceo_staging ORDER BY created_at DESC LIMIT 5");
  console.log("LAST 5 STAGING ROWS:");
  console.log(JSON.stringify(rows, null, 2));
}
main().catch(console.error);
