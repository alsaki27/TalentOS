import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const CID = "04dbd347-055e-4621-a68a-44fc690b8f5f";

async function main() {
  const latest = await sql`
    WITH ranked AS (
      SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.application_id ORDER BY h.changed_at DESC) as rn
      FROM application_stage_history h
      JOIN applications a ON a.id = h.application_id
      WHERE a.candidate_id = ${CID}
    )
    SELECT application_id, from_stage, to_stage, changed_at, changed_by_name, source
    FROM ranked WHERE rn = 1 AND source = 'queue' AND to_stage = 'in_ai_pipeline'
  `;
  console.log("Count matching bulk pattern:", latest.length);

  const appIds = latest.map((r: any) => r.application_id);
  const now = await sql`SELECT now() as t`;
  console.log("Current DB time:", now[0].t);

  const apps: any[] = await sql`
    SELECT a.id, a.created_at, a.application_stage, a.status, a.resume_generation_status,
      a.tailored_resume_version_id, a.base_resume_id, a.job_id, a.ai_workflow_id,
      j.title, j.company, (j.description_text IS NOT NULL) as has_description, j.posted_at, j.created_at as job_created_at
    FROM applications a
    LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.id = ANY(${appIds}::uuid[])
    ORDER BY a.created_at DESC
  `;
  console.log("\n=== Full current state of the 44 ===");
  for (const a of apps) {
    const days = Math.round(((Date.now() - new Date(a.created_at).getTime()) / 86400000) * 10) / 10;
    console.log(
      `${a.title?.slice(0, 40).padEnd(40)} | stage=${a.application_stage} | resume_status=${a.resume_generation_status} | tailored=${!!a.tailored_resume_version_id} | app_created=${a.created_at} (${days}d ago) | job_created=${a.job_created_at} | has_desc=${a.has_description} | wf=${a.ai_workflow_id ? "yes" : "no"}`
    );
  }

  const wfIds = apps.filter((a) => a.ai_workflow_id).map((a) => a.ai_workflow_id);
  if (wfIds.length > 0) {
    const wfs = await sql`SELECT id, status, current_stage, last_error FROM application_ai_workflows WHERE id = ANY(${wfIds}::uuid[])`;
    console.log("\n=== Workflow status ===");
    console.table(wfs);
  }

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND (table_name ILIKE '%backup%' OR table_name ILIKE '%snapshot%' OR table_name ILIKE '%archive%' OR table_name ILIKE '%activity_log%')
    ORDER BY table_name
  `;
  console.log("\n=== Existing backup/snapshot/archive/activity_log tables ===");
  console.table(tables);

  // Stage distribution summary
  const stageCounts: Record<string, number> = {};
  for (const a of apps) stageCounts[a.application_stage] = (stageCounts[a.application_stage] || 0) + 1;
  console.log("\n=== Stage distribution now ===", stageCounts);

  const within7d = apps.filter((a) => (Date.now() - new Date(a.created_at).getTime()) / 86400000 <= 7);
  console.log(`\nApplications created within last 7 days: ${within7d.length} / ${apps.length}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
