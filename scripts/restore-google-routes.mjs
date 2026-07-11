import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

// Get Rianv1 key ID
const key = await c.query("SELECT id FROM ai_api_keys WHERE label = 'Rianv1' AND is_enabled = true LIMIT 1");
if (!key.rows[0]) { console.error("Rianv1 key not found or disabled"); process.exit(1); }
const keyId = key.rows[0].id;
console.log("Using key:", keyId);

// Update routes for all 4 agents to use Rianv1 as rank 1
const agents = ['application_job_lens', 'application_resume_forge', 'application_hiring_panel', 'application_final_polish'];
for (const agentId of agents) {
  await c.query("DELETE FROM ai_automation_routes WHERE automation_id = $1 AND rank = 1", [agentId]);
  await c.query(
    `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, is_enabled)
     VALUES ($1, $2, 1, true)`,
    [agentId, keyId]
  );
  console.log(`Route: ${agentId} #1 -> Rianv1`);
}

// Verify
const routes = await c.query(`
  SELECT ar.automation_id, ar.rank, COALESCE(ak.label, ar.provider) as target
  FROM ai_automation_routes ar LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
  WHERE ar.automation_id LIKE 'application_%' ORDER BY ar.automation_id, ar.rank
`);
console.log("\nRoutes:");
for (const r of routes.rows) console.log(`  ${r.automation_id} #${r.rank} -> ${r.target}`);

await c.end();
