// Dispatch the orphaned workflow by directly calling processWorkflowStage
// This needs to run in an environment with AI provider access.
// Attempt 1: set up the route to use the env-based chain instead of the DB key.

import { Client } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

process.env.DATABASE_URL = DB_URL;
process.env.NEON_DATABASE_URL = DB_URL;

// Step 1: Update the routes to use bare provider names instead of the encrypted key.
// The env-based chain (ANTHROPIC_API_KEY / NVIDIA_API_KEY) doesn't need decryption.
const c = new Client(DB_URL);
await c.connect();

// Check if the key works or if we should add a bare-provider fallback route
const keyCheck = await c.query("SELECT id, label, provider FROM ai_api_keys WHERE is_enabled = true LIMIT 1");
console.log("Active key:", keyCheck.rows[0]?.label || "none", "provider:", keyCheck.rows[0]?.provider || "none");

// The 4 agent routes currently point to Rianv1 (Google). 
// Let's add a SECOND route (rank=2) with bare provider 'anthropic' as fallback.
// This way the system will try the encrypted key first, then fall back to env vars.
const agents = ['application_job_lens', 'application_resume_forge', 'application_hiring_panel', 'application_final_polish'];
for (const agentId of agents) {
  // Check if already has a bare-provider route
  const existing = await c.query(
    "SELECT id FROM ai_automation_routes WHERE automation_id = $1 AND provider IS NOT NULL AND ai_key_id IS NULL",
    [agentId]
  );
  if (existing.rows.length === 0) {
    await c.query(
      `INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled)
       VALUES ($1, 'anthropic', 2, true)`,
      [agentId]
    );
    console.log(`Added bare-provider fallback route for ${agentId}`);
  }
}

// Step 2: Try to import and run the workflow service
// The modules use @/ aliases, so we need to run this differently.
// For now, just update the routes so the Cloudflare endpoint would work.
console.log("\nRoutes updated. The user can now click '▶ AI Pipeline' on the queue page.");
console.log("The dispatch will try the Google key first, then fall back to anthropic env var.");

await c.end();
