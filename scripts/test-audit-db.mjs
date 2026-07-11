import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = neon(url);

async function tablesExist(names) {
  const rows = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ANY(${names})
  `;
  return new Set(rows.map(r => r.table_name));
}

async function main() {
  const existing = await tablesExist([
    'ai_api_keys', 'ai_automations', 'ai_automation_routes', 'ai_usage_events',
    'ai_agent_configs', 'application_ai_workflows', 'application_ai_stage_runs',
    'application_ai_artifacts'
  ]);

  // AI API Keys
  if (existing.has('ai_api_keys')) {
    const keys = await sql`SELECT id, label, provider, model, is_enabled, priority, status FROM ai_api_keys ORDER BY priority`;
    console.log(`\nAI API KEYS (${keys.length}):`);
    for (const k of keys) {
      console.log(`  ${k.label} | provider=${k.provider} | model=${k.model ?? '-'} | enabled=${k.is_enabled} | priority=${k.priority} | status=${k.status}`);
    }
  } else {
    console.log("\nAI API KEYS: table does not exist");
  }

  // AI Automations
  if (existing.has('ai_automations')) {
    const autos = await sql`SELECT id, label, group_label, is_active FROM ai_automations ORDER BY group_label, id`;
    console.log(`\nAI AUTOMATIONS (${autos.length}):`);
    for (const a of autos) console.log(`  ${a.id} | label=${a.label} | active=${a.is_active}`);

    // Routes
    if (existing.has('ai_automation_routes')) {
      const routes = await sql`
        SELECT ar.automation_id, ar.rank, ar.provider, ar.is_enabled, ak.label as key_label
        FROM ai_automation_routes ar LEFT JOIN ai_api_keys ak ON ar.ai_key_id = ak.id
        ORDER BY ar.automation_id, ar.rank
      `;
      console.log(`\nROUTES (${routes.length}):`);
      for (const r of routes) {
        const target = r.key_label ? `${r.key_label}` : r.provider ?? '(global)';
        console.log(`  ${r.automation_id} #${r.rank} -> ${target} | enabled=${r.is_enabled}`);
      }
    }
  } else {
    console.log("\nAI AUTOMATIONS: table does not exist");
  }

  // Agent configs
  if (existing.has('ai_agent_configs')) {
    const cfg = await sql`SELECT automation_id, display_name, is_active FROM ai_agent_configs ORDER BY automation_id`;
    console.log(`\nAGENT CONFIGS (${cfg.length}):`);
    for (const c of cfg) console.log(`  ${c.automation_id} | ${c.display_name} | active=${c.is_active}`);
  } else {
    console.log("\nAGENT CONFIGS: table does not exist");
  }

  // Usage events
  if (existing.has('ai_usage_events')) {
    const cnt = await sql`SELECT COUNT(*)::int as n FROM ai_usage_events`;
    console.log(`\nUSAGE EVENTS: ${cnt[0].n} events`);
  } else {
    console.log("\nUSAGE EVENTS: table does not exist");
  }

  // Workflows
  if (existing.has('application_ai_workflows')) {
    const wf = await sql`SELECT id, application_id, status, current_stage FROM application_ai_workflows ORDER BY created_at DESC LIMIT 5`;
    console.log(`\nWORKFLOWS (last ${wf.length}):`);
    for (const w of wf) console.log(`  ${w.id} | app=${w.application_id} | status=${w.status} | stage=${w.current_stage}`);
  } else {
    console.log("\nWORKFLOWS: table does not exist");
  }

  // Last 3 applications
  const apps = await sql`SELECT id, candidate_id, job_id, status, created_at FROM applications ORDER BY created_at DESC LIMIT 3`;
  console.log(`\nLAST ${apps.length} APPLICATIONS:`);
  for (const a of apps) {
    console.log(`  ${a.id} | candidate=${a.candidate_id} | job=${a.job_id ?? '-'} | status=${a.status} | created=${a.created_at}`);
  }

  console.log("\n=== DONE ===");
}

main().catch(e => { console.error("Audit failed:", e.message); process.exit(1); });
