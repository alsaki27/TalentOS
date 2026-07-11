import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

const app = await c.query(`
  SELECT a.id, a.status, c.name as candidate, j.title as job, j.description_text as desc
  FROM applications a
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  WHERE c.name LIKE 'Jane Test%'
  ORDER BY a.created_at DESC LIMIT 1
`);
const a = app.rows[0];
console.log(`Application: ${a.id}`);
console.log(`Candidate: ${a.candidate}`);
console.log(`Job: ${a.job}`);
console.log(`Status: ${a.status}`);
console.log(`Desc length: ${(a.desc || "").length} chars`);

// Verify routes
const routes = await c.query(`
  SELECT ar.automation_id, ar.rank, ak.label as key_label, ak.is_enabled
  FROM ai_automation_routes ar
  JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
  WHERE ar.is_enabled = true ORDER BY ar.automation_id
`);
console.log(`\nEnabled routes: ${routes.rows.length}`);
for (const r of routes.rows) {
  console.log(`  ${r.automation_id} -> ${r.key_label} (enabled=${r.is_enabled})`);
}

const keys = await c.query("SELECT id, label, provider, is_enabled FROM ai_api_keys WHERE is_enabled = true");
console.log(`\nActive API keys: ${keys.rows.length}`);
for (const k of keys.rows) {
  console.log(`  ${k.label} (${k.provider})`);
}

console.log(`\nTo trigger via hosted API:`);
console.log(`  curl -X POST 'https://talentos.workers.dev/api/applications/${a.id}/ai-workflow'`);
console.log(`\nTo check status:`);
console.log(`  curl 'https://talentos.workers.dev/api/applications/${a.id}/ai-workflow'`);

await c.end();
