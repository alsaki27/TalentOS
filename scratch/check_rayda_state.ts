import { query } from "../src/server/db/neon";

async function main() {
  const cand = (await query(`SELECT id, name FROM candidates WHERE name ILIKE '%rayda%' LIMIT 1`))[0] as any;
  console.log("Candidate:", cand.id, cand.name);

  const rows = await query(
    `SELECT a.id, j.title AS job_title, j.company, a.status,
            a.resume_generation_status,
            w.status AS workflow_status, w.created_at AS wf_created,
            w.base_resume_id
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     LEFT JOIN LATERAL (
       SELECT status, created_at, base_resume_id FROM application_ai_workflows
       WHERE application_id = a.id ORDER BY created_at DESC LIMIT 1
     ) w ON true
     WHERE a.candidate_id = $1
     ORDER BY w.created_at DESC NULLS LAST`,
    [cand.id]
  );
  console.log("Total apps with logged job:", (rows as any[]).length);
  for (const r of rows as any[]) {
    console.log(
      String(r.id).slice(0, 8), "|", r.job_title, "at", r.company,
      "| gen:", r.resume_generation_status,
      "| latest workflow:", r.workflow_status, "created", r.wf_created,
      "| base_resume:", String(r.base_resume_id || "").slice(0, 8)
    );
  }
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
