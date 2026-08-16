// READ-ONLY. Traces the exact base_resume_id + workflow config snapshot used
// for the specific resume version that showed "Jul 2025 - Jan 2001".
import { query } from "../src/server/db/neon";

const BUGGED_VERSION_ID = "bbfc488e-f5f3-4c6e-93fd-67187b9f9d83";

async function main() {
  const rv = await query<any>(
    `SELECT id, candidate_id, base_resume_id, workflow_id, created_at, content->'experience' AS experience
     FROM application_resume_versions WHERE id = $1`,
    [BUGGED_VERSION_ID]
  );
  console.log("BUGGED_VERSION:", JSON.stringify(rv, null, 2));

  if (rv.length > 0 && rv[0].base_resume_id) {
    const base = await query<any>(
      `SELECT id, created_at, content->'experience' AS experience FROM base_resumes WHERE id = $1`,
      [rv[0].base_resume_id]
    );
    console.log("BASE_RESUME_AT_GENERATION_TIME:", JSON.stringify(base, null, 2));
  }

  if (rv.length > 0 && rv[0].workflow_id) {
    const wf = await query<any>(
      `SELECT id, config_snapshot->'baseResume'->'content'->'experience' AS snapshot_experience
       FROM application_ai_workflows WHERE id = $1`,
      [rv[0].workflow_id]
    );
    console.log("WORKFLOW_CONFIG_SNAPSHOT_EXPERIENCE:", JSON.stringify(wf, null, 2));

    // Raw Resume Forge / Final Polish artifacts for this workflow.
    const artifacts = await query<any>(
      `SELECT automation_id, data->'experience' AS experience
       FROM application_ai_artifacts WHERE workflow_id = $1 AND automation_id IN ('application_resume_forge','application_final_polish')
       ORDER BY sequence_number`,
      [rv[0].workflow_id]
    );
    console.log("ARTIFACTS_EXPERIENCE:", JSON.stringify(artifacts, null, 2));
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
