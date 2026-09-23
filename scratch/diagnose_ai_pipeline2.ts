// READ-ONLY. Join ai_automation_routes -> ai_api_keys to see exactly which
// key (and its live health status) each rank resolves to for the
// resume-pipeline automations.
import { query } from "../src/server/db/neon";

async function main() {
  const rows = await query<any>(
    `SELECT r.automation_id, r.rank, r.is_enabled AS route_enabled, r.model_override,
            r.ai_key_id, r.provider AS route_provider,
            k.label AS key_label, k.provider AS key_provider, k.status AS key_status,
            k.is_enabled AS key_enabled, k.last_error AS key_last_error
     FROM ai_automation_routes r
     LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
     WHERE r.automation_id IN ('application_job_lens','application_resume_forge','application_hiring_panel','application_final_polish','email_triage')
     ORDER BY r.automation_id, r.rank`
  );
  console.log(JSON.stringify(rows, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
