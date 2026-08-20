// Creates 4 real applications for the "Test Istiaque" candidate against 4 real
// jobs (2 against each of their 2 base resumes), triggers the live production
// AI resume pipeline for each (real AI spend, real DB rows — user-confirmed),
// polls until all 4 are terminal, then diffs every per-stage artifact + the
// final persisted resume against the base resume actually used, reporting
// exactly where (if anywhere) identity fields drift.
//
// Deliberately does NOT import src/server/services/applicationAiWorkflowService.ts
// or any src/server/repositories/* file - those transitively import
// @opennextjs/cloudflare, which has no usable Node "exports" outside the real
// Cloudflare/Next.js build and crashes plain tsx at import time (confirmed).
// Every DB write below is a faithful hand-copy of what that service does
// (verified by reading its source directly), using only the plain db/neon
// helper, which has no such dependency. Processing itself is kicked off via
// the exact same HTTP dispatch endpoint the live app self-calls.
//
// Run with: npx tsx --env-file=.env.local scratch/run_istiaque_pipeline_test.ts

import { query, queryOne, execute } from "../src/server/db/neon";

const CANDIDATE_ID = "16ad4c1b-ef2f-4535-b7b4-c5115acfe09c"; // Test Istiaque
const BASE_RESUME_A = "e4efba67-2cfb-45bc-997b-13c6f9e95eb9"; // MD AMINUL SARKER
const BASE_RESUME_B = "40b3750b-8ea6-4613-bffe-56021ad2e1ef"; // SADDAM H.
const BASE_URL = "https://talent.skarion.com";

const RUNS = [
  { jobId: "601b415d-2b48-45dc-a22f-414033b09285", baseResumeId: BASE_RESUME_A }, // HVAC & Utility Mechanical Engineer
  { jobId: "3b834d81-5dec-4811-ac3d-3eb19c188399", baseResumeId: BASE_RESUME_A }, // DFT Engineer
  { jobId: "3e803d2f-878a-4683-82ad-1b1116139161", baseResumeId: BASE_RESUME_B }, // Engineer - Entry Level, Solar (PV)
  { jobId: "cfd63ee3-5091-4764-bf51-d02383fe7bba", baseResumeId: BASE_RESUME_B }, // Mechanical Design Engineer
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
function diffField(label: string, baseVal: string, gotVal: string, out: string[]) {
  const b = baseVal.trim(), g = gotVal.trim();
  if (b && g && b.toLowerCase() !== g.toLowerCase()) out.push(`      MISMATCH ${label}: base="${b}"  got="${g}"`);
}
function diffExperience(baseEntries: any[], gotEntries: any[], out: string[]) {
  const gArr = Array.isArray(gotEntries) ? gotEntries : [];
  baseEntries.forEach((b, i) => {
    const bi = isRec(b) ? b : {}, gi = isRec(gArr[i]) ? gArr[i] : {};
    const tag = `exp[${i}] "${text(bi.title)}"@"${text(bi.company)}"`;
    diffField(`${tag} title`, text(bi.title), text(gi.title), out);
    diffField(`${tag} company`, text(bi.company), text(gi.company), out);
    diffField(`${tag} location`, text(bi.location), text(gi.location), out);
    diffField(`${tag} startDate`, text(bi.startDate), text(gi.startDate), out);
    diffField(`${tag} endDate`, text(bi.endDate), text(gi.endDate), out);
  });
  if (gArr.length !== baseEntries.length) out.push(`      COUNT MISMATCH experience: base=${baseEntries.length} got=${gArr.length}`);
}
function diffEducation(baseEntries: any[], gotEntries: any[], out: string[]) {
  const gArr = Array.isArray(gotEntries) ? gotEntries : [];
  baseEntries.forEach((b, i) => {
    const bi = isRec(b) ? b : {}, gi = isRec(gArr[i]) ? gArr[i] : {};
    const tag = `edu[${i}] "${text(bi.degree)}"`;
    diffField(`${tag} degree`, text(bi.degree), text(gi.degree), out);
    diffField(`${tag} school`, text(bi.institution ?? bi.school), text(gi.school ?? gi.institution), out);
    diffField(`${tag} graduationDate`, text(bi.graduationYear ?? bi.graduationDate), text(gi.graduationDate ?? gi.graduationYear), out);
  });
}
function diffPersonalInfo(baseContent: any, got: any, out: string[]) {
  const base = baseHeader(baseContent);
  const g = isRec(got) ? got : {};
  if (Object.keys(g).length === 0) { out.push("      (stage output carries no personalInfo/header field - expected)"); return; }
  diffField("fullName", text(base.fullName ?? base.name), text(g.fullName ?? g.name), out);
  diffField("email", text(base.email), text(g.email), out);
  diffField("phone", text(base.phone), text(g.phone), out);
  diffField("github", text(base.github), text(g.github), out);
  diffField("linkedin", text(base.linkedin), text(g.linkedin), out);
  diffField("location", text(base.location), text(g.location), out);
}
async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function jobDescriptionForTargetJob(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text ? job.description_text : null,
  ].filter(Boolean).join("\n\n");
}

async function pokeDispatch(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/application-ai-workflows/dispatch`, { method: "POST" });
    console.log(`  [dispatch poke] HTTP ${res.status}`);
  } catch (err) {
    console.error("  [dispatch poke] failed:", err);
  }
}

async function main() {
  console.log(`Setting up ${RUNS.length} applications for candidate ${CANDIDATE_ID}...`);
  const created: { jobId: string; applicationId: string; workflowId: string }[] = [];

  for (const run of RUNS) {
    const jobRow = await queryOne<any>("SELECT * FROM jobs WHERE id = $1", [run.jobId]);
    if (!jobRow) { console.error(`  Job ${run.jobId} not found, skipping`); continue; }
    const baseRow = await queryOne<{ id: string; content: any }>(
      "SELECT id, content FROM base_resumes WHERE id = $1", [run.baseResumeId]
    );
    if (!baseRow) { console.error(`  Base resume ${run.baseResumeId} not found, skipping`); continue; }

    const app = await queryOne<{ id: string }>(
      `INSERT INTO applications (candidate_id, job_id, status, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
      [CANDIDATE_ID, run.jobId, "in_progress", null]
    );
    if (!app) { console.error(`  Failed to create application for job ${run.jobId}`); continue; }
    console.log(`  Application ${app.id} created for "${jobRow.title}" @ ${jobRow.company} (base resume: ${run.baseResumeId === BASE_RESUME_A ? "MD AMINUL SARKER" : "SADDAM H."})`);

    const targetJob = await queryOne<{ id: string }>(
      `INSERT INTO target_jobs (candidate_id, job_id, raw_description, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (candidate_id, job_id) DO UPDATE SET raw_description = EXCLUDED.raw_description
       RETURNING id`,
      [CANDIDATE_ID, run.jobId, jobDescriptionForTargetJob(jobRow), null]
    );
    if (!targetJob) { console.error(`    Failed to create target_job`); continue; }

    const resumeVersion = await queryOne<any>(
      `INSERT INTO application_resume_versions
         (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
       VALUES ($1, $2, $3, $4::jsonb, 'active', 'base_resume', $5, $2)
       RETURNING *`,
      [CANDIDATE_ID, baseRow.id, targetJob.id, JSON.stringify(baseRow.content ?? {}), null]
    );
    if (!resumeVersion) { console.error(`    Failed to materialize resume version`); continue; }

    await execute(
      `INSERT INTO application_packets (application_id, resume_version_id, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (application_id) DO UPDATE SET resume_version_id = EXCLUDED.resume_version_id, updated_at = NOW()`,
      [app.id, resumeVersion.id]
    );

    const evidence = await query<any>(
      "SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
      [CANDIDATE_ID]
    );
    const candidateRow = await queryOne<{ verified_skills: string[] | null }>(
      "SELECT verified_skills FROM candidates WHERE id = $1", [CANDIDATE_ID]
    );

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
      [app.id, baseRow.id, null, configSnapshot, null, null, "scripted identity-guard test run"]
    );
    if (!wf) { console.error(`    Failed to create workflow`); continue; }
    console.log(`    -> workflow ${wf.id} queued`);
    created.push({ jobId: run.jobId, applicationId: app.id, workflowId: wf.id });
  }

  console.log(`\n${created.length} of ${RUNS.length} workflows queued. Kicking off dispatch...`);
  await pokeDispatch();
  await sleep(3000);

  const deadline = Date.now() + 9 * 60 * 1000;
  const terminal = new Set(["completed", "failed", "cancelled"]);
  let lastReport = "";
  while (Date.now() < deadline) {
    const ids = created.map((r) => r.workflowId);
    const rows = await query<{ id: string; status: string; current_stage: number; last_error: string | null }>(
      `SELECT id, status, current_stage, last_error FROM application_ai_workflows WHERE id = ANY($1::uuid[])`,
      [ids]
    );
    const report = rows.map((r) => `${r.id.slice(0, 8)}:${r.status}(stage ${r.current_stage})`).join("  ");
    if (report !== lastReport) { console.log(`  [poll] ${report}`); lastReport = report; }
    if (rows.every((r) => terminal.has(r.status))) { console.log("  All workflows terminal."); break; }
    await pokeDispatch(); // nudge any queued-but-not-yet-claimed workflow forward, same as the cron dispatcher does
    await sleep(15000);
  }

  console.log("\n\n================ IDENTITY-FIELD REPORT ================");
  for (const run of created) {
    console.log(`\n\n########## Job ${run.jobId} — application ${run.applicationId} ##########`);

    const wf = await queryOne<{ status: string; base_resume_id: string | null; last_error: string | null }>(
      "SELECT status, base_resume_id, last_error FROM application_ai_workflows WHERE id = $1",
      [run.workflowId]
    );
    console.log(`  workflow status: ${wf?.status}  base_resume_id used: ${wf?.base_resume_id}  last_error: ${wf?.last_error ?? "none"}`);
    if (!wf?.base_resume_id) { console.log("  (no base_resume_id resolved - cannot diff)"); continue; }

    const baseRow = await queryOne<{ content: any }>("SELECT content FROM base_resumes WHERE id = $1", [wf.base_resume_id]);
    const baseContent = baseRow?.content ?? {};
    const baseExperience: any[] = Array.isArray(baseContent.experience) ? baseContent.experience : [];
    const baseEducation: any[] = Array.isArray(baseContent.education) ? baseContent.education : [];

    const artifacts = await query<{ automation_id: string; sequence_number: number; data: any }>(
      "SELECT automation_id, sequence_number, data FROM application_ai_artifacts WHERE workflow_id = $1 ORDER BY sequence_number ASC",
      [run.workflowId]
    );
    for (const art of artifacts) {
      console.log(`\n   [Stage: ${art.automation_id}]`);
      const out: string[] = [];
      const d = art.data ?? {};
      if (Array.isArray((d as any).experience)) diffExperience(baseExperience, (d as any).experience, out);
      if (Array.isArray((d as any).education)) diffEducation(baseEducation, (d as any).education, out);
      diffPersonalInfo(baseContent, (d as any).personalInfo ?? (d as any).header, out);
      console.log(out.length === 0 ? "      clean - no identity drift in this stage's raw output" : out.join("\n"));
    }

    const appRow = await queryOne<{ tailored_resume_version_id: string | null }>(
      "SELECT tailored_resume_version_id FROM applications WHERE id = $1",
      [run.applicationId]
    );
    if (appRow?.tailored_resume_version_id) {
      const finalRow = await queryOne<{ content: any }>(
        "SELECT content FROM application_resume_versions WHERE id = $1",
        [appRow.tailored_resume_version_id]
      );
      console.log(`\n   [FINAL PERSISTED resume ${appRow.tailored_resume_version_id}]`);
      const out: string[] = [];
      const doc = finalRow?.content ?? {};
      diffExperience(baseExperience, (doc as any).experience, out);
      diffEducation(baseEducation, (doc as any).education, out);
      diffPersonalInfo(baseContent, (doc as any).header ?? (doc as any).personalInfo, out);
      console.log(out.length === 0 ? "      FINAL DOCUMENT MATCHES BASE RESUME on all checked fields." : out.join("\n"));
    } else {
      console.log("\n   (no final resume version persisted - workflow did not complete)");
    }
  }
  console.log("\n================ END REPORT ================");
}

main().catch((err) => { console.error("Test runner failed:", err); process.exit(1); });
