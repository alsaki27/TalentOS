import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(`
    SELECT w.id as workflow_id, w.application_id, w.base_resume_id, w.config_snapshot
    FROM application_ai_workflows w
    JOIN applications a ON a.id = w.application_id
    WHERE a.job_id = '9901ae99-4408-4d0a-8447-b3eb66ca614d' AND w.status = 'completed'
    ORDER BY w.completed_at DESC LIMIT 1
  `);
  console.log(JSON.stringify(rows, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
