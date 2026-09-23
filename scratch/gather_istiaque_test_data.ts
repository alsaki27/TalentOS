import { query, queryOne } from "../src/server/db/neon";
const CID = "16ad4c1b-ef2f-4535-b7b4-c5115acfe09c";
async function main() {
  const cand = await queryOne<any>(`SELECT id, name, email, status FROM candidates WHERE id = $1`, [CID]);
  console.log("Candidate:", JSON.stringify(cand));

  const baseResumes = await query<any>(`SELECT id, name, target_industry, status, updated_at FROM base_resumes WHERE candidate_id = $1 ORDER BY updated_at DESC`, [CID]);
  console.log(`\nBase resumes (${baseResumes.length}):`);
  for (const b of baseResumes) console.log(`  ${b.id}  "${b.name}"  status=${b.status}  updated=${b.updated_at}`);

  const apps = await query<any>(`
    SELECT a.id as application_id, a.application_stage, a.resume_generation_status, a.ai_workflow_id, a.created_at,
      j.id as job_id, j.title, j.company
    FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
    WHERE a.candidate_id = $1 ORDER BY a.created_at DESC LIMIT 15
  `, [CID]);
  console.log(`\nApplications (showing up to 15 of total):`);
  for (const a of apps) console.log(`  app=${a.application_id}  job=${a.job_id}  "${a.title}" @ ${a.company}  stage=${a.application_stage}  resume_status=${a.resume_generation_status}  wf=${a.ai_workflow_id ? "yes" : "no"}`);

  const completedWf = await query<any>(`
    SELECT w.id as workflow_id, w.application_id, w.completed_at
    FROM application_ai_workflows w JOIN applications a ON a.id = w.application_id
    WHERE a.candidate_id = $1 AND w.status = 'completed' AND w.completed_at IS NOT NULL
    ORDER BY w.completed_at DESC LIMIT 5
  `, [CID]);
  console.log(`\nCompleted workflows (usable for replay testing):`);
  for (const w of completedWf) console.log(`  workflow=${w.workflow_id}  application=${w.application_id}  completed=${w.completed_at}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
