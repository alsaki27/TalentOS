// Makes ONE small, clearly-marked, reversible edit to base resume
// e4efba67-2cfb-45bc-997b-13c6f9e95eb9 (MD AMINUL SARKER), then regenerates
// the 2 applications tied to it, and proves directly whether the edit is
// reflected in the new tailored output. This settles, with certainty, whether
// the pipeline itself has any staleness bug (as opposed to the edit simply
// never having reached the database in the user's own test).
//
// Run with: npx tsx --env-file=.env.local scratch/definitive_edit_and_regen_test.ts

import { query, queryOne, execute } from "../src/server/db/neon";

const CANDIDATE_ID = "16ad4c1b-ef2f-4535-b7b4-c5115acfe09c";
const BASE_RESUME_ID = "e4efba67-2cfb-45bc-997b-13c6f9e95eb9";
const OLD_PHONE = "(269) 312-1996";
const NEW_PHONE = "(269) 312-1998"; // deliberate, distinctive, reversible change
const APPLICATIONS = [
  { applicationId: "ae5f5901-1be9-457b-af86-c5842d931e3c", jobId: "601b415d-2b48-45dc-a22f-414033b09285", label: "HVAC & Utility Mechanical Engineer" },
  { applicationId: "df5b7b12-4638-4a79-86f8-6cb6a080c666", jobId: "3b834d81-5dec-4811-ac3d-3eb19c188399", label: "DFT Engineer" },
];
const BASE_URL = "https://talent.skarion.com";
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function jobDescriptionForTargetJob(job: any): string {
  return [`Title: ${job.title ?? ""}`, job.company ? `Company: ${job.company}` : null, job.location ? `Location: ${job.location}` : null, job.description_text ? job.description_text : null].filter(Boolean).join("\n\n");
}
async function pokeDispatch(): Promise<void> {
  try { const res = await fetch(`${BASE_URL}/api/application-ai-workflows/dispatch`, { method: "POST" }); console.log(`  [dispatch poke] HTTP ${res.status}`); }
  catch (err) { console.error("  [dispatch poke] failed:", err); }
}

async function main() {
  const before = await queryOne<{ content: any }>("SELECT content FROM base_resumes WHERE id = $1", [BASE_RESUME_ID]);
  const beforePhone = before?.content?.header?.phone;
  console.log(`Current phone in DB: "${beforePhone}"`);
  if (beforePhone !== OLD_PHONE) {
    console.log(`WARNING: expected "${OLD_PHONE}" but found "${beforePhone}" - proceeding anyway, will use whatever is actually there as the "before" value.`);
  }

  const newContent = { ...before!.content, header: { ...before!.content.header, phone: NEW_PHONE } };
  await execute(
    "UPDATE base_resumes SET content = $1::jsonb, updated_at = NOW(), updated_by = NULL WHERE id = $2",
    [JSON.stringify(newContent), BASE_RESUME_ID]
  );
  const after = await queryOne<{ content: any; updated_at: string }>("SELECT content, updated_at FROM base_resumes WHERE id = $1", [BASE_RESUME_ID]);
  console.log(`Edit applied. New phone in DB: "${after?.content?.header?.phone}"  updated_at: ${after?.updated_at}`);

  const running: { applicationId: string; workflowId: string; label: string }[] = [];
  for (const app of APPLICATIONS) {
    const active = await queryOne<{ id: string }>(
      "SELECT id FROM application_ai_workflows WHERE application_id = $1 AND status IN ('queued','running','waiting')",
      [app.applicationId]
    );
    if (active) { console.log(`Skipping ${app.label}: active workflow already exists`); continue; }

    const jobRow = await queryOne<any>("SELECT * FROM jobs WHERE id = $1", [app.jobId]);
    const targetResumeRow = await queryOne<any>(
      `SELECT arv.* FROM application_resume_versions arv
       WHERE arv.target_job_id IN (SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2)
         AND arv.source_type = 'base_resume' AND arv.status = 'active'
       ORDER BY arv.created_at DESC LIMIT 1`,
      [CANDIDATE_ID, app.jobId]
    );
    const baseRow = await queryOne<{ id: string; content: any }>("SELECT id, content FROM base_resumes WHERE id = $1", [targetResumeRow.base_resume_id]);

    const resumeVersion = await queryOne<any>(
      `INSERT INTO application_resume_versions
         (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
       VALUES ($1, $2, $3, $4::jsonb, 'active', 'base_resume', $5, $2)
       RETURNING *`,
      [CANDIDATE_ID, baseRow!.id, targetResumeRow.target_job_id, JSON.stringify(baseRow!.content ?? {}), null]
    );
    const evidence = await query<any>("SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50", [CANDIDATE_ID]);
    const candidateRow = await queryOne<{ verified_skills: string[] | null }>("SELECT verified_skills FROM candidates WHERE id = $1", [CANDIDATE_ID]);
    const configSnapshot = { candidateId: CANDIDATE_ID, job: jobRow, baseResume: resumeVersion, evidence: evidence ?? [], verifiedSkills: candidateRow?.verified_skills ?? [], sourceOfTruth: null };

    const wf = await queryOne<{ id: string }>(
      `INSERT INTO application_ai_workflows (application_id, base_resume_id, status, current_stage, idempotency_key, config_snapshot, started_by, match_score, match_reason, started_at)
       VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [app.applicationId, baseRow!.id, null, configSnapshot, null, null, "definitive edit-then-regen proof test"]
    );
    await execute("UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1", [app.applicationId]);
    console.log(`${app.label}: workflow ${wf!.id} queued`);
    running.push({ applicationId: app.applicationId, workflowId: wf!.id, label: app.label });
  }

  console.log("\nDispatching...");
  await pokeDispatch();
  await sleep(3000);
  const deadline = Date.now() + 6 * 60 * 1000;
  const terminal = new Set(["completed", "failed", "cancelled"]);
  let lastReport = "";
  while (Date.now() < deadline) {
    const ids = running.map((r) => r.workflowId);
    const rows = await query<{ id: string; status: string; current_stage: number }>(`SELECT id, status, current_stage FROM application_ai_workflows WHERE id = ANY($1::uuid[])`, [ids]);
    const report = rows.map((r) => `${r.id.slice(0, 8)}:${r.status}(stage ${r.current_stage})`).join("  ");
    if (report !== lastReport) { console.log(`  [poll] ${report}`); lastReport = report; }
    if (rows.every((r) => terminal.has(r.status))) { console.log("  All terminal."); break; }
    await pokeDispatch();
    await sleep(15000);
  }

  console.log("\n\n================ PROOF ================");
  for (const run of running) {
    const appRow = await queryOne<{ tailored_resume_version_id: string | null }>("SELECT tailored_resume_version_id FROM applications WHERE id = $1", [run.applicationId]);
    if (!appRow?.tailored_resume_version_id) { console.log(`${run.label}: no resume persisted`); continue; }
    const finalRow = await queryOne<{ content: any }>("SELECT content FROM application_resume_versions WHERE id = $1", [appRow.tailored_resume_version_id]);
    const gotPhone = finalRow?.content?.header?.phone;
    console.log(`${run.label}: new tailored resume phone = "${gotPhone}"  ${gotPhone === NEW_PHONE ? "-> CORRECTLY PICKED UP THE EDIT" : "-> !!! DID NOT PICK UP THE EDIT !!!"}`);
  }
  console.log("================ END PROOF ================");
}

main().catch((err) => { console.error("Test failed:", err); process.exit(1); });
