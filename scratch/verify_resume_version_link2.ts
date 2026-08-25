import { query, queryOne } from "../src/server/db/neon";
async function main() {
  const msgs = await query<any>(
    `SELECT id, candidate_id, ai_matched_application_id, subject, sent_at FROM email_communications WHERE gmail_thread_id = $1 ORDER BY sent_at DESC`,
    ["1a026f117d8935cb"]
  );
  console.log("All messages in thread, newest first:");
  msgs.forEach((m) => console.log(" -", m.id, "|", m.subject, "| app_id:", m.ai_matched_application_id, "|", m.sent_at));

  const latest = msgs[0];
  if (!latest?.ai_matched_application_id) { console.log("\nLatest message has no matched application either."); return; }

  const app = await queryOne<any>(`SELECT id, job_id, status FROM applications WHERE id = $1`, [latest.ai_matched_application_id]);
  console.log("\napplication:", app);

  const byApplicationId = await query<any>(
    `SELECT id, application_id, target_job_id, source_type, created_at FROM application_resume_versions WHERE application_id = $1 ORDER BY created_at DESC`,
    [latest.ai_matched_application_id]
  );
  console.log("\nMatches via application_id (the fix):", byApplicationId.length);
  byApplicationId.forEach((r) => console.log(" -", r));
}
main().catch((e) => { console.error(e); process.exit(1); });
