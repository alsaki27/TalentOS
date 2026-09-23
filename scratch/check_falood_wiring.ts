import { query } from "../src/server/db/neon";

async function main() {
  const usage = await query(
    `SELECT automation_id, provider, model, outcome, COUNT(*)::int AS n, MAX(created_at) AS last
     FROM ai_usage_events
     WHERE automation_id ILIKE '%falood%' OR automation_id ILIKE '%tailor%'
     GROUP BY automation_id, provider, model, outcome
     ORDER BY last DESC NULLS LAST LIMIT 30`
  );
  console.log("=== falood/tailoring usage ===");
  for (const r of usage as any[]) console.log(JSON.stringify(r));

  const all = await query(
    `SELECT automation_id, outcome, COUNT(*)::int AS n, MAX(created_at) AS last
     FROM ai_usage_events
     WHERE created_at >= NOW() - INTERVAL '3 days'
     GROUP BY automation_id, outcome
     ORDER BY automation_id`
  );
  console.log("=== all automations last 3 days ===");
  for (const r of all as any[]) console.log(JSON.stringify(r));
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
