// READ-ONLY diagnostic. No writes. Investigating: (1) resume-pipeline
// failures for candidate "MD MAHBUBUL ALAM", (2) whether OpenCode tertiary
// fallback is currently the active route for the resume-generation agents,
// (3) health of the google_vertex_proxy key(s).
import { query } from "../src/server/db/neon";

async function main() {
  const candidates = await query<any>(
    `SELECT id, name, email FROM candidates WHERE name ILIKE '%mahbubul%' LIMIT 5`
  );
  console.log("CANDIDATES:", JSON.stringify(candidates, null, 2));

  const routes = await query<any>(
    `SELECT automation_id, provider, rank, model_override, is_enabled
     FROM ai_automation_routes
     WHERE automation_id IN ('application_job_lens','application_resume_forge','application_hiring_panel','application_final_polish','email_triage')
     ORDER BY automation_id, rank`
  );
  console.log("ROUTES:", JSON.stringify(routes, null, 2));

  const keys = await query<any>(
    `SELECT id, provider, label, priority, is_enabled, status, last_tested_at, last_test_status, last_error
     FROM ai_api_keys WHERE provider IN ('google_vertex_proxy','opencode') ORDER BY provider, priority`
  );
  console.log("KEYS:", JSON.stringify(keys, null, 2));

  if (candidates.length > 0) {
    const candidateId = candidates[0].id;
    const workflows = await query<any>(
      `SELECT id, application_id, status, current_stage, last_error, created_at, updated_at
       FROM application_ai_workflows
       WHERE application_id IN (SELECT id FROM applications WHERE candidate_id = $1)
       ORDER BY created_at DESC LIMIT 10`,
      [candidateId]
    ).catch((e) => ({ error: e.message }));
    console.log("WORKFLOWS:", JSON.stringify(workflows, null, 2));
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
