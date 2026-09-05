// Orchestrates the multi-agent application pipeline.
// Each stage runs in a single invocation, then the dispatcher picks up the next.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking, type CallContext } from "@/lib/ai/routing";
import { APPLICATION_AGENT_IDS, type ApplicationAgentId, type AgentContext, type ArtifactRecord } from "@/lib/ai/application-agents/types";
import { SCHEMA_VERSIONS, AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { getSourceOfTruth } from "@/server/services/sourceOfTruthService";
import type { SourceOfTruthData } from "@/lib/ai/application-agents/types";
import { runJobLens } from "@/lib/ai/application-agents/jobLens";
import { runResumeForge } from "@/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "@/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "@/lib/ai/application-agents/finalPolish";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import type { AgentOptions } from "@/lib/ai/application-agents/types";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { getAiRuntimeConfig } from "@/server/repositories/aiRuntimeConfigRepository";
import {
  createWorkflow,
  findWorkflowById,
  findActiveWorkflowByApplicationId,
  updateWorkflowStatus,
  createStageRun,
  createArtifact,
  listStageRuns,
  listArtifacts,
  claimNextPendingWorkflow,
  claimWorkflowById,
  markOrphanedStageRuns,
  updateWorkflowHeartbeat,
  updateStageRunForClaim,
  type ArtifactRow,
  type WorkflowRow,
} from "@/server/repositories/applicationAiWorkflowRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { selectBestBaseResume } from "@/lib/ai/selectBestBaseResume";
import { query, queryOne, execute } from "@/server/db/neon";
import { backgroundDispatch } from "@/server/lib/waitUntil";

function sha256(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mapArtifacts(rows: ArtifactRow[]): ArtifactRecord[] {
  return rows.map((a) => ({
    id: a.id,
    automationId: a.automation_id,
    sequenceNumber: a.sequence_number,
    schemaVersion: a.schema_version,
    contentHash: a.content_hash,
    data: a.data,
    createdAt: a.created_at,
  }));
}

export interface DispatchResult {
  dispatched: boolean;
  workflowId: string | null;
  stage: number | null;
  count: number;
  message?: string;
}

/** Persist the full workflow input as an immutable snapshot. */
export async function startWorkflow(input: {
  applicationId: string;
  candidateId: string;
  job: any;
  baseResume: any;
  evidence: any[];
  verifiedSkills?: string[];
  sourceOfTruth?: SourceOfTruthData | null;
  idempotencyKey?: string;
  startedBy?: string;
  matchScore?: number;
  matchReason?: string;
}): Promise<{ workflowId: string }> {
  const runtime = await getAiRuntimeConfig();
  const routingStateId = runtime.active_routing_state_id ?? null;
  const routeSnapshot = routingStateId
    ? await query(
        `SELECT automation_id, rank, ai_key_id, provider, model_override, reasoning_effort
         FROM ai_routing_state_routes
         WHERE state_id = $1 AND is_enabled = true
         ORDER BY automation_id, rank`,
        [routingStateId],
      )
    : [];

  // Config snapshot bundles all inputs needed by agents
  const configSnapshot = {
    candidateId: input.candidateId,
    job: input.job,
    baseResume: input.baseResume,
    evidence: input.evidence,
    verifiedSkills: input.verifiedSkills ?? [],
    sourceOfTruth: input.sourceOfTruth ?? null,
    routingStateId,
    routeSnapshot,
  };

  const wf = await createWorkflow({
    applicationId: input.applicationId,
    baseResumeId: input.baseResume?.base_resume_id ?? null,
    idempotencyKey: input.idempotencyKey,
    configSnapshot,
    startedBy: input.startedBy,
    matchScore: input.matchScore,
    matchReason: input.matchReason,
    routingStateId,
    routeSnapshot,
  });
  return { workflowId: wf.id };
}

function jobDescriptionForTargetJob(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text ? job.description_text : null,
    job.notes ? `Internal notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A ticket created with "Resume Source: Base Resume" only materializes an
 * application_resume_versions row if the user separately clicks "Build with
 * Falood AI" right after creation (POST /api/quick-application/falood-setup).
 * Skip that and Generate 400s with "No base resume found" even though the
 * candidate has one. Replicates falood-setup's copy-from-base-resume step so
 * Generate works directly off a candidate's base resume, matching what the
 * ticket-creation UI already implied by letting you pick one as the source.
 */
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

  const version = await queryOne(
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

export type TriggerWorkflowResult =
  | { started: true; workflowId: string }
  | { started: false; reason: string };

/**
 * Resolves the candidate's base resume for this application's job, starts a
 * workflow, and dispatches the first stage. Shared by the manual "Generate"
 * endpoint (POST /api/applications/[id]/ai-workflow) and automatic
 * triggering on ticket creation - both need the exact same base-resume
 * resolution (target_job match -> most recent version -> materialize from
 * base_resumes) so a candidate with a base resume never needs a second
 * manual step to get a first tailored draft.
 */
export async function triggerAiWorkflowForApplication(
  applicationId: string,
  startedBy?: string,
  preferredBaseResumeId?: string,
): Promise<TriggerWorkflowResult> {
  const existing = await findActiveWorkflowByApplicationId(applicationId);
  if (existing) {
    return { started: false, reason: "An active workflow already exists for this application" };
  }

  const appRow = await queryOne<{ candidate_id: string; job_id: string | null }>(
    "SELECT candidate_id, job_id FROM applications WHERE id = $1",
    [applicationId]
  );
  if (!appRow) {
    return { started: false, reason: "Application not found" };
  }
  if (!appRow.job_id) {
    return { started: false, reason: "No job attached to this application" };
  }

  const jobRow = await queryOne<any>("SELECT * FROM jobs WHERE id = $1", [appRow.job_id]);
  const job: any = jobRow ?? {};

  // Prioritise the resume linked to the target_job for this application's
  // job, falling back to domain-matched base resume, then the candidate's
  // most recent base resume overall.
  let resumeRow = await queryOne<any>(
    `SELECT arv.* FROM application_resume_versions arv
     WHERE arv.target_job_id IN (
       SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2
     )
     AND arv.source_type = 'base_resume' AND arv.status = 'active'
     ORDER BY arv.created_at DESC LIMIT 1`,
    [appRow.candidate_id, appRow.job_id]
  );
  let matchScore: number | null = null;
  let matchReason: string | null = null;
  if (!resumeRow) {
    if (preferredBaseResumeId) {
      // User explicitly chose a base resume — honour that choice instead
      // of running the automatic best-match selection.
      matchReason = "User-selected base resume";
      resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy, preferredBaseResumeId);
    } else {
      // Domain-matched base resume selection — score each active base_resume
      // by industry/role overlap with the job, pick the best one, materialize
      // from it (not from the most recent), and persist the score + reason so
      // the status page can show why this resume was chosen.
      const best = await selectBestBaseResume(appRow.candidate_id, { title: job.title, job_category: job.job_category, description_text: job.description_text, company: job.company, location: job.location });
      if (best) {
        matchScore = best.score;
        matchReason = best.reason;
        resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy, best.resume.id);
      } else {
        resumeRow = await queryOne<any>(
          "SELECT * FROM application_resume_versions WHERE candidate_id = $1 AND source_type = 'base_resume' ORDER BY created_at DESC LIMIT 1",
          [appRow.candidate_id]
        );
      }
    }
  }
  if (!resumeRow) {
    resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy);
  }
  if (!resumeRow) {
    return { started: false, reason: "No base resume found for this candidate yet" };
  }

  // The fallback resume-resolution path above (any prior base_resume
  // version for this candidate, regardless of job) can return a version
  // whose target_job_id points at a DIFFERENT job than this application's -
  // e.g. a candidate applying to a 2nd, 3rd, 5th job reuses their existing
  // base resume version rather than re-materializing one. Confirmed live:
  // finalizeWorkflow() looks up target_jobs by (candidate_id, THIS job_id)
  // and throws "No target_job found" when that row doesn't exist yet - so
  // a candidate's 2nd+ application could run all 4 AI stages successfully
  // and then fail at the very last step, after the AI cost was already
  // spent. Upserting here (idempotent - materializeFromBaseResume may have
  // already created this exact row) guarantees it exists before the
  // pipeline ever starts, regardless of which resume-resolution path fired.
  await upsertTargetJobByCandidateAndJob(appRow.candidate_id, appRow.job_id, {
    raw_description: jobDescriptionForTargetJob(job),
    created_by: startedBy,
  });

  const evidence = await query(
    "SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
    [appRow.candidate_id]
  );
  const candidateRow = await queryOne<{ verified_skills: string[] | null }>(
    "SELECT verified_skills FROM candidates WHERE id = $1",
    [appRow.candidate_id]
  );

  // Fetch SoT and notes LIVE so the pipeline always uses current recruiter decisions.
  const sot = await getSourceOfTruth(appRow.candidate_id);
  const sourceOfTruth: SourceOfTruthData | null = sot
    ? {
        confirmedSkills: sot.confirmedSkills,
        notesContext: sot.notes ?? null,
      }
    : null;

  const { workflowId } = await startWorkflow({
    applicationId,
    candidateId: appRow.candidate_id,
    job,
    baseResume: resumeRow,
    evidence: evidence ?? [],
    verifiedSkills: candidateRow?.verified_skills ?? [],
    sourceOfTruth,
    startedBy,
    matchScore: matchScore ?? undefined,
    matchReason: matchReason ?? undefined,
  });

  await dispatchWorkflowStart(workflowId);
  return { started: true, workflowId };
}

/**
 * Kicks the freshly-created 'queued' workflow immediately via a self-fetch to
 * the dispatch endpoint, instead of leaving it for the periodic cron
 * dispatcher to eventually pick up. Also guarantees a fresh Cloudflare
 * invocation with a reset 50-subrequest limit. Shared by every code path that
 * creates a new workflow (trigger and regenerate).
 */
async function dispatchWorkflowStart(workflowId: string): Promise<void> {
  const baseUrl = process.env.TALENTOS_BASE_URL || 'https://talent.skarion.com';
  console.log(`[Dispatch Chain] Workflow ${workflowId} created with status ${'queued'}, stage 0. Triggering background dispatch to ${baseUrl}/api/application-ai-workflows/dispatch`);
  await backgroundDispatch(
    fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
      method: 'POST'
    }).then((res) => {
      console.log(`[Dispatch Chain] Workflow ${workflowId} dispatch self-fetch returned status ${res.status}`);
      return res.text().then((body) => {
        console.log(`[Dispatch Chain] Workflow ${workflowId} dispatch self-fetch body: ${body.slice(0, 500)}`);
      });
    }).catch((err) => {
      console.error(`[Workflow ${workflowId}] Initial dispatch fetch failed:`, err);
    })
  );
  console.log(`[Dispatch Chain] Workflow ${workflowId} backgroundDispatch registration complete. Returning from trigger.`);
}

/**
 * Restarts the full pipeline for an application that already has a tailored
 * resume, from stage 1 (JobLens) through Final Polish, exactly like a first
 * generation - not a continuation of the existing one.
 *
 * Unlike triggerAiWorkflowForApplication, this does not reuse the candidate's
 * existing active application_resume_versions row as the pipeline's starting
 * "base resume": that row is already-tailored output from a prior run, so
 * feeding it back in would tailor an already-tailored draft instead of
 * running the full process fresh. Instead this re-materializes a clean copy
 * directly from the same base_resumes row the previous run used (base_resumes
 * content may have changed since then, e.g. a manager edit), then starts a
 * new workflow the same way Generate does.
 */
export async function regenerateAiWorkflowForApplication(
  applicationId: string,
  startedBy?: string,
  preferredBaseResumeId?: string,
): Promise<TriggerWorkflowResult> {
  const existing = await findActiveWorkflowByApplicationId(applicationId);
  if (existing) {
    return { started: false, reason: "An active workflow already exists for this application" };
  }

  const appRow = await queryOne<{ candidate_id: string; job_id: string | null }>(
    "SELECT candidate_id, job_id FROM applications WHERE id = $1",
    [applicationId]
  );
  if (!appRow) {
    return { started: false, reason: "Application not found" };
  }
  if (!appRow.job_id) {
    return { started: false, reason: "No job attached to this application" };
  }

  const jobRow = await queryOne<any>("SELECT * FROM jobs WHERE id = $1", [appRow.job_id]);
  const job: any = jobRow ?? {};

  // Prioritise the resume linked to the target_job for this application's
  // job (e.g. user manually assigned one), falling back to domain-matched base resume.
  let targetResumeRow = await queryOne<any>(
    `SELECT arv.* FROM application_resume_versions arv
     WHERE arv.target_job_id IN (
       SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2
     )
     AND arv.source_type = 'base_resume' AND arv.status = 'active'
     ORDER BY arv.created_at DESC LIMIT 1`,
    [appRow.candidate_id, appRow.job_id]
  );

  let matchScore: number | null = null;
  let matchReason: string | null = null;
  let resumeRow: any = null;

  if (preferredBaseResumeId) {
    matchReason = "User-selected base resume";
    resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy, preferredBaseResumeId);
  } else if (targetResumeRow?.base_resume_id) {
    // If the target job already has a linked base resume, re-materialize from THAT base_resume_id
    // to pick up any edits made to the base_resumes table since the last run.
    resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy, targetResumeRow.base_resume_id);
  } else {
    // Domain-matched base resume selection
    const best = await selectBestBaseResume(appRow.candidate_id, { title: job.title, job_category: job.job_category, description_text: job.description_text, company: job.company, location: job.location });
    if (best) {
      matchScore = best.score;
      matchReason = best.reason;
      resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy, best.resume.id);
    } else {
      resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy);
    }
  }

  if (!resumeRow) {
    return { started: false, reason: "No base resume found for this candidate yet" };
  }

  const evidence = await query(
    "SELECT * FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
    [appRow.candidate_id]
  );
  const candidateRow = await queryOne<{ verified_skills: string[] | null }>(
    "SELECT verified_skills FROM candidates WHERE id = $1",
    [appRow.candidate_id]
  );

  const sot = await getSourceOfTruth(appRow.candidate_id);
  const sourceOfTruth: SourceOfTruthData | null = sot
    ? {
        confirmedSkills: sot.confirmedSkills,
        notesContext: sot.notes ?? null,
      }
    : null;

  const { workflowId } = await startWorkflow({
    applicationId,
    candidateId: appRow.candidate_id,
    job,
    baseResume: resumeRow,
    evidence: evidence ?? [],
    verifiedSkills: candidateRow?.verified_skills ?? [],
    sourceOfTruth,
    startedBy,
  });

  // Mirrors the "reject and restart" review action's own convention: reset
  // the application's displayed generation status immediately so the queue
  // page reflects the new run in progress instead of continuing to show the
  // previous "Generated" result until this workflow eventually finishes.
  await execute(
    "UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1",
    [applicationId]
  );

  await dispatchWorkflowStart(workflowId);
  return { started: true, workflowId };
}

/**
 * Build agent context from the immutable workflow snapshot + previous
 * artifacts. baseResume.content is re-read live from base_resumes on every
 * call (falling back to the snapshot if the row is gone) so a mid-workflow
 * edit to the candidate's base resume is picked up by every remaining stage -
 * not just at finalization, which already does this same live-preferred/
 * snapshot-fallback read (see finalizeWorkflow). Previously only the trigger
 * and finalization saw the current base resume; stages 2-4 always saw
 * whatever was current at the instant the workflow started, even if the base
 * resume was edited seconds later while those stages were still running.
 */
async function buildAgentContext(wf: WorkflowRow, previousArtifacts: ArtifactRow[]): Promise<AgentContext> {
  const snapshot = (wf.config_snapshot ?? {}) as any;
  const mapped = mapArtifacts(previousArtifacts);
  const outputsMap: Record<string, ArtifactRecord> = {};
  for (const a of mapped) outputsMap[a.automationId] = a;

  let baseResume = snapshot.baseResume ?? {};
  if (wf.base_resume_id) {
    const freshBase = await queryOne<{ content: unknown }>(
      "SELECT content FROM base_resumes WHERE id = $1",
      [wf.base_resume_id]
    );
    if (freshBase?.content) {
      baseResume = { ...baseResume, content: freshBase.content };
    }
  }

  return {
    applicationId: wf.application_id,
    candidateId: snapshot.candidateId ?? "",
    job: snapshot.job ?? {},
    baseResume,
    evidence: snapshot.evidence ?? [],
    verifiedSkills: snapshot.verifiedSkills ?? [],
    sourceOfTruth: snapshot.sourceOfTruth ?? null,
    previousOutputs: outputsMap,
  };
}

/**
 * Sync workflow status to the application's resume_generation_status column.
 * Ensures every workflow status transition is reflected on the application record.
 *
 * Status mapping:
 *   queued → 'queued'
 *   running → stage-dependent ('job_analysis','resume_drafting','resume_review','finalizing')
 *   waiting → 'human_review'
 *   failed  → 'failed'
 *   cancelled → 'cancelled'
 *   completed → 'ready'
 */
async function syncWorkflowToApplication(
  workflowId: string,
  status: string,
  currentStage?: number,
  error?: string,
): Promise<void> {
  let genStatus: string;
  switch (status) {
    case "queued":   genStatus = "queued"; break;
    case "waiting":  genStatus = "human_review"; break;
    case "failed":   genStatus = "failed"; break;
    case "cancelled": genStatus = "cancelled"; break;
    case "completed": genStatus = "ready"; break;
    case "running": {
      switch (currentStage ?? 0) {
        case 0: genStatus = "job_analysis"; break;
        case 1: genStatus = "resume_drafting"; break;
        case 2: genStatus = "resume_review"; break;
        default: genStatus = "finalizing"; break;
      }
      break;
    }
    default: return;
  }

  const wf = await findWorkflowById(workflowId);
  if (!wf) return;

  await query(
    `UPDATE applications SET resume_generation_status = $1${error ? ", resume_generation_error = $3" : ""} WHERE id = $2`,
    error ? [genStatus, wf.application_id, error] : [genStatus, wf.application_id],
  );
}

/**
 * Process exactly one stage for a workflow.
 * - Transitions from 'queued' → 'running' automatically.
 * - After successful stage, re-queues for the next stage.
 * - Retries on failure up to configured max_attempts.
 * - On final failure, marks workflow as failed.
 * - Implements runtime provider fallback through the routing layer.
 * - Does NOT recurse — the dispatcher picks up the next stage.
 * - Checks for cancellation before and after the provider call.
 */
export async function processWorkflowStage(workflowId: string, _routeAttempt: number = 1): Promise<void> {
  let wf = await findWorkflowById(workflowId);
  if (!wf) {
    console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} not found.`);
    return;
  }

  console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} status=${wf.status}, stage=${wf.current_stage}`);

  if (wf.status === "queued") {
    // Every entry point must pass through the same atomic claim path. This
    // prevents manual retries from bypassing concurrency and backoff checks.
    const claimed = await claimWorkflowById(workflowId);
    if (!claimed) return;
    wf = claimed;
  }

  if (wf.status !== "running" || wf.claimed_by !== "dispatcher") {
    console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} skipped (status is ${wf.status}, not queued/running).`);
    return;
  }

  const claimVersion = wf.lock_version;
  await updateWorkflowStatus(workflowId, "running", {
    current_stage: wf.current_stage,
    last_error: null,
    expected_lock_version: claimVersion,
    expected_claimed_by: "dispatcher",
  });
  await syncWorkflowToApplication(workflowId, "running", wf.current_stage);
  if (wf.current_stage === 0) {
    await query("UPDATE applications SET ai_workflow_id = $1, resume_generation_started_at = NOW() WHERE id = $2",
      [workflowId, wf.application_id]);
  }

  // Pin legacy workflows the first time they are claimed. New workflows are
  // already pinned by startWorkflow; this closes the retry-time state drift
  // window without changing the selected production state.
  const snapshot = (wf.config_snapshot ?? {}) as Record<string, any>;
  if (typeof snapshot.routingStateId !== "string") {
    const runtime = await getAiRuntimeConfig();
    if (runtime.active_routing_state_id) {
      snapshot.routingStateId = runtime.active_routing_state_id;
      await query(
        `UPDATE application_ai_workflows
         SET routing_state_id = $1, config_snapshot = $2::jsonb, updated_at = NOW()
         WHERE id = $3 AND lock_version = $4 AND claimed_by = 'dispatcher'`,
        [runtime.active_routing_state_id, JSON.stringify(snapshot), workflowId, claimVersion],
      );
      wf = { ...wf, config_snapshot: snapshot, routing_state_id: runtime.active_routing_state_id };
    }
  }

  const agentOrder = APPLICATION_AGENT_IDS;
  const currentIdx = wf.current_stage;

  if (currentIdx >= agentOrder.length) {
    await finalizeWorkflow(workflowId, claimVersion);
    return;
  }

  const agentId = agentOrder[currentIdx];
  const agentConfig = await findAgentConfigByAutomationId(agentId);
  const maxAttempts = agentConfig?.max_attempts ?? 2;

  if (agentConfig && agentConfig.is_active === false) {
    const stageRun = await createStageRun({
      workflowId,
      automationId: agentId,
      sequenceNumber: currentIdx + 1,
      attemptNumber: 1,
      expectedLockVersion: claimVersion,
    });
    await updateStageRunForClaim(stageRun.id, workflowId, claimVersion, {
      status: "failed",
      error_message: `Agent "${agentId}" is disabled via ai_agent_configs.is_active`,
      completed_at: new Date().toISOString(),
    });
    await updateWorkflowStatus(workflowId, "failed", {
      last_error: `Agent "${agentId}" is disabled`,
      expected_lock_version: claimVersion,
      expected_claimed_by: "dispatcher",
    });
    return;
  }

  // ai_agent_configs.temperature is a Postgres `numeric` column - the driver
  // returns it as a string (e.g. "0.20"), not a JS number. Providers like
  // OpenAI reject a string temperature outright ("Invalid type for
  // 'temperature': expected a decimal, but got a string instead").
  const rawTemperature = agentConfig?.temperature;
  const parsedTemperature =
    rawTemperature == null ? undefined : Number(rawTemperature);

  // Falls back to this agent's own default ceiling (not a flat constant) when
  // the ai_agent_configs row is missing/null for max_output_tokens - a missing
  // seed row for Resume Forge/Final Polish (full-resume JSON output) must not
  // silently drop to Job Lens/Hiring Panel's (analysis-only JSON) lower ceiling
  // or vice versa.
  const agentOptions: AgentOptions = {
    system_prompt: agentConfig?.system_prompt ?? undefined,
    temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : undefined,
    max_output_tokens: agentConfig?.max_output_tokens ?? AGENT_CONFIG_DEFAULTS[agentId]?.maxOutputTokens,
    timeout_ms: agentConfig?.timeout_ms ?? AGENT_CONFIG_DEFAULTS[agentId]?.timeoutMs,
  };

  const previousRuns = await listStageRuns(workflowId);
  const previousArtifacts = await listArtifacts(workflowId);
  const attemptNumber = previousRuns.filter(
    (r) => r.automation_id === agentId && r.sequence_number === currentIdx + 1
  ).length + 1;

  const stageRun = await createStageRun({
    workflowId,
    automationId: agentId,
    sequenceNumber: currentIdx + 1,
    attemptNumber,
    expectedLockVersion: claimVersion,
  });

  const updateCurrentStage = (updates: Partial<import("@/server/repositories/applicationAiWorkflowRepository").StageRunRow>) =>
    updateStageRunForClaim(stageRun.id, workflowId, claimVersion, updates);

  try {
    await updateCurrentStage({ status: "running", started_at: new Date().toISOString() });
    await updateWorkflowHeartbeat(workflowId, claimVersion);

    // Check for cancellation before invoking the provider
    const currentWf = await findWorkflowById(workflowId);
    if (currentWf?.status === "cancelled") {
      await updateCurrentStage({ status: "cancelled" });
      await updateWorkflowStatus(workflowId, "cancelled", {
        expected_lock_version: claimVersion,
        expected_claimed_by: "dispatcher",
      });
      await syncWorkflowToApplication(workflowId, "cancelled");
      return;
    }

    const ctx = await buildAgentContext(wf, previousArtifacts);
    const startMs = Date.now();

    // Persist the exact immutable context/options handed to this agent before
    // calling any provider.  The output artifact is written below and the
    // stage run links both sides, making replay/evaluation auditable even when
    // the provider fails or a later stage changes the live base resume.
    const inputPayload = {
      kind: "agent_input",
      automationId: agentId,
      sequenceNumber: currentIdx + 1,
      attemptNumber,
      agentOptions,
      context: ctx,
    };
    const inputArtifact = await createArtifact({
      workflowId,
      automationId: `${agentId}:input`,
      sequenceNumber: currentIdx + 1,
      schemaVersion: `${getSchemaVersion(agentId)}InputV1`,
      contentHash: sha256(JSON.stringify(inputPayload)),
      data: inputPayload,
    });
    await updateCurrentStage({ input_artifact_id: inputArtifact.id });

    // Provider routing already owns retries and fallback selection.  A second
    // retry loop here multiplied one failed stage into as many as twelve
    // upstream requests, while the worker claim remained occupied.  Make one
    // routed call per stage attempt and let the provider adapters' abort
    // signal enforce the configured timeout.
    const callCtx: CallContext = {
      userId: wf.started_by ?? undefined,
      workflowId,
      applicationId: wf.application_id,
      attemptNumber,
      routingStateId: typeof (wf.config_snapshot as any)?.routingStateId === "string"
        ? (wf.config_snapshot as any).routingStateId
        : undefined,
      // Each application stage has one primary and one configured fallback in
      // the active state.  Bound this invocation to those two routes so a
      // slow/failed primary cannot consume the claim with unrelated retries.
      maxProviderAttempts: 2,
    };
    const timeoutMs = agentOptions.timeout_ms ?? 300_000;
    const stageTimeoutMs = timeoutMs * 2 + 5_000;
    // Keep the durable claim alive several times during a slow provider call.
    // A fixed 60s interval is too coarse for short leases and gives no useful
    // margin when a fallback is selected near the stage deadline.
    const heartbeatIntervalMs = Math.max(15_000, Math.floor(timeoutMs / 4));
    const heartbeatTimer = setInterval(() => {
        void updateWorkflowHeartbeat(workflowId, claimVersion).catch(err =>
        console.warn(`[Workflow ${workflowId}] heartbeat refresh failed`, err)
      );
    }, heartbeatIntervalMs);
    let callResult;
    try {
      // Allow the primary and one fallback provider to each reach their own
      // AbortController deadline.  A single timeout around the whole routed
      // call used to fire while the fallback was still being selected, which
      // made a healthy Vertex fallback look like a failed workflow.
      callResult = await withTimeout(
        callWithUsageTracking(
          agentId,
          callCtx,
          async (provider: AiProvider) => {
            const agentFn = getAgentFn(agentId);
            return agentFn(agentOptions, provider, ctx);
          },
        ),
        stageTimeoutMs,
        `Agent stage timed out after ${stageTimeoutMs}ms`,
      );
    } finally {
      clearInterval(heartbeatTimer);
    }

    if (!callResult?.result) {
      throw new Error("No output from agent");
    }
    const agentOutput = callResult.result;
    const resolvedProviderName = callResult.providerName;
    const resolvedKeyId = callResult.aiKeyId;
    const resolvedModel = callResult.model;

    const latencyMs = Date.now() - startMs;

    if (agentConfig?.minimum_score != null && agentOutput != null && typeof agentOutput === "object" && "score" in agentOutput) {
      const outputScore = (agentOutput as Record<string, unknown>).score;
      if (typeof outputScore === "number" && outputScore < agentConfig.minimum_score) {
        throw new Error(`Output score ${outputScore} below minimum threshold ${agentConfig.minimum_score}`);
      }
    }

    const artifact = await createArtifact({
      workflowId,
      automationId: agentId,
      sequenceNumber: currentIdx + 1,
      schemaVersion: getSchemaVersion(agentId),
      contentHash: sha256(JSON.stringify(agentOutput)),
      data: agentOutput,
    });

    await updateCurrentStage({
      status: "success",
      provider: resolvedProviderName,
      model: resolvedModel,
      ai_key_id: resolvedKeyId,
      output_artifact_id: artifact.id,
      latency_ms: latencyMs,
      completed_at: new Date().toISOString(),
    });

    // Hiring Panel = AI quality review, not a pipeline gate. Whatever it
    // finds — including a hard-fail-grade truthfulness risk or missing
    // credentials — always flows to Final Polish, which is the stage
    // responsible for actually applying those fixes (stripping unsupported
    // claims, trimming for length) and producing an export-ready resume.
    // Never stop the pipeline here; only Final Polish's own exportReady
    // flag (checked in finalizeWorkflow) can leave a workflow unfinished.
    if (agentId === "application_hiring_panel") {
      await syncWorkflowToApplication(workflowId, "running", currentIdx + 1);
    }

    // Final polish complete → finalize
    if (agentId === "application_final_polish") {
      // Check for cancellation before finalizing
      const currentWf2 = await findWorkflowById(workflowId);
      if (currentWf2?.status === "cancelled") {
        await updateCurrentStage({ status: "cancelled" });
        await updateWorkflowStatus(workflowId, "cancelled", {
          expected_lock_version: claimVersion,
          expected_claimed_by: "dispatcher",
        });
        await syncWorkflowToApplication(workflowId, "cancelled");
        return;
      }
      await finalizeWorkflow(workflowId, claimVersion);
      return;
    }

    // Advance to next stage and re-queue. This is the only continuation path;
    // the scheduler will claim the next stage after this transaction commits.
    await updateWorkflowStatus(workflowId, "queued", {
      current_stage: currentIdx + 1,
      next_retry_at: null,
      stage_retry_count: 0,
      expected_lock_version: claimVersion,
      expected_claimed_by: "dispatcher",
    });
    await syncWorkflowToApplication(workflowId, "queued");

    // The scheduled dispatcher is the durable continuation mechanism.  Do not
    // chain another self-fetch from inside a background invocation: that chain
    // can be evicted with the parent worker and leave the next stage claimed
    // but unprocessed.
  } catch (err: any) {
    const errorMessage = err?.message ?? "Unknown error";
    const errorCode = typeof err?.errorCode === "string"
      ? err.errorCode
      : /timeout|timed out|aborted/i.test(errorMessage)
        ? "timeout"
        : undefined;
    try {
      await updateCurrentStage({
        status: "failed",
        error_code: errorCode,
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      });
    } catch (ownershipError) {
      console.warn(`[Workflow ${workflowId}] claim lost while recording stage failure; newer worker remains authoritative`, ownershipError);
      return;
    }

    const deterministicRouteFailure = ["not_found", "configuration_error", "auth_error"].includes(errorCode ?? "");
    if (attemptNumber < maxAttempts && !deterministicRouteFailure) {
      const delayMs = errorCode === "rate_limit" ? 60_000 : errorCode === "timeout" ? 30_000 : 15_000;
      await updateWorkflowStatus(workflowId, "queued", {
        current_stage: currentIdx,
        last_error: errorMessage,
        next_retry_at: new Date(Date.now() + delayMs).toISOString(),
        stage_retry_count: (wf.stage_retry_count ?? 0) + 1,
        expected_lock_version: claimVersion,
        expected_claimed_by: "dispatcher",
      });
      await syncWorkflowToApplication(workflowId, "queued");

      // Leave the queued retry for the durable scheduled dispatcher.  This
      // avoids a fire-and-forget self-fetch racing the claim lease.
    } else {
      await updateWorkflowStatus(workflowId, "failed", {
        last_error: errorMessage,
        expected_lock_version: claimVersion,
        expected_claimed_by: "dispatcher",
      });
      await syncWorkflowToApplication(workflowId, "failed", undefined, errorMessage);
    }
  }
}

// Each stage involves ~15-20 DB round-trips (findWorkflowById, agent config
// lookup, stage_run/artifact reads and writes, heartbeat, usage recording,
// continueToNextStage's status updates, etc.) plus the AI provider call
// itself - all counted as subrequests against a single Cloudflare Workers
// invocation's limit. Confirmed live: processing 3 workflows in one
// dispatch call hit "Too many subrequests by single Worker invocation" once
// several workflows were in flight together. Dropped to 1 per invocation -
// the cron loop's ~15s polling cadence (scheduled-jobs.yml) more than makes
// up for the smaller batch, without risking a whole dispatch call dying
// mid-batch and leaving later workflows in that batch untouched.
const WORKFLOWS_PER_DISPATCH_CALL = 1;

/** Claim and process up to WORKFLOWS_PER_DISPATCH_CALL queued workflows per
 *  invocation, staying under Cloudflare's per-invocation subrequest limit.
 *  Returns dispatch result metadata with the count of workflows processed. */
export async function dispatchNextQueuedWorkflow(): Promise<DispatchResult> {
  let count = 0;
  let lastDispatched: { id: string; current_stage: number } | null = null;

  console.log(`[Dispatch Chain] dispatchNextQueuedWorkflow started (WORKFLOWS_PER_DISPATCH_CALL=${WORKFLOWS_PER_DISPATCH_CALL})`);

  for (let i = 0; i < WORKFLOWS_PER_DISPATCH_CALL; i++) {
    const wf = await claimNextPendingWorkflow();
    if (!wf) {
      console.log(`[Dispatch Chain] claimNextPendingWorkflow returned null (no queued workflows or at concurrency cap). Stopping.`);
      break;
    }
    console.log(`[Dispatch Chain] Claimed workflow ${wf.id} at stage ${wf.current_stage}, recovery_count=${wf.recovery_count}, status=${wf.status}`);
    lastDispatched = wf;
    count++;

    if (wf.recovery_count > 0) {
      await markOrphanedStageRuns(
        wf.id,
        `Stage attempt was orphaned during workflow recovery ${wf.recovery_count}; a new attempt is being evaluated.`,
      ).catch((err) => {
        // Cleanup is diagnostic; it must not prevent the recovered workflow
        // from getting a fresh stage attempt.
        console.warn(`[Dispatch] Could not close orphaned stage rows for ${wf.id}:`, err);
      });
    }

    if (wf.recovery_count >= 3 && wf.status === 'failed') {
      // Previously only synced to applications.resume_generation_error -
      // the workflow row itself (what GET .../ai-workflow and the overview
      // endpoint surface) kept last_error: null, making an exhausted-retry
      // failure look identical to "no error ever recorded." Persist it in
      // both places so it's visible wherever someone's looking.
      const message = `Workflow failed after ${wf.recovery_count} recovery attempts at stage ${wf.current_stage} - each claim orphaned without completing or erroring cleanly`;
      await updateWorkflowStatus(wf.id, "failed", { last_error: message } as any).catch(() => {});
      await syncWorkflowToApplication(wf.id, 'failed', undefined, message);
      continue;
    }

    try {
      await processWorkflowStage(wf.id);
    } catch (err: any) {
      // processWorkflowStage has its own internal try/catch around the
      // actual agent call (with retry/max_attempts handling) - an exception
      // reaching all the way out here means something crashed OUTSIDE that
      // guarded section (e.g. before the stage_run row is even created).
      // Previously this was only console.error'd: no stage_run, no
      // last_error, nothing - the workflow just sat at 'running' forever
      // with zero diagnostic trail. Confirmed live: a workflow stuck at
      // current_stage 3 (Final Polish) for 10+ minutes with last_error still
      // null and no way to tell why. Persisting the error here at least
      // makes the next stall debuggable via GET .../ai-workflow.
      const message = err?.message ?? String(err);
      console.error(`[Dispatch] Workflow ${wf.id} stage processing failed:`, err);
      await updateWorkflowStatus(wf.id, "failed", { last_error: message } as any).catch(() => {});
      await syncWorkflowToApplication(wf.id, "failed", undefined, message).catch(() => {});
    }
  }

  if (count === 0) {
    return { dispatched: false, workflowId: null, stage: null, count: 0, message: "No queued workflows" };
  }

  return { dispatched: true, workflowId: lastDispatched!.id, stage: lastDispatched!.current_stage, count };
}

/** Dispatch a specific workflow by ID (for retry / rerun / approval). */
export async function dispatchWorkflowById(workflowId: string): Promise<DispatchResult> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) {
    return { dispatched: false, workflowId: null, stage: null, count: 0, message: "Workflow not found" };
  }
  if (wf.status !== "queued") {
    return { dispatched: false, workflowId, stage: wf.current_stage, count: 0, message: `Workflow is not queued (status: ${wf.status})` };
  }

  // Manual retry/approval uses the exact same claim and next_retry_at checks
  // as the scheduled dispatcher. There must be one claim implementation.
  const claimed = await claimWorkflowById(workflowId);
  if (!claimed) {
    return { dispatched: false, workflowId, stage: wf.current_stage, count: 0, message: "Workflow already claimed by another dispatcher, or at concurrency capacity" };
  }

  // MUST be awaited here, not fire-and-forget: dispatchWorkflowById's own
  // returned promise is what every caller registers with ctx.waitUntil()
  // (directly or via backgroundDispatch). If this call isn't awaited,
  // dispatchWorkflowById's promise resolves the instant the claim UPDATE
  // above completes - status flips to 'running' but the actual stage never
  // runs, since nothing is left tracking processWorkflowStage's lifetime.
  // Confirmed live: workflows got stuck at current_stage 0 with zero
  // stage_runs indefinitely after auto-trigger, even with the waitUntil fix
  // (ef4e182) in place - because that fix wrapped the outer dispatch call,
  // not this inner one.
  await processWorkflowStage(workflowId).catch(err => {
    console.error(`[Dispatch] Workflow ${workflowId} dispatch failed:`, err);
  });

  return { dispatched: true, workflowId, stage: wf.current_stage, count: 1 };
}

function getAgentFn(id: ApplicationAgentId): (options: AgentOptions, provider: AiProvider, ctx: AgentContext) => Promise<any> {
  switch (id) {
    case "application_job_lens": return runJobLens;
    case "application_resume_forge": return runResumeForge;
    case "application_hiring_panel": return runHiringPanel;
    case "application_final_polish": return runFinalPolish;
    default: throw new Error(`Unknown agent ID: ${id}`);
  }
}

function getSchemaVersion(id: ApplicationAgentId): string {
  switch (id) {
    case "application_job_lens": return SCHEMA_VERSIONS.jobAnalysis;
    case "application_resume_forge": return SCHEMA_VERSIONS.resumeDraft;
    case "application_hiring_panel": return SCHEMA_VERSIONS.reviewScore;
    case "application_final_polish": return SCHEMA_VERSIONS.finalResume;
    default: throw new Error(`Unknown agent ID: ${id}`);
  }
}

async function refreshWorkflowBaseResume(workflowId: string, wf: WorkflowRow): Promise<void> {
  const appRow = await queryOne<{ candidate_id: string; job_id: string | null }>(
    "SELECT candidate_id, job_id FROM applications WHERE id = $1",
    [wf.application_id]
  );
  if (!appRow || !appRow.job_id) return;

  const jobRow = await queryOne<any>("SELECT * FROM jobs WHERE id = $1", [appRow.job_id]);
  const job: any = jobRow ?? {};

  let targetResumeRow = await queryOne<any>(
    `SELECT arv.* FROM application_resume_versions arv
     WHERE arv.target_job_id IN (
       SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2
     )
     AND arv.source_type = 'base_resume' AND arv.status = 'active'
     ORDER BY arv.created_at DESC LIMIT 1`,
    [appRow.candidate_id, appRow.job_id]
  );

  let resumeRow: any = null;
  if (targetResumeRow?.base_resume_id) {
    resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, wf.application_id, job, undefined, targetResumeRow.base_resume_id);
  } else {
    const best = await selectBestBaseResume(appRow.candidate_id, { title: job.title, job_category: job.job_category, description_text: job.description_text, company: job.company, location: job.location });
    if (best) {
      resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, wf.application_id, job, undefined, best.resume.id);
    } else {
      resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, wf.application_id, job, undefined);
    }
  }

  if (resumeRow) {
    const snapshot = (wf.config_snapshot ?? {}) as any;
    snapshot.baseResume = resumeRow;
    await query(
      "UPDATE application_ai_workflows SET config_snapshot = $1::jsonb WHERE id = $2",
      [JSON.stringify(snapshot), workflowId]
    );
  }
}

export async function cancelWorkflow(workflowId: string): Promise<void> {
  await updateWorkflowStatus(workflowId, "cancelled");
  await syncWorkflowToApplication(workflowId, "cancelled");
}

/** Retry a failed/cancelled workflow from its current stage (preserves progress). */
export async function retryWorkflow(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || (wf.status !== "failed" && wf.status !== "cancelled")) return;
  await refreshWorkflowBaseResume(workflowId, wf);
  // last_error must be cleared here, not just status - otherwise the Kanban
  // (and Application Queue) keep showing the PREVIOUS failure's message
  // indefinitely after a successful retry, since nothing else ever
  // overwrites it until the workflow fails again. Confirmed live: a
  // freshly re-queued, not-yet-processed workflow displayed a stale
  // "All configured routes failed" error from before the retry, reading
  // as a brand-new failure when it wasn't one.
  await updateWorkflowStatus(workflowId, "queued", { last_error: null });
  await syncWorkflowToApplication(workflowId, "queued");
}

/** Restart a failed/cancelled workflow from stage 0 (discards all progress). */
export async function restartWorkflow(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || (wf.status !== "failed" && wf.status !== "cancelled")) return;
  await refreshWorkflowBaseResume(workflowId, wf);
  await query(
    "DELETE FROM application_ai_stage_runs WHERE workflow_id = $1",
    [workflowId]
  );
  await query(
    "DELETE FROM application_ai_artifacts WHERE workflow_id = $1",
    [workflowId]
  );
  await updateWorkflowStatus(workflowId, "queued", { current_stage: 0, last_error: null });
  await syncWorkflowToApplication(workflowId, "queued");
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return;
  await refreshWorkflowBaseResume(workflowId, wf);
  await updateWorkflowStatus(workflowId, "queued", { current_stage: Math.max(0, stage) });
  await syncWorkflowToApplication(workflowId, "queued");
}
