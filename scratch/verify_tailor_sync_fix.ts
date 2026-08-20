// Verifies the new Tailor Studio -> base_resumes sync is live in production.
// Retries for a few minutes to account for deploy propagation. Re-saves the
// user's own already-edited Tailor Studio session (session 4f87c16c..., linked
// to base resume e4efba67...) via the real production PATCH endpoint - this
// both proves the fix works AND backfills their real edits into base_resumes
// for the first time. Then triggers a real regenerate on the 2 applications
// tied to that base resume to close the loop end to end.
//
// Run with: npx tsx --env-file=.env.local scratch/verify_tailor_sync_fix.ts

import { query, queryOne, execute } from "../src/server/db/neon";

const BASE_URL = "https://talent.skarion.com";
const SESSION_ID = "4f87c16c-0233-48a2-9e00-3e917dd356d3";
const BASE_RESUME_ID = "e4efba67-2cfb-45bc-997b-13c6f9e95eb9";
const CANDIDATE_ID = "16ad4c1b-ef2f-4535-b7b4-c5115acfe09c";
const APPLICATIONS = [
  { applicationId: "ae5f5901-1be9-457b-af86-c5842d931e3c", jobId: "601b415d-2b48-45dc-a22f-414033b09285", label: "HVAC & Utility Mechanical Engineer" },
  { applicationId: "df5b7b12-4638-4a79-86f8-6cb6a080c666", jobId: "3b834d81-5dec-4811-ac3d-3eb19c188399", label: "DFT Engineer" },
];

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function attemptSync(): Promise<boolean> {
  const getRes = await fetch(`${BASE_URL}/api/falood/applications?id=${SESSION_ID}`);
  const getJson: any = await getRes.json();
  if (!getJson?.success) { console.log("  GET failed:", getJson); return false; }
  const resumeData = getJson.data.resumeData;

  const patchRes = await fetch(`${BASE_URL}/api/falood/applications?id=${SESSION_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resumeData }),
  });
  const patchJson: any = await patchRes.json().catch(() => ({}));
  console.log(`  PATCH HTTP ${patchRes.status}, success=${patchJson?.success}`);

  const baseRow = await queryOne<{ content: any; updated_at: string }>(
    "SELECT content, updated_at FROM base_resumes WHERE id = $1", [BASE_RESUME_ID]
  );
  const header = baseRow?.content?.header;
  console.log("  base_resumes.header now:", JSON.stringify(header));
  return header?.fullName === "Istiaque Uddin Hyder";
}

async function pokeDispatch(): Promise<void> {
  try { const res = await fetch(`${BASE_URL}/api/application-ai-workflows/dispatch`, { method: "POST" }); console.log(`  [dispatch poke] HTTP ${res.status}`); }
  catch (err) { console.error("  [dispatch poke] failed:", err); }
}

async function main() {
  console.log("=== Step 1: verify sync fix is live (retrying for deploy propagation) ===");
  let synced = false;
  for (let attempt = 1; attempt <= 8; attempt++) {
    console.log(`\nAttempt ${attempt}/8:`);
    synced = await attemptSync();
    if (synced) { console.log("  ✅ SYNC CONFIRMED WORKING"); break; }
    console.log("  Not yet reflected - waiting 45s (likely still deploying)...");
    await sleep(45000);
  }
  if (!synced) {
    console.log("\n❌ Sync did not take effect after 8 attempts (~6 minutes). Stopping here for investigation.");
    return;
  }

  console.log("\n\n=== Step 2: regenerate both applications tied to this base resume ===");
  const running: { applicationId: string; workflowId: string; label: string }[] = [];
  for (const app of APPLICATIONS) {
    const active = await queryOne<{ id: string }>(
      "SELECT id FROM application_ai_workflows WHERE application_id = $1 AND status IN ('queued','running','waiting')",
      [app.applicationId]
    );
    if (active) { console.log(`Skipping ${app.label}: active workflow exists`); continue; }

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
      `INSERT INTO application_resume_versions (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
       VALUES ($1, $2, $3, $4::jsonb, 'active', 'base_resume', $5, $2) RETURNING *`,
      [CANDIDATE_ID, baseRow!.id, targetResumeRow.target_job_id, JSON.stringify(baseRow!.content ?? {}), null]
    );
    const evidence = await query<any>("SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50", [CANDIDATE_ID]);
    const candidateRow = await queryOne<{ verified_skills: string[] | null }>("SELECT verified_skills FROM candidates WHERE id = $1", [CANDIDATE_ID]);
    const configSnapshot = { candidateId: CANDIDATE_ID, job: jobRow, baseResume: resumeVersion, evidence: evidence ?? [], verifiedSkills: candidateRow?.verified_skills ?? [], sourceOfTruth: null };

    const wf = await queryOne<{ id: string }>(
      `INSERT INTO application_ai_workflows (application_id, base_resume_id, status, current_stage, idempotency_key, config_snapshot, started_by, match_score, match_reason, started_at)
       VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
      [app.applicationId, baseRow!.id, null, configSnapshot, null, null, "post-fix sync verification"]
    );
    await execute("UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1", [app.applicationId]);
    console.log(`${app.label}: workflow ${wf!.id} queued`);
    running.push({ applicationId: app.applicationId, workflowId: wf!.id, label: app.label });
  }

  await pokeDispatch();
  await sleep(3000);
  const deadline = Date.now() + 6 * 60 * 1000;
  const terminal = new Set(["completed", "failed", "cancelled"]);
  let lastReport = "";
  while (Date.now() < deadline) {
    const ids = running.map((r) => r.workflowId);
    if (ids.length === 0) break;
    const rows = await query<{ id: string; status: string; current_stage: number }>(`SELECT id, status, current_stage FROM application_ai_workflows WHERE id = ANY($1::uuid[])`, [ids]);
    const report = rows.map((r) => `${r.id.slice(0, 8)}:${r.status}(stage ${r.current_stage})`).join("  ");
    if (report !== lastReport) { console.log(`  [poll] ${report}`); lastReport = report; }
    if (rows.every((r) => terminal.has(r.status))) { console.log("  All terminal."); break; }
    await pokeDispatch();
    await sleep(15000);
  }

  console.log("\n\n================ FINAL PROOF ================");
  for (const run of running) {
    const appRow = await queryOne<{ tailored_resume_version_id: string | null }>("SELECT tailored_resume_version_id FROM applications WHERE id = $1", [run.applicationId]);
    if (!appRow?.tailored_resume_version_id) { console.log(`${run.label}: no resume persisted`); continue; }
    const finalRow = await queryOne<{ content: any }>("SELECT content FROM application_resume_versions WHERE id = $1", [appRow.tailored_resume_version_id]);
    const h = finalRow?.content?.header;
    console.log(`${run.label}: tailored resume header = ${JSON.stringify(h)}`);
    console.log(`  ${h?.fullName === "Istiaque Uddin Hyder" ? "✅ REFLECTS THE TAILOR STUDIO EDIT" : "❌ DOES NOT REFLECT THE EDIT"}`);
  }
  console.log("================ END ================");
}

main().catch((err) => { console.error("Verification failed:", err); process.exit(1); });
