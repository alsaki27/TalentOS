import { Client } from "@neondatabase/serverless";
const c = new Client(process.env.DATABASE_URL);
await c.connect();

const r = await c.query(`
  SELECT a.id as app_id, c.name, j.title, rv.title as resume_title, rv.status as rv_status
  FROM applications a
  JOIN candidates c ON a.candidate_id = c.id
  JOIN jobs j ON a.job_id = j.id
  LEFT JOIN target_jobs tj ON tj.candidate_id = a.candidate_id AND tj.job_id = a.job_id
  LEFT JOIN application_resume_versions rv ON rv.candidate_id = a.candidate_id AND rv.target_job_id = tj.id
  WHERE c.name LIKE 'Jane Test%'
  ORDER BY a.created_at DESC LIMIT 1
`);
const v = r.rows[0];
console.log(`Candidate: ${v.name}`);
console.log(`Job: ${v.title}`);
console.log(`App ID: ${v.app_id}`);
console.log(`Resume: ${v.resume_title} (${v.rv_status})`);

// Check routes
const routes = await c.query(`
  SELECT ar.automation_id, ar.rank, COALESCE(ak.label, ar.provider, '(global)') as target, ar.is_enabled
  FROM ai_automation_routes ar
  LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
  WHERE ar.automation_id LIKE 'application_%'
  ORDER BY ar.automation_id, ar.rank
`);
console.log(`\nRoutes:`);
for (const r2 of routes.rows) {
  console.log(`  ${r2.automation_id} #${r2.rank} → ${r2.target} enabled=${r2.is_enabled}`);
}

console.log(`\n== READY ==`);
console.log(`Sign in at https://skarion-talent-os.skarion-talentos.workers.dev/login`);
console.log(`Then click "▶ AI Pipeline" at the application queue`);
await c.end();
