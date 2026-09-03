import { query } from "../src/server/db/neon";
async function main() {
  const rows = await query<any>(`
    SELECT w.id as workflow_id, a.automation_id, a.sequence_number
    FROM application_ai_workflows w
    JOIN application_ai_artifacts a ON a.workflow_id = w.id
    WHERE w.application_id = '773e06a1-f4bd-43a6-9cd8-4b854979ce27'
    ORDER BY a.sequence_number
  `);
  console.log(JSON.stringify(rows, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
