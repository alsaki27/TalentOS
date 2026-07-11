// Setup test environment
import { Client } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(url);
await c.connect();

// 1. Check existing keys
const keys = await c.query(`SELECT id, label, provider, is_enabled, status,
  length(encrypted_key) as key_len, key_fingerprint
  FROM ai_api_keys ORDER BY priority`);
console.log("AI API Keys:");
for (const k of keys.rows) {
  console.log(`  ${k.label} | ${k.provider} | enabled=${k.is_enabled} | status=${k.status} | key_len=${k.key_len} | fingerprint=${k.key_fingerprint ?? "-"}`);
}

// 2. Enable existing key + test with a new plaintext key
const existingKey = keys.rows[0];
if (existingKey) {
  await c.query(`UPDATE ai_api_keys SET is_enabled = true WHERE id = $1`, [existingKey.id]);
  console.log(`\n✓ Enabled: ${existingKey.label}`);
}

// 3. Try to insert a test key with a known value for local testing
// The encryption is done at the application layer via secretCrypto.
// For testing, we can add a plaintext key record.
// But the DB schema requires encrypted_key.
// Let's just enable everything and try the application layer.

// 4. Create routes for the application agents
const agentIds = [
  'application_job_lens',
  'application_resume_forge',
  'application_hiring_panel',
  'application_final_polish',
  'chat_assistant',
];

for (const agentId of agentIds) {
  if (existingKey) {
    await c.query(`DELETE FROM ai_automation_routes WHERE automation_id = $1`, [agentId]);
    await c.query(
      `INSERT INTO ai_automation_routes (automation_id, ai_key_id, rank, is_enabled)
       VALUES ($1, $2, 1, true)`,
      [agentId, existingKey.id]
    );
    console.log(`✓ Route: ${agentId} -> ${existingKey.label}`);
  }
}

// 5. Verify routes
const routes = await c.query(`
  SELECT ar.automation_id, ar.rank, ar.is_enabled, ak.label as key_label
  FROM ai_automation_routes ar LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
  ORDER BY ar.automation_id, ar.rank
`);
console.log(`\nRoutes (${routes.rows.length}):`);
for (const r of routes.rows) {
  console.log(`  ${r.automation_id} #${r.rank} -> ${r.key_label} | enabled=${r.is_enabled}`);
}

await c.end();
console.log("\nDone.");
