import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL!);

const CID = "04dbd347-055e-4621-a68a-44fc690b8f5f";

async function main() {
  const latest: any[] = await sql`
    WITH ranked AS (
      SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.application_id ORDER BY h.changed_at DESC) as rn
      FROM application_stage_history h
      JOIN applications a ON a.id = h.application_id
      WHERE a.candidate_id = ${CID}
    )
    SELECT application_id, changed_at, changed_by_name
    FROM ranked WHERE rn = 1 AND source = 'queue' AND to_stage = 'in_ai_pipeline'
      AND changed_by_name = 'Md Ferdous Hasan Akash'
  `;
  const appIds = latest.map((r) => r.application_id);
  console.log("Bulk cluster size (by changed_by_name filter):", appIds.length);

  const jobs: any[] = await sql`
    SELECT a.id as app_id, a.created_at, j.id as job_id, j.title, j.description_text, j.notes,
      j.description_html, j.raw_source_payload, a.ai_workflow_id, a.resume_generation_status
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.id = ANY(${appIds}::uuid[])
  `;
  console.log("Total apps in cluster:", jobs.length);
  const noDesc = jobs.filter((j) => !j.description_text);
  console.log("Missing description_text:", noDesc.length);
  for (const j of noDesc) {
    console.log("---", j.title, j.job_id);
    console.log("  notes:", j.notes ? j.notes.slice(0, 150) : null);
    console.log("  description_html:", j.description_html ? j.description_html.slice(0, 150) : null);
    console.log("  raw_source_payload.description:", j.raw_source_payload?.description ? String(j.raw_source_payload.description).slice(0, 150) : null);
    console.log("  resume_generation_status:", j.resume_generation_status, "| workflow:", j.ai_workflow_id);
  }

  const noWorkflow = jobs.filter((j) => !j.ai_workflow_id);
  console.log("\nApps with NO ai_workflow_id at all:", noWorkflow.length);
  for (const j of noWorkflow) {
    console.log(` - ${j.title} | has_desc=${!!j.description_text} | app_id=${j.app_id}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
