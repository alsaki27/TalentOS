// Acts on the Mir Najiur Rahman bulk-cluster of applications identified in
// the prior audit (54 applications created in one bulk action on
// 2026-08-30 11:39:58 by "Md Ferdous Hasan Akash", all moved to
// in_ai_pipeline via source='queue').
//
// Live re-check (2026-09-03) found the premise had moved on: every one of
// the 54 has already progressed past in_ai_pipeline to application_stage =
// 'applied' via the normal AI pipeline - so no stage change is applied here
// (see report). This script only does the two actions that are still real:
// (1) backup-snapshot all 54 into activity_logs, (2) trigger a first AI
// workflow for the applications that never got one, following the exact
// resume-resolution logic in triggerAiWorkflowForApplication() (copied here
// because importing applicationAiWorkflowService.ts directly crashes plain
// tsx - it transitively pulls in @opennextjs/cloudflare via waitUntil.ts;
// see scratch/istiaque_test_output.log from an earlier session for the
// original crash, and scratch/regenerate_istiaque_pipeline_test.ts for the
// precedent of hand-replicating this exact logic instead of importing it).
//
// Run with: npx tsx --env-file=.env.local scratch/execute_44_bulk_actions.ts

import { query, queryOne, execute } from "../src/server/db/neon";
import { createWorkflow, findActiveWorkflowByApplicationId } from "../src/server/repositories/applicationAiWorkflowRepository";
import { upsertTargetJobByCandidateAndJob } from "../src/server/repositories/targetJobsRepository";
import { selectBestBaseResume } from "../src/lib/ai/selectBestBaseResume";

const CANDIDATE_ID = "04dbd347-055e-4621-a68a-44fc690b8f5f";
const BASE_URL = "https://talent.skarion.com";
const CRON_SECRET = process.env.CRON_SECRET;

function resolveJobDescription(job: any): string {
  if (job?.description_text) return job.description_text;
  if (job?.notes) return job.notes;
  if (job?.raw_source_payload?.description) return String(job.raw_source_payload.description);
  if (job?.description_html) return String(job.description_html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return "No description available";
}

function jobDescriptionForTargetJob(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text ? job.description_text : null,
    job.notes ? `Internal notes: ${job.notes}` : null,
  ].filter(Boolean).join("\n\n");
}

async function materializeFromBaseResume(
  candidateId: string,
  jobId: string,
  applicationId: string,
  job: any,
  createdBy: string | undefined,
  preferredBaseResumeId?: string,
): Promise<any | null> {
  let baseResumeRow: { id: string; content: unknown } | null = null;
  if (preferredBaseResumeId) {
    baseResumeRow = await queryOne<{ id: string; content: unknown }>(
      "SELECT id, content FROM base_resumes WHERE id = $1 AND candidate_id = $2",
      [preferredBaseResumeId, candidateId]
    );
  }
  if (!baseResumeRow) {
    baseResumeRow = await queryOne<{ id: string; content: unknown }>(
      "SELECT id, content FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 1",
      [candidateId]
    );
  }
  if (!baseResumeRow) return null;

  const targetJob = await upsertTargetJobByCandidateAndJob(candidateId, jobId, {
    raw_description: jobDescriptionForTargetJob(job),
    created_by: createdBy,
  });
  if (!targetJob) return null;

  const version = await queryOne<any>(
    `INSERT INTO application_resume_versions
       (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id)
     VALUES ($1, $2, $3, $4::jsonb, 'active', 'base_resume', $5, $2)
     RETURNING *`,
    [candidateId, baseResumeRow.id, targetJob.id, JSON.stringify(baseResumeRow.content ?? {}), createdBy ?? null]
  );
  if (!version) return null;

  await execute(
    `INSERT INTO application_packets (application_id, resume_version_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (application_id) DO UPDATE SET resume_version_id = EXCLUDED.resume_version_id, updated_at = NOW()`,
    [applicationId, version.id]
  );

  return version;
}

async function triggerFirstWorkflow(applicationId: string, jobId: string, job: any, startedBy: string): Promise<{ started: boolean; reason?: string; workflowId?: string }> {
  const existing = await findActiveWorkflowByApplicationId(applicationId);
  if (existing) return { started: false, reason: "An active workflow already exists for this application" };

  let matchScore: number | null = null;
  let matchReason: string | null = null;
  const best = await selectBestBaseResume(CANDIDATE_ID, { title: job.title, job_category: job.job_category, description_text: job.description_text, company: job.company, location: job.location });
  let resumeRow: any = null;
  if (best) {
    matchScore = best.score;
    matchReason = best.reason;
    resumeRow = await materializeFromBaseResume(CANDIDATE_ID, jobId, applicationId, job, startedBy, best.resume.id);
  } else {
    resumeRow = await materializeFromBaseResume(CANDIDATE_ID, jobId, applicationId, job, startedBy);
  }
  if (!resumeRow) return { started: false, reason: "No base resume found for this candidate" };

  await upsertTargetJobByCandidateAndJob(CANDIDATE_ID, jobId, {
    raw_description: jobDescriptionForTargetJob(job),
    created_by: startedBy,
  });

  const evidence = await query<any>("SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50", [CANDIDATE_ID]);
  const candidateRow = await queryOne<{ verified_skills: string[] | null }>("SELECT verified_skills FROM candidates WHERE id = $1", [CANDIDATE_ID]);
  const sotRow = await queryOne<{ confirmed_skills: string[] | null; notes: string | null }>(
    "SELECT confirmed_skills, notes FROM candidate_source_of_truth WHERE candidate_id = $1", [CANDIDATE_ID]
  );
  const sourceOfTruth = sotRow ? { confirmedSkills: sotRow.confirmed_skills ?? [], notesContext: sotRow.notes ?? null } : null;

  const configSnapshot = {
    candidateId: CANDIDATE_ID,
    job,
    baseResume: resumeRow,
    evidence: evidence ?? [],
    verifiedSkills: candidateRow?.verified_skills ?? [],
    sourceOfTruth,
  };

  const wf = await createWorkflow({
    applicationId,
    baseResumeId: resumeRow?.base_resume_id ?? null,
    configSnapshot,
    startedBy,
    matchScore: matchScore ?? undefined,
    matchReason: matchReason ?? undefined,
  });

  await execute("UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1", [applicationId]);

  return { started: true, workflowId: wf.id };
}

async function pokeDispatch(): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/application-ai-workflows/dispatch`, {
      method: "GET",
      headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
    });
    const body = await res.text();
    console.log(`  [dispatch poke] HTTP ${res.status} body=${body.slice(0, 200)}`);
  } catch (err) {
    console.error("  [dispatch poke] failed:", err);
  }
}

async function main() {
  const latest: any[] = await query(`
    WITH ranked AS (
      SELECT h.*, ROW_NUMBER() OVER (PARTITION BY h.application_id ORDER BY h.changed_at DESC) as rn
      FROM application_stage_history h
      JOIN applications a ON a.id = h.application_id
      WHERE a.candidate_id = $1
    )
    SELECT application_id, changed_at, changed_by_name
    FROM ranked WHERE rn = 1 AND source = 'queue' AND to_stage = 'in_ai_pipeline'
      AND changed_by_name = 'Md Ferdous Hasan Akash'
  `, [CANDIDATE_ID]);
  const appIds: string[] = latest.map((r) => r.application_id);
  console.log(`Cluster size: ${appIds.length}`);

  const apps: any[] = await query(`
    SELECT a.id, a.created_at, a.application_stage, a.resume_generation_status, a.tailored_resume_version_id,
      a.ai_workflow_id, a.job_id, a.candidate_id,
      j.id as jid, j.title, j.company, j.location, j.job_category, j.description_text, j.notes, j.description_html, j.raw_source_payload
    FROM applications a JOIN jobs j ON j.id = a.job_id
    WHERE a.id = ANY($1::uuid[])
  `, [appIds]);
  console.log(`Fetched full rows for ${apps.length} applications`);

  // ---- Step 1: backup snapshot into activity_logs ----
  console.log("\n=== Step 1: backup snapshot into activity_logs ===");
  let backedUp = 0;
  const skipBackup = process.env.SKIP_BACKUP === "1";
  if (skipBackup) console.log("SKIP_BACKUP=1 set - already backed up in a prior run, skipping to avoid duplicate rows.");
  for (const a of skipBackup ? [] : apps) {
    await execute(
      `INSERT INTO activity_logs (user_id, actor_name, actor_type, type, description, entity_type, entity_id, entity_name, metadata)
       VALUES (NULL, 'TalentOS Ops (Claude)', 'system', 'application_backup_snapshot', $1, 'application', $2, $3, $4::jsonb)`,
      [
        `Backup snapshot of bulk-cluster application (Mir Najiur Rahman) before AI-review follow-up action`,
        a.id,
        a.title ? `${a.title}${a.company ? " @ " + a.company : ""}` : null,
        JSON.stringify({
          candidate_id: a.candidate_id,
          job_id: a.job_id,
          job_title: a.title,
          job_company: a.company,
          application_stage_at_snapshot: a.application_stage,
          resume_generation_status_at_snapshot: a.resume_generation_status,
          tailored_resume_version_id_at_snapshot: a.tailored_resume_version_id,
          ai_workflow_id_at_snapshot: a.ai_workflow_id,
          application_created_at: a.created_at,
          bulk_action_source: { changed_by_name: "Md Ferdous Hasan Akash", to_stage: "in_ai_pipeline", approx_changed_at: "2026-08-30T05:39:58.933Z" },
          snapshot_reason: "User-requested backup of the 2026-08-30 bulk-logged Mir Najiur Rahman AE Draftsman applications, per instruction to retain this info for later use",
          snapshot_taken_at: new Date().toISOString(),
        }),
      ]
    );
    backedUp++;
  }
  console.log(`Backed up ${backedUp} applications into activity_logs (type='application_backup_snapshot')`);

  // ---- Step 2: stage check (report-only, no write) ----
  const stageCounts: Record<string, number> = {};
  for (const a of apps) stageCounts[a.application_stage] = (stageCounts[a.application_stage] || 0) + 1;
  console.log("\n=== Step 2: current stage distribution (no changes made) ===", stageCounts);

  // ---- Step 3: trigger first AI workflow for apps that never had one ----
  console.log("\n=== Step 3: resume generation for apps with no workflow ===");
  const noWorkflow = apps.filter((a) => !a.ai_workflow_id);
  console.log(`${noWorkflow.length} applications have never had an AI workflow`);

  const eligible: any[] = [];
  const blocked: any[] = [];
  for (const a of noWorkflow) {
    const desc = resolveJobDescription(a);
    const usable = desc && desc !== "No description available" && desc.trim().length > 40 && !/^Imported from OSP Job Tracker master sheet/i.test(desc.trim());
    if (usable) eligible.push(a);
    else blocked.push({ ...a, resolvedDesc: desc });
  }
  console.log(`Eligible for triggering (real, resolvable job description): ${eligible.length}`);
  console.log(`Blocked (no usable job description - would fail or produce a low-quality tailoring): ${blocked.length}`);
  for (const b of blocked) console.log(`  BLOCKED: ${b.title} (job ${b.jid}) - resolved description: "${(b.resolvedDesc || "").slice(0, 80)}"`);

  const started: { title: string; workflowId: string }[] = [];
  const failed: { title: string; reason: string }[] = [];
  for (const a of eligible) {
    try {
      // created_by/started_by columns are uuid - there's no real staff user
      // behind this bulk follow-up, so pass undefined (-> NULL), matching
      // how every other nullable actor column in this codebase is left
      // unset for system-initiated actions rather than stuffing free text
      // into a uuid column.
      const result = await triggerFirstWorkflow(a.id, a.job_id, a, undefined as unknown as string);
      if (result.started) {
        console.log(`  STARTED: ${a.title} -> workflow ${result.workflowId}`);
        started.push({ title: a.title, workflowId: result.workflowId! });
      } else {
        console.log(`  SKIPPED: ${a.title} -> ${result.reason}`);
        failed.push({ title: a.title, reason: result.reason ?? "unknown" });
      }
    } catch (err: any) {
      console.error(`  ERROR: ${a.title} ->`, err.message ?? err);
      failed.push({ title: a.title, reason: err.message ?? String(err) });
    }
  }

  console.log(`\n${started.length} workflow(s) queued, ${failed.length} failed/skipped.`);
  if (started.length > 0) {
    console.log("\nKicking off dispatch...");
    await pokeDispatch();
    await new Promise((r) => setTimeout(r, 2000));
    await pokeDispatch();
  }

  console.log("\n=== FINAL SUMMARY ===");
  console.log(`Cluster size: ${apps.length}`);
  console.log(`Backed up: ${backedUp}`);
  console.log(`Stage distribution: ${JSON.stringify(stageCounts)}`);
  console.log(`No-workflow apps found: ${noWorkflow.length}`);
  console.log(`Newly triggered: ${started.length}`);
  console.log(`Blocked (no usable description): ${blocked.length}`);
  console.log(`Failed to trigger: ${failed.length}`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
}

main().then(() => process.exit(0)).catch((err) => { console.error("FATAL:", err); process.exit(1); });
