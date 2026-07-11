import { Client } from "@neondatabase/serverless";
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const c = new Client(DB_URL);
await c.connect();

// Get the test app ID
const app = await c.query(`
  SELECT a.id FROM applications a JOIN candidates c ON a.candidate_id = c.id
  WHERE c.name LIKE 'Jane Test%' ORDER BY a.created_at DESC LIMIT 1
`);
const appId = app.rows[0]?.id;
console.log("App ID:", appId);

if (!appId) { console.error("No test app found"); process.exit(1); }

// Clear any previous workflows
await c.query("DELETE FROM application_ai_stage_runs WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id = $1)", [appId]);
await c.query("DELETE FROM application_ai_artifacts WHERE workflow_id IN (SELECT id FROM application_ai_workflows WHERE application_id = $1)", [appId]);
await c.query("DELETE FROM application_ai_workflows WHERE application_id = $1", [appId]);

await c.end();

// Now, call the OpenCode API directly to verify the key works
console.log("\n=== Test 1: Direct OpenCode API call ===");
const API_KEY = "sk-760Q2QJhDbPGbhlwZr08tgaLeJLZ8mFJT7Qdv9LFjDuFtXWFMrLXNDOaXtvrH1m2";

try {
  const res = await fetch("https://api.opencode.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek/deepseek-v4-flash",
      messages: [
        { role: "system", content: "Reply with exactly: OK_OPENCODE_TEST" },
        { role: "user", content: "Say OK." },
      ],
      max_tokens: 50,
      temperature: 0.1,
    }),
  });

  const body = await res.text();
  if (res.ok) {
    const data = JSON.parse(body);
    const text = data.choices?.[0]?.message?.content || "(empty)";
    console.log(`✓ API works! Response: ${text}`);
  } else {
    console.log(`✗ API error (${res.status}): ${body.slice(0, 200)}`);
  }
} catch (err) {
  console.log(`✗ Network error: ${err.message}`);
}

// Now try to trigger workflow via the hosted API with admin login
console.log("\n=== Test 2: Trigger workflow via hosted API ===");
try {
  const loginRes = await fetch("https://skarion-talent-os.skarion-talentos.workers.dev/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@talentos.local", password: "AdminPass123!" }),
  });
  if (loginRes.ok) {
    const cookies = loginRes.headers.get("set-cookie");
    console.log("✓ Login succeeded");
    
    // Pass cookies to trigger workflow
    const wfRes = await fetch(`https://skarion-talent-os.skarion-talentos.workers.dev/api/applications/${appId}/ai-workflow`, {
      method: "POST",
      headers: { "Cookie": cookies },
    });
    const wfBody = await wfRes.text();
    console.log(`Workflow trigger (${wfRes.status}): ${wfBody.slice(0, 200)}`);
  } else {
    const errBody = await loginRes.text();
    console.log(`✗ Login failed (${loginRes.status}): ${errBody.slice(0, 150)}`);
  }
} catch (err) {
  console.log(`✗ Network error: ${err.message}`);
}

console.log("\n=== Check workflow status in 30s by re-running check-workflow-status.mjs ===");
