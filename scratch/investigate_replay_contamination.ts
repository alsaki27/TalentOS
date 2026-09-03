import { query } from "../src/server/db/neon";
async function main() {
  const recentWf = await query<any>(`
    SELECT id, application_id, status, completed_at, started_by, match_reason
    FROM application_ai_workflows
    WHERE status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 15
  `);
  console.log("Most recent 15 completed workflows:");
  for (const w of recentWf) console.log(`  ${w.id}  completed=${w.completed_at}  started_by=${w.started_by}  match_reason=${(w.match_reason||"").slice(0,40)}`);

  console.log("\nArtifact automation_id shape for each:");
  for (const w of recentWf) {
    const arts = await query<any>(`SELECT automation_id FROM application_ai_artifacts WHERE workflow_id = $1 ORDER BY sequence_number`, [w.id]);
    const looksLikeUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
    const shape = arts.map((a: any) => looksLikeUuid(a.automation_id) ? "UUID" : a.automation_id).join(", ");
    console.log(`  ${w.id}: [${shape}]`);
  }

  // Now check: among ALL application_job_lens rows (proper naming), what's the completed_at of their owning workflow?
  const properOnes = await query<any>(`
    SELECT w.id, w.completed_at
    FROM application_ai_artifacts a
    JOIN application_ai_workflows w ON w.id = a.workflow_id
    WHERE a.automation_id = 'application_job_lens'
    ORDER BY w.completed_at DESC NULLS LAST
    LIMIT 10
  `);
  console.log("\nMost recent workflows that DO have a proper 'application_job_lens' artifact:");
  for (const r of properOnes) console.log(`  ${r.id}  completed_at=${r.completed_at}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
