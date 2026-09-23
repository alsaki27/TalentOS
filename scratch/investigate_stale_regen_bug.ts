// READ-ONLY. npx tsx --env-file=.env.local scratch/investigate_stale_regen_bug.ts
import { query, queryOne } from "../src/server/db/neon";

const CANDIDATE_ID = "16ad4c1b-ef2f-4535-b7b4-c5115acfe09c";
const APPLICATION_IDS = [
  "ae5f5901-1be9-457b-af86-c5842d931e3c",
  "df5b7b12-4638-4a79-86f8-6cb6a080c666",
  "592dcf7f-5bfc-449d-9b71-99942522d46e",
  "2e7a8491-4387-4118-ac71-57ab8971328a",
];

async function main() {
  console.log("=== Base resumes: current content + updated_at ===");
  for (const id of ["e4efba67-2cfb-45bc-997b-13c6f9e95eb9", "40b3750b-8ea6-4613-bffe-56021ad2e1ef"]) {
    const row = await queryOne<{ content: any; updated_at: string }>(
      "SELECT content, updated_at FROM base_resumes WHERE id = $1", [id]
    );
    console.log(`\n${id}  updated_at=${row?.updated_at}`);
    console.log("full content:", JSON.stringify(row?.content, null, 2));
  }

  console.log("\n\n=== All application_ai_workflows for the 4 test applications (every attempt, all time) ===");
  const workflows = await query<any>(
    `SELECT id, application_id, base_resume_id, status, current_stage, created_at, started_at, completed_at, last_error
     FROM application_ai_workflows
     WHERE application_id = ANY($1::uuid[])
     ORDER BY application_id, created_at ASC`,
    [APPLICATION_IDS]
  );
  console.log(JSON.stringify(workflows, null, 2));

  console.log("\n\n=== Current applications row state (which resume version is currently linked) ===");
  const apps = await query<any>(
    `SELECT id, job_id, base_resume_id, ai_workflow_id, tailored_resume_version_id, resume_generation_status, resume_generation_error, resume_generation_completed_at
     FROM applications WHERE id = ANY($1::uuid[])`,
    [APPLICATION_IDS]
  );
  console.log(JSON.stringify(apps, null, 2));

  console.log("\n\n=== ALL application_resume_versions ever created for these 4 applications (via target_job link) ===");
  for (const appId of APPLICATION_IDS) {
    const app = apps.find((a: any) => a.id === appId);
    const versions = await query<any>(
      `SELECT id, base_resume_id, source_type, status, created_at, updated_at
       FROM application_resume_versions
       WHERE application_id = $1
       ORDER BY created_at ASC`,
      [appId]
    );
    console.log(`\napplication ${appId} (currently linked tailored_resume_version_id=${app?.tailored_resume_version_id}):`);
    console.log(JSON.stringify(versions, null, 2));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
