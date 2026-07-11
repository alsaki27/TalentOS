import { Client } from "@neondatabase/serverless";
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB_URL);
await c.connect();

// Get test app ID
const app = await c.query(`
  SELECT a.id FROM applications a JOIN candidates c ON a.candidate_id = c.id
  WHERE c.name LIKE 'Jane Test%' ORDER BY a.created_at DESC LIMIT 1
`);
const appId = app.rows[0]?.id;
console.log("App ID:", appId);

// Clean up old workflows
await c.query("DELETE FROM application_ai_stage_runs WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id = $1)", [appId]);
await c.query("DELETE FROM application_ai_artifacts WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id = $1)", [appId]);
await c.query("DELETE FROM application_ai_workflows WHERE application_id = $1", [appId]);
console.log("Cleaned old workflows");

await c.end();

const HOST = "https://skarion-talent-os.skarion-talentos.workers.dev";

// Login
console.log("\n--- Login ---");
const loginRes = await fetch(`${HOST}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@talentos.local", password: "AdminPass123!" }),
});
const loginBody = await loginRes.text();
console.log(`Login: ${loginRes.status}`);

// Extract cookie
const setCookie = loginRes.headers.get("set-cookie");
if (!setCookie) {
  console.log("No cookie received. Login response:", loginBody.slice(0, 200));
  process.exit(1);
}
console.log("Cookie received ✓");

// Trigger workflow
console.log("\n--- Trigger Workflow ---");
const wfRes = await fetch(`${HOST}/api/applications/${appId}/ai-workflow`, {
  method: "POST",
  headers: { "Cookie": setCookie, "Content-Type": "application/json" },
});
const wfBody = await wfRes.text();
console.log(`Workflow: ${wfRes.status}`);
console.log(wfBody.slice(0, 300));
