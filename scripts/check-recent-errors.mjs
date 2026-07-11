import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

const workflows = await c.query(
  "SELECT id, status, current_stage, last_error, created_at FROM application_ai_workflows ORDER BY created_at DESC LIMIT 5"
);
console.log("=== WORKFLOWS ===");
for (const w of workflows.rows) {
  console.log(`${w.id} | ${w.status} | stage=${w.current_stage} | error=${w.last_error || "-"}`);
}

const usage = await c.query(
  "SELECT automation_id, outcome, error_message FROM ai_usage_events WHERE created_at > $1 ORDER BY created_at DESC LIMIT 10",
  [new Date(Date.now() - 30 * 60000).toISOString()]
);
console.log("\n=== RECENT USAGE ===");
for (const e of usage.rows) {
  console.log(`${e.automation_id} | ${e.outcome} | ${(e.error_message || "").slice(0, 120)}`);
}

await c.end();
