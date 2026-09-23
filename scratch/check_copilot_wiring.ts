import { query } from "../src/server/db/neon";

async function main() {
  const cols = await query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ai_usage_events' ORDER BY ordinal_position`
  );
  console.log("=== ai_usage_events columns ===");
  console.log((cols as any[]).map((x) => x.column_name).join(", "));

  const usage = await query(
    `SELECT automation_id, provider, model, outcome, COUNT(*)::int AS n, MAX(created_at) AS last
     FROM ai_usage_events
     WHERE automation_id ILIKE '%copilot%'
     GROUP BY automation_id, provider, model, outcome
     ORDER BY last DESC NULLS LAST LIMIT 30`
  );
  console.log("=== recent copilot usage ===");
  for (const r of usage as any[]) console.log(JSON.stringify(r));
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
