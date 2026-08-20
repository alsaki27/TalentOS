// READ-ONLY. Run with: npx tsx --env-file=.env.local scratch/diagnose_istiaque_readiness.ts
import { query } from "../src/server/db/neon";

async function main() {
  const apps = await query<any>(
    "SELECT id, job_id, ae_stage, status, resume_generation_status, ai_workflow_id, tailored_resume_version_id, base_resume_id, created_at FROM applications WHERE candidate_id = $1 ORDER BY created_at DESC",
    ["16ad4c1b-ef2f-4535-b7b4-c5115acfe09c"]
  );
  console.log("=== Applications for Test Istiaque (any status) ===");
  console.log(JSON.stringify(apps, null, 2));

  const routing = await query<any>(
    "SELECT automation_id, is_active, minimum_score FROM ai_agent_configs WHERE automation_id IN ($1,$2,$3,$4) ORDER BY automation_id",
    ["application_job_lens", "application_resume_forge", "application_hiring_panel", "application_final_polish"]
  );
  console.log("\n=== Agent configs (active?) ===");
  console.log(JSON.stringify(routing, null, 2));

  const recentUsage = await query<any>(
    "SELECT automation_id, provider_name, model, success, error_code, created_at FROM ai_usage_events WHERE automation_id LIKE $1 ORDER BY created_at DESC LIMIT 15",
    ["application_%"]
  );
  console.log("\n=== Recent resume-pipeline AI usage (last 15 calls, any candidate) ===");
  console.log(JSON.stringify(recentUsage, null, 2));

  const targetJobs = await query<any>(
    `SELECT tj.id, tj.job_id, tj.fit_score, tj.recommendation, j.title, j.company, j.location, j.created_at as job_created_at
     FROM target_jobs tj JOIN jobs j ON j.id = tj.job_id
     WHERE tj.candidate_id = $1 ORDER BY tj.created_at DESC LIMIT 10`,
    ["16ad4c1b-ef2f-4535-b7b4-c5115acfe09c"]
  );
  console.log("\n=== Target jobs already linked to Test Istiaque ===");
  console.log(JSON.stringify(targetJobs, null, 2));
}

main().catch((err) => {
  console.error("Diagnostic script failed:", err);
  process.exit(1);
});
