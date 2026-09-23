import { queryOne } from "../src/server/db/neon";
async function main() {
  const row = await queryOne<any>(
    `SELECT ec.*, a.job_id as resolved_job_id, j.title as resolved_job_title, j.company as resolved_company
     FROM email_communications ec
     LEFT JOIN applications a ON a.id = ec.ai_matched_application_id
     LEFT JOIN jobs j ON j.id = a.job_id
     WHERE ec.id = $1`,
    ["8bf1e5af-dc8e-4457-ad5a-09339421ee2f"]
  );
  console.log(JSON.stringify(row, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
