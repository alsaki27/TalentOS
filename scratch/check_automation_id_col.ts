import { query } from "../src/server/db/neon";
async function main() {
  const cols = await query<any>(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'application_ai_artifacts' ORDER BY ordinal_position
  `);
  console.log("Columns:", JSON.stringify(cols));

  const distinctVals = await query<any>(`
    SELECT automation_id, COUNT(*)::int as c, MIN(created_at) as first_seen, MAX(created_at) as last_seen
    FROM application_ai_artifacts
    GROUP BY automation_id
    ORDER BY last_seen DESC
    LIMIT 20
  `);
  console.log("\nDistinct automation_id values (most recent 20 groups):");
  console.log(JSON.stringify(distinctVals, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
