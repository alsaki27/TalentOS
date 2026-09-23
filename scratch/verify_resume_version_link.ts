import { query, queryOne } from "../src/server/db/neon";
async function main() {
  const msg = await queryOne<{ id: string; candidate_id: string; ai_matched_application_id: string }>(
    `SELECT id, candidate_id, ai_matched_application_id FROM email_communications WHERE gmail_thread_id = $1 LIMIT 1`,
    ["1a026f117d8935cb"]
  );
  console.log("email_communications row:", msg);
  if (!msg?.ai_matched_application_id) return;

  const app = await queryOne<any>(`SELECT id, job_id, status FROM applications WHERE id = $1`, [msg.ai_matched_application_id]);
  console.log("\napplication:", app);

  const byApplicationId = await query<any>(
    `SELECT id, application_id, target_job_id, source_type, created_at FROM application_resume_versions WHERE application_id = $1 ORDER BY created_at DESC`,
    [msg.ai_matched_application_id]
  );
  console.log("\nMatches via application_id (the fix):", byApplicationId.length);
  byApplicationId.forEach((r) => console.log(" -", r));

  const byOldLogic = await query<any>(
    `SELECT id FROM application_resume_versions WHERE candidate_id = $1 AND target_job_id = $2`,
    [msg.candidate_id, app?.job_id]
  );
  console.log("\nMatches via old (broken) candidate_id+target_job_id logic:", byOldLogic.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
