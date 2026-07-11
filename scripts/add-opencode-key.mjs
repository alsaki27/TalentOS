// Add OpenCode API key to the database and configure routes for the 4 agents
import { Client } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const API_KEY = "sk-760Q2QJhDbPGbhlwZr08tgaLeJLZ8mFJT7Qdv9LFjDuFtXWFMrLXNDOaXtvrH1m2";

const c = new Client(DB_URL);
await c.connect();

// 1. Add the key as plaintext (decryptSecret returns non-enc: prefix as-is)
// Find the first admin user to use as created_by
const admin = await c.query("SELECT user_id FROM profiles WHERE role = 'admin' LIMIT 1");
const adminId = admin.rows[0]?.user_id;

const keyInsert = await c.query(`
  INSERT INTO ai_api_keys (provider, label, encrypted_key, key_fingerprint, model, priority, is_enabled, status, created_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  ON CONFLICT (id) DO UPDATE SET is_enabled = true
  RETURNING id, label
`, [
  "opencode",
  "OpenCode Go API",
  API_KEY,             // stored as plaintext — decryptSecret returns it as-is
  "opencode-deepseek", // fingerprint (simplified for testing)
  "deepseek/deepseek-v4-flash",
  50,                  // priority (lower = higher priority)
  true,                // is_enabled
  "working",           // status
  adminId,
]);
const keyId = keyInsert.rows[0]?.id;
if (!keyId) { console.error("Failed to insert key"); process.exit(1); }
console.log(`✓ Added key: ${keyInsert.rows[0].label} (${keyId})`);

// 2. Update routes for the 4 agents to use this key with rank=1
//    (keeping the old routes as fallback)
const agents = ['application_job_lens', 'application_resume_forge', 'application_hiring_panel', 'application_final_polish'];
for (const agentId of agents) {
  // Remove old rank=1 routes (Rianv1)
  await c.query("DELETE FROM ai_automation_routes WHERE automation_id = $1 AND rank = 1", [agentId]);
  // Insert new rank=1 route for OpenCode
  await c.query(
    `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, is_enabled)
     VALUES ($1, $2, 1, true)`,
    [agentId, keyId]
  );
  console.log(`✓ Route: ${agentId} #1 -> OpenCode`);
}

// 3. Verify
const routes = await c.query(`
  SELECT ar.automation_id, ar.rank, COALESCE(ak.label, ar.provider, '(global)') as target, ar.is_enabled
  FROM ai_automation_routes ar
  LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
  WHERE ar.automation_id LIKE 'application_%'
  ORDER BY ar.automation_id, ar.rank
`);
console.log(`\nRoutes:`);
for (const r of routes.rows) {
  console.log(`  ${r.automation_id} #${r.rank} -> ${r.target} enabled=${r.is_enabled}`);
}

await c.end();
console.log(`\nDone. Ready to test the pipeline.`);
