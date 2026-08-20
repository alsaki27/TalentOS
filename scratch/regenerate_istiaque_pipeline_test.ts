// Regenerates all 4 previously-tested applications for "Test Istiaque",
// re-materializing from each application's linked base_resume_id at THIS
// moment (picking up whatever the base resume currently contains - including
// SADDAM H.'s base resume, which has a newer updated_at than the first test
// run, i.e. it has genuinely been edited since). Faithfully replicates
// regenerateAiWorkflowForApplication()'s DB logic without importing
// applicationAiWorkflowService.ts (which pulls in @opennextjs/cloudflare and
// crashes plain tsx - see scratch/istiaque_test_output.log from the first
// run for the exact error). Reports both (a) the standard identity diff vs.
// the CURRENT base resume, and (b) a diff vs. the PREVIOUS tailored resume
// from the first test run, to show exactly what changed.
//
// Run with: npx tsx --env-file=.env.local scratch/regenerate_istiaque_pipeline_test.ts

import { query, queryOne, execute } from "../src/server/db/neon";

const CANDIDATE_ID = "16ad4c1b-ef2f-4535-b7b4-c5115acfe09c";
const BASE_URL = "https://talent.skarion.com";

const APPLICATIONS = [
  { applicationId: "ae5f5901-1be9-457b-af86-c5842d931e3c", jobId: "601b415d-2b48-45dc-a22f-414033b09285", label: "HVAC & Utility Mechanical Engineer @ Boviet Solar Technologies", prevResumeId: "922568e0-d92b-4e2d-a71e-dc2a8ada7b79" },
  { applicationId: "df5b7b12-4638-4a79-86f8-6cb6a080c666", jobId: "3b834d81-5dec-4811-ac3d-3eb19c188399", label: "DFT Engineer @ JNL Technologies", prevResumeId: "5e07745a-4cf6-4f95-9378-ca2974aa50f5" },
  { applicationId: "592dcf7f-5bfc-449d-9b71-99942522d46e", jobId: "3e803d2f-878a-4683-82ad-1b1116139161", label: "Engineer - Entry Level, Solar (PV) @ Intertek", prevResumeId: "b92ba6cb-7ed8-4b71-9a30-4da9ebdf77e1" },
  { applicationId: "2e7a8491-4387-4118-ac71-57ab8971328a", jobId: "cfd63ee3-5091-4764-bf51-d02383fe7bba", label: "Mechanical Design Engineer @ Insight Global", prevResumeId: "d9af85a4-ab00-48cc-b6eb-563f8cf53fb6" },
];

type Rec = Record<string, unknown>;
function isRec(v: unknown): v is Rec { return !!v && typeof v === "object" && !Array.isArray(v); }
function text(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (isRec(v)) for (const k of ["text", "value", "name", "label", "title"]) if (typeof v[k] === "string") return (v[k] as string).trim();
  return "";
}
function baseHeader(baseContent: any): Rec {
  if (isRec(baseContent?.header)) return baseContent.header as Rec;
  if (isRec(baseContent?.personalInfo)) return baseContent.personalInfo as Rec;
  return {};
}
function diffField(label: string, wantVal: string, gotVal: string, out: string[]) {
  const w = wantVal.trim(), g = gotVal.trim();
  if (w && g && w.toLowerCase() !== g.toLowerCase()) out.push(`      MISMATCH ${label}: expected="${w}"  got="${g}"`);
}
function diffExperience(baseEntries: any[], gotEntries: any[], out: string[]) {
  const gArr = Array.isArray(gotEntries) ? gotEntries : [];
  baseEntries.forEach((b, i) => {
    const bi = isRec(b) ? b : {}, gi = isRec(gArr[i]) ? gArr[i] : {};
    const tag = `exp[${i}]`;
    diffField(`${tag} title`, text(bi.title), text(gi.title), out);
    diffField(`${tag} company`, text(bi.company), text(gi.company), out);
    diffField(`${tag} location`, text(bi.location), text(gi.location), out);
    diffField(`${tag} startDate`, text(bi.startDate), text(gi.startDate), out);
    diffField(`${tag} endDate`, text(bi.endDate), text(gi.endDate), out);
  });
  if (gArr.length !== baseEntries.length) out.push(`      COUNT MISMATCH experience: expected=${baseEntries.length} got=${gArr.length}`);
}
function diffPersonalInfo(baseContent: any, got: any, out: string[]) {
  const base = baseHeader(baseContent);
  const g = isRec(got) ? got : {};
  diffField("fullName", text(base.fullName ?? base.name), text(g.fullName ?? g.name), out);
  diffField("email", text(base.email), text(g.email), out);
  diffField("phone", text(base.phone), text(g.phone), out);
  diffField("linkedin", text(base.linkedin), text(g.linkedin), out);
  diffField("location", text(base.location), text(g.location), out);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function jobDescriptionForTargetJob(job: any): string {
  return [`Title: ${job.title ?? ""}`, job.company ? `Company: ${job.company}` : null, job.location ? `Location: ${job.location}` : null, job.description_text ? job.description_text : null].filter(Boolean).join("\n\n");
}
async function pokeDispatch(): Promise<void> {
  try { const res = await fetch(`${BASE_URL}/api/application-ai-workflows/dispatch`, { method: "POST" }); console.log(`  [dispatch poke] HTTP ${res.status}`); }
  catch (err) { console.error("  [dispatch poke] failed:", err); }
}

async function main() {
  console.log("Current base resume state right before regeneration:\n");
  for (const brId of ["e4efba67-2cfb-45bc-997b-13c6f9e95eb9", "40b3750b-8ea6-4613-bffe-56021ad2e1ef"]) {
    const br = await queryOne<{ content: any; updated_at: string }>("SELECT content, updated_at FROM base_resumes WHERE id = $1", [brId]);
    console.log(`  ${brId}  updated_at=${br?.updated_at}  personalInfo=${JSON.stringify(baseHeader(br?.content))}`);
  }

  const running: { applicationId: string; workflowId: string; prevResumeId: string; label: string }[] = [];

  for (const app of APPLICATIONS) {
    const active = await queryOne<{ id: string }>(
      "SELECT id FROM application_ai_workflows WHERE application_id = $1 AND status IN ('queued','running','waiting')",
      [app.applicationId]
    );
    if (active) { console.log(`\nSkipping ${app.label}: active workflow ${active.id} already exists`); continue; }

    const jobRow = await queryOne<any>("SELECT * FROM jobs WHERE id = $1", [app.jobId]);
    const targetResumeRow = await queryOne<any>(
      `SELECT arv.* FROM application_resume_versions arv
       WHERE arv.target_job_id IN (SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2)
         AND arv.source_type = 'base_resume' AND arv.status = 'active'
       ORDER BY arv.created_at DESC LIMIT 1`,
      [CANDIDATE_ID, app.jobId]
    );
    if (!targetResumeRow?.base_resume_id) { console.log(`\nSkipping ${app.label}: no linked base_resume_id found`); continue; }

    const baseRow = await queryOne<{ id: string; content: any }>("SELECT id, content FROM base_resumes WHERE id = $1", [targetResumeRow.base_resume_id]);
    if (!baseRow) { console.log(`\nSkipping ${app.label}: base resume ${targetResumeRow.base_resume_id} not found`); continue; }

    // Re-materialize fresh from the CURRENT base_resumes.content, exactly like regenerateAiWorkflowForApplication does.
    const resumeVersion = await queryOne<any>(
      `INSERT INTO application_resume_versions
         (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
       VALUES ($1, $2, $3, $4::jsonb, 'active', 'base_resume', $5, $2)
       RETURNING *`,
      [CANDIDATE_ID, baseRow.id, targetResumeRow.target_job_id, JSON.stringify(baseRow.content ?? {}), null]
    );

    const evidence = await query<any>("SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50", [CANDIDATE_ID]);
    const candidateRow = await queryOne<{ verified_skills: string[] | null }>("SELECT verified_skills FROM candidates WHERE id = $1", [CANDIDATE_ID]);

    const configSnapshot = {
      candidateId: CANDIDATE_ID,
      job: jobRow,
      baseResume: resumeVersion,
      evidence: evidence ?? [],
      verifiedSkills: candidateRow?.verified_skills ?? [],
      sourceOfTruth: null,
    };

    const wf = await queryOne<{ id: string }>(
      `INSERT INTO application_ai_workflows
        (application_id, base_resume_id, status, current_stage, idempotency_key, config_snapshot, started_by, match_score, match_reason, started_at)
       VALUES ($1, $2, 'queued', 0, $3, $4, $5, $6, $7, NOW())
       RETURNING id`,
      [app.applicationId, baseRow.id, null, configSnapshot, null, null, "scripted regenerate test run"]
    );
    if (!wf) { console.log(`\nFailed to create workflow for ${app.label}`); continue; }

    await execute("UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1", [app.applicationId]);

    console.log(`\n${app.label}: new workflow ${wf.id} queued (base resume content re-materialized fresh just now)`);
    running.push({ applicationId: app.applicationId, workflowId: wf.id, prevResumeId: app.prevResumeId, label: app.label });
  }

  if (running.length === 0) { console.log("\nNothing to regenerate."); return; }

  console.log(`\n${running.length} regeneration(s) queued. Kicking off dispatch...`);
  await pokeDispatch();
  await sleep(3000);

  const deadline = Date.now() + 9 * 60 * 1000;
  const terminal = new Set(["completed", "failed", "cancelled"]);
  let lastReport = "";
  while (Date.now() < deadline) {
    const ids = running.map((r) => r.workflowId);
    const rows = await query<{ id: string; status: string; current_stage: number }>(
      `SELECT id, status, current_stage FROM application_ai_workflows WHERE id = ANY($1::uuid[])`, [ids]
    );
    const report = rows.map((r) => `${r.id.slice(0, 8)}:${r.status}(stage ${r.current_stage})`).join("  ");
    if (report !== lastReport) { console.log(`  [poll] ${report}`); lastReport = report; }
    if (rows.every((r) => terminal.has(r.status))) { console.log("  All regenerations terminal."); break; }
    await pokeDispatch();
    await sleep(15000);
  }

  console.log("\n\n================ REGENERATION REPORT ================");
  for (const run of running) {
    console.log(`\n\n########## ${run.label} — application ${run.applicationId} ##########`);
    const wf = await queryOne<{ status: string; base_resume_id: string | null; last_error: string | null }>(
      "SELECT status, base_resume_id, last_error FROM application_ai_workflows WHERE id = $1", [run.workflowId]
    );
    console.log(`  workflow status: ${wf?.status}  last_error: ${wf?.last_error ?? "none"}`);

    const baseRow = wf?.base_resume_id ? await queryOne<{ content: any }>("SELECT content FROM base_resumes WHERE id = $1", [wf.base_resume_id]) : null;
    const baseContent = baseRow?.content ?? {};
    const baseExperience: any[] = Array.isArray(baseContent.experience) ? baseContent.experience : [];

    const appRow = await queryOne<{ tailored_resume_version_id: string | null }>("SELECT tailored_resume_version_id FROM applications WHERE id = $1", [run.applicationId]);
    if (!appRow?.tailored_resume_version_id) { console.log("  (no new final resume version persisted)"); continue; }

    const newFinal = await queryOne<{ content: any }>("SELECT content FROM application_resume_versions WHERE id = $1", [appRow.tailored_resume_version_id]);
    const newDoc = newFinal?.content ?? {};

    console.log(`\n  [1] New resume ${appRow.tailored_resume_version_id} vs. CURRENT base resume (${wf?.base_resume_id}) - standard identity check:`);
    const out1: string[] = [];
    diffExperience(baseExperience, (newDoc as any).experience, out1);
    diffPersonalInfo(baseContent, (newDoc as any).header ?? (newDoc as any).personalInfo, out1);
    console.log(out1.length === 0 ? "      CLEAN - matches current base resume on every checked field." : out1.join("\n"));

    const prevFinal = await queryOne<{ content: any }>("SELECT content FROM application_resume_versions WHERE id = $1", [run.prevResumeId]);
    const prevDoc = prevFinal?.content ?? {};
    console.log(`\n  [2] New resume vs. PREVIOUS resume from the first test run (${run.prevResumeId}) - what actually changed:`);
    const out2: string[] = [];
    const prevHeader = isRec((prevDoc as any).header) ? (prevDoc as any).header : (isRec((prevDoc as any).personalInfo) ? (prevDoc as any).personalInfo : {});
    const newHeader = isRec((newDoc as any).header) ? (newDoc as any).header : (isRec((newDoc as any).personalInfo) ? (newDoc as any).personalInfo : {});
    for (const field of ["fullName", "email", "phone", "linkedin", "location"]) {
      const pv = text((prevHeader as any)[field]);
      const nv = text((newHeader as any)[field]);
      if (pv !== nv) out2.push(`      header.${field}: was "${pv}"  now "${nv}"`);
    }
    const prevExp = Array.isArray((prevDoc as any).experience) ? (prevDoc as any).experience : [];
    const newExp = Array.isArray((newDoc as any).experience) ? (newDoc as any).experience : [];
    prevExp.forEach((p: any, i: number) => {
      const n = newExp[i] ?? {};
      for (const field of ["title", "company", "location", "startDate", "endDate"]) {
        const pv = text(p?.[field]); const nv = text(n?.[field]);
        if (pv !== nv) out2.push(`      experience[${i}].${field}: was "${pv}"  now "${nv}"`);
      }
    });
    console.log(out2.length === 0 ? "      No identity-field differences vs. the first run (base resume identity fields were unchanged between runs)." : out2.join("\n"));
  }
  console.log("\n================ END REPORT ================");
}

main().catch((err) => { console.error("Regenerate test failed:", err); process.exit(1); });
