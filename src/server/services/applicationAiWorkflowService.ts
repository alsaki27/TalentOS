// Orchestrates the multi-agent application pipeline.
// Each stage runs in a single invocation, then the dispatcher picks up the next.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking, AiRouteCallError, classifyAiErrorCode, type CallContext } from "@/lib/ai/routing";
import { APPLICATION_AGENT_IDS, type ApplicationAgentId, type AgentContext, type ArtifactRecord } from "@/lib/ai/application-agents/types";
import { SCHEMA_VERSIONS, AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { getSourceOfTruth } from "@/server/services/sourceOfTruthService";
import type { SourceOfTruthData } from "@/lib/ai/application-agents/types";
import { runJobLens } from "@/lib/ai/application-agents/jobLens";
import { resolveJobDescription } from "@/lib/ai/application-agents/prompts/jobLens";
import { classifyWorkflowFailure } from "@/lib/ai/application-agents/workflowFailureClassifier";
import { runResumeForge } from "@/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "@/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "@/lib/ai/application-agents/finalPolish";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import type { AgentOptions } from "@/lib/ai/application-agents/types";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import {
  createWorkflow,
  findWorkflowById,
  findActiveWorkflowByApplicationId,
  updateWorkflowStatus,
  createStageRun,
  updateStageRun,
  createArtifact,
  listStageRuns,
  listArtifacts,
  claimWorkflowById,
  claimNextPendingWorkflow,
  updateWorkflowHeartbeat,
  assertWorkflowClaim,
  closeOrphanedStageRuns,
  type ArtifactRow,
  type WorkflowRow,
} from "@/server/repositories/applicationAiWorkflowRepository";
import { getAiRuntimeConfig } from "@/server/repositories/aiRuntimeConfigRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { selectBestBaseResume } from "@/lib/ai/selectBestBaseResume";
import { query, queryOne, execute } from "@/server/db/neon";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { getWorkflowDispatchHeaders } from "@/server/lib/dispatchAuth";

function sha256(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
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
 * Starting a fresh workflow right after a failure that was actually a data
 * problem (no job description on file, no target_job link) just reproduces
 * the identical failure - the pipeline logic hasn't changed, only re-running
 * it does nothing until the underlying data does. Re-checks the SAME
 * preconditions the pipeline itself enforces (resolveJobDescription from
 * jobLens.ts, the target_jobs lookup finalizationService.ts uses) against
 * current data rather than trusting the frozen error text, so a job that's
 * since had its description added is never blocked by a stale reason.
 * Returns a human-readable block reason, or null if it's fine to proceed
 * (including when the most recent attempt failed for an unrelated,
 * transient reason - those are always retriable).
 */
async function checkWorkflowRetryBlocked(
  applicationId: string,
  candidateId: string,
  jobId: string,
  job: any,
): Promise<string | null> {
  const lastAttempt = await queryOne<{ last_error: string | null }>(
    `SELECT last_error FROM application_ai_workflows WHERE application_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [applicationId]
  );
  const classification = classifyWorkflowFailure(lastAttempt?.last_error);
  if (!classification) return null;

  if (classification.category === "missing_job_description") {
    const description = resolveJobDescription(job);
    return (!description || description === "No description available") ? classification.reason : null;
  }

  if (classification.category === "missing_target_job") {
    const tj = await queryOne<{ id: string }>(
      `SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [candidateId, jobId]
    );
    return tj ? null : classification.reason;
  }

  return null;
}

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

  const blockReason = await checkWorkflowRetryBlocked(applicationId, appRow.candidate_id, appRow.job_id, job);
  if (blockReason) {
    return { started: false, reason: blockReason };
  }

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
      method: 'POST',
      headers: getWorkflowDispatchHeaders(),
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

  const blockReason = await checkWorkflowRetryBlocked(applicationId, appRow.candidate_id, appRow.job_id, job);
  if (blockReason) {
    return { started: false, reason: blockReason };
  }

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

  // Workflow snapshots created by older callers can contain only partial job
  // metadata. The live jobs row is authoritative for identity and description
  // fields, so overlay it before any agent sees the context. This prevents
  // Job Lens from rejecting a valid database job because the snapshot omitted
  // its title/company.
  const canonicalJob = await queryOne<any>(
    `SELECT j.* FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = $1`,
    [wf.application_id]
  );
  const job = canonicalJob
    ? { ...(snapshot.job ?? {}), ...canonicalJob }
    : (snapshot.job ?? {});

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
    job,
    baseResume,
    evidence: snapshot.evidence ?? [],
    verifiedSkills: snapshot.verifiedSkills ?? [],
    sourceOfTruth: snapshot.sourceOfTruth ?? null,
    previousOutputs: outputsMap,
  };
}

/**
 * Advance workflow to the next stage and re-queue.
 * Called after each successful stage completion.
 * Returns the new stage number.
 */
async function continueToNextStage(workflowId: string, nextStage: number, lockVersion?: number): Promise<number> {
  const updated = await updateWorkflowStatus(workflowId, "queued", {
    current_stage: nextStage,
    stage_retry_count: 0,
  }, lockVersion);
  if (lockVersion !== undefined && !updated) {
    throw new Error("Workflow claim lost before advancing to the next stage");
  }
  return nextStage;
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
    case "queued": genStatus = "queued"; break;
    case "waiting": genStatus = "human_review"; break;
    case "failed": genStatus = "failed"; break;
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
 * - After successful stage, re-queues for the next stage via continueToNextStage().
 * - Retries on failure up to configured max_attempts.
 * - On final failure, marks workflow as failed.
 * - Implements runtime provider fallback (up to 3 distinct route attempts).
 * - Does NOT recurse — the dispatcher picks up the next stage.
 * - Checks for cancellation before and after the provider call.
 */
export async function processWorkflowStage(workflowId: string, expectedLockVersion?: number): Promise<void> {
  let wf = await findWorkflowById(workflowId);
  if (!wf) {
    console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} not found.`);
    return;
  }

  console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} status=${wf.status}, stage=${wf.current_stage}`);

  if (wf.status === "queued" && expectedLockVersion === undefined) {
    const claimed = await claimWorkflowById(workflowId);
    if (!claimed) return;
    wf = claimed;
  }

  const lockVersion = expectedLockVersion ?? wf.lock_version;
  if (expectedLockVersion !== undefined && !(await assertWorkflowClaim(workflowId, lockVersion))) {
    console.warn(`[Dispatch Chain] processWorkflowStage: claim for ${workflowId} was superseded; skipping stale invocation.`);
    return;
  }

  if (wf.status !== "queued" && wf.status !== "running") {
    console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} skipped (status is ${wf.status}, not queued/running).`);
    return;
  }

  if (wf.status === "queued") {
    const updated = await updateWorkflowStatus(workflowId, "running", { current_stage: wf.current_stage, last_error: null } as any, expectedLockVersion);
    if (expectedLockVersion !== undefined && !updated) return;
    wf = { ...wf, status: "running" };
    await syncWorkflowToApplication(workflowId, "running", wf.current_stage);
    if (wf.current_stage === 0) {
      await query("UPDATE applications SET ai_workflow_id = $1, resume_generation_started_at = NOW() WHERE id = $2",
        [workflowId, wf.application_id]);
    }
  }

  // Legacy workflows created before routing snapshots existed are pinned once
  // on their first claim. Retries then use the same state even if the active
  // Control Center configuration changes mid-workflow.
  const snapshot = (wf.config_snapshot ?? {}) as Record<string, any>;
  if (typeof snapshot.routingStateId !== "string") {
    const runtime = await getAiRuntimeConfig();
    if (runtime.active_routing_state_id) {
      snapshot.routingStateId = runtime.active_routing_state_id;
      const routeSnapshot = await query(
        `SELECT automation_id, rank, ai_key_id, provider, model_override, reasoning_effort
           FROM ai_routing_state_routes
          WHERE state_id = $1 AND is_enabled = true
          ORDER BY automation_id, rank`,
        [runtime.active_routing_state_id],
      );
      await execute(
        `UPDATE application_ai_workflows
            SET routing_state_id = $1, route_snapshot = $2::jsonb,
                config_snapshot = $3::jsonb, updated_at = NOW()
          WHERE id = $4 AND lock_version = $5 AND claimed_by = 'dispatcher'`,
        [runtime.active_routing_state_id, JSON.stringify(routeSnapshot), JSON.stringify(snapshot), workflowId, lockVersion],
      );
      wf = { ...wf, config_snapshot: snapshot, routing_state_id: runtime.active_routing_state_id, route_snapshot: routeSnapshot };
    }
  }

  const agentOrder = APPLICATION_AGENT_IDS;
  const currentIdx = wf.current_stage;

  if (currentIdx >= agentOrder.length) {
    await finalizeWorkflow(workflowId, lockVersion);
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
      expectedLockVersion: lockVersion,
    });
    await updateStageRun(stageRun.id, {
      status: "failed",
      error_message: `Agent "${agentId}" is disabled via ai_agent_configs.is_active`,
      completed_at: new Date().toISOString(),
    }, { workflowId, lockVersion });
    await updateWorkflowStatus(workflowId, "failed", { last_error: `Agent "${agentId}" is disabled` }, lockVersion);
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
  const priorStageAttempts = previousRuns.filter(
    (r) => r.automation_id === agentId && r.sequence_number === currentIdx + 1
  );
  const priorStageAttemptNumbers = priorStageAttempts
    .map((r) => Number(r.attempt_number))
    .filter(Number.isFinite);
  const nextStageAttemptNumber = (priorStageAttemptNumbers.length > 0
    ? Math.max(...priorStageAttemptNumbers)
    : 0) + 1;
  // The workflow stores the retry budget separately from stage-run identity.
  // A deliberate retry resets stage_retry_count, while ordinary failures
  // increment it. Historical stage rows therefore remain immutable audit
  // history without making a repaired provider fail immediately.
  const retryAttemptNumber = (wf.stage_retry_count ?? 0) + 1;

  // attempt_number is also the unique audit identity for a workflow/stage.
  // Never reuse attempt 1 after a stale claim left an old row behind. A
  // second dispatcher can still race between listStageRuns and INSERT, so
  // advance to the next identity if Postgres reports that exact unique-key
  // conflict. The retry budget remains separate from this identity.
  let stageAttemptNumber = nextStageAttemptNumber;
  let stageRun: Awaited<ReturnType<typeof createStageRun>> | null = null;
  for (let allocationAttempt = 0; allocationAttempt < 3; allocationAttempt++) {
    try {
      stageRun = await createStageRun({
        workflowId,
        automationId: agentId,
        sequenceNumber: currentIdx + 1,
        attemptNumber: stageAttemptNumber,
        expectedLockVersion: lockVersion,
      });
      break;
    } catch (allocationError: any) {
      const isAttemptConflict = allocationError?.code === "23505"
        && String(allocationError?.constraint ?? allocationError?.message ?? "")
          .includes("application_ai_stage_runs_workflow_id_sequence_number_attem");
      if (!isAttemptConflict || allocationAttempt === 2) throw allocationError;
      stageAttemptNumber += 1;
    }
  }

  if (!stageRun) throw new Error("Could not allocate a unique AI stage attempt");

  const ownedStageUpdate = async (updates: Parameters<typeof updateStageRun>[1]): Promise<void> => {
    const updated = await updateStageRun(stageRun.id, updates, { workflowId, lockVersion });
    if (!updated) throw new Error("Workflow claim lost while updating the stage");
  };

  try {
    await ownedStageUpdate({ status: "running", started_at: new Date().toISOString() });
    if (!(await updateWorkflowHeartbeat(workflowId, lockVersion))) {
      throw new Error("Workflow claim lost before provider call");
    }

    // Check for cancellation before invoking the provider
    const currentWf = await findWorkflowById(workflowId);
    if (currentWf?.status === "cancelled") {
      await ownedStageUpdate({ status: "cancelled" });
      await syncWorkflowToApplication(workflowId, "cancelled");
      return;
    }

    const ctx = await buildAgentContext(wf, previousArtifacts);
    const startMs = Date.now();

    // Persist the exact stage input/options before spending a provider call.
    // This makes every future run replayable and explains failures without
    // depending on mutable base-resume or routing state.
    const inputPayload = {
      kind: "agent_input",
      automationId: agentId,
      sequenceNumber: currentIdx + 1,
      attemptNumber: stageAttemptNumber,
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
    await ownedStageUpdate({ input_artifact_id: inputArtifact.id });

    // callWithUsageTracking owns the provider fallback chain. Keep the stage
    // itself to one routing call: wrapping it in another retry loop caused a
    // timeout to repeat the same OpenCode route instead of advancing to
    // Vertex, multiplying one slow stage into several minutes.
    let lastError: Error | null = null;
    let agentOutput: any = null;
    let resolvedProviderName = "";
    let resolvedKeyId: string | null = null;
    let resolvedModel: string | null = null;
    try {
      const callCtx: CallContext = {
        userId: wf.started_by ?? undefined,
        workflowId,
        applicationId: wf.application_id,
        attemptNumber: stageAttemptNumber,
        routingStateId: typeof (wf.config_snapshot as any)?.routingStateId === "string"
          ? (wf.config_snapshot as any).routingStateId
          : undefined,
        maxProviderAttempts: 2,
      };
      // Each production provider enforces AgentOptions.timeout_ms with its
      // own AbortController. Let that error reach callWithUsageTracking so it
      // can classify the abort as a timeout and immediately try the next
      // configured route. A Promise.race here would reject without route
      // metadata while leaving the upstream request alive.
      const heartbeatTimer = setInterval(() => {
        void updateWorkflowHeartbeat(workflowId, lockVersion).then(alive => {
          if (!alive) console.warn(`[Workflow ${workflowId}] claim was superseded during provider call.`);
        }).catch(err =>
          console.warn(`[Workflow ${workflowId}] heartbeat refresh failed`, err)
        );
      }, 20_000);
       let callResult;
       try {
        const timeoutMs = agentOptions.timeout_ms ?? 300_000;
        callResult = await withTimeout(
          callWithUsageTracking(
            agentId,
            callCtx,
            async (provider: AiProvider) => {
              const agentFn = getAgentFn(agentId);
              return agentFn(agentOptions, provider, ctx);
            },
          ),
          timeoutMs * 2 + 5_000,
          `Agent stage timed out after ${timeoutMs * 2 + 5_000}ms`,
        );
      } finally {
        clearInterval(heartbeatTimer);
      }
      agentOutput = callResult.result;
      resolvedProviderName = callResult.providerName;
      resolvedKeyId = callResult.aiKeyId;
      resolvedModel = callResult.model;
    } catch (err: any) {
      lastError = err;
      resolvedKeyId = null;
    }

    if (lastError || !agentOutput) {
      throw lastError ?? new Error("No output from agent");
    }

    if (!(await assertWorkflowClaim(workflowId, lockVersion))) {
      console.warn(`[Workflow ${workflowId}] provider returned after its claim was superseded; discarding stale output.`);
      return;
    }

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

    await ownedStageUpdate({
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
        await updateStageRun(stageRun.id, { status: "cancelled" }, { workflowId, lockVersion });
        await syncWorkflowToApplication(workflowId, "cancelled");
        return;
      }
      // finalizeWorkflow() runs a SQL transaction that both inserts the resume
      // version row AND marks the workflow/application as completed atomically.
      // However, post-transaction steps (SharePoint archiving, identity audit,
      // activity logging) can throw AFTER the core commit has already landed.
      // If we let that exception bubble out to the outer catch block it would
      // overwrite resume_generation_status back to 'failed' even though the
      // resume was successfully written and the workflow row says 'completed'.
      // Guard: if finalizeWorkflow() throws, re-read the application to see
      // whether the resume actually made it to the DB. If it did, absorb the
      // error (log only) and return cleanly — the completed state is correct.
      // Only re-throw if the resume was NOT committed, so the outer catch can
      // apply the normal retry/fail logic without blowing away a valid resume.
      try {
        await finalizeWorkflow(workflowId, lockVersion);
      } catch (finalizeErr: any) {
        console.error(`[Workflow ${workflowId}] finalizeWorkflow threw:`, finalizeErr?.message ?? finalizeErr);
        // Check whether the core transaction committed despite the exception.
        const appCheck = await queryOne<{
          resume_generation_status: string | null;
          tailored_resume_version_id: string | null;
        }>(
          "SELECT resume_generation_status, tailored_resume_version_id FROM applications WHERE id = $1",
          [wf.application_id]
        );
        if (appCheck?.resume_generation_status === "ready" && appCheck.tailored_resume_version_id) {
          // Resume committed successfully — the exception came from a
          // post-commit step (SharePoint, audit, activity log). The workflow
          // row was already set to 'completed' inside the transaction.
          // Do NOT re-throw; returning here prevents the outer catch from
          // overwriting the correct 'ready' status with 'failed'.
          console.warn(`[Workflow ${workflowId}] finalizeWorkflow error absorbed — resume version ${appCheck.tailored_resume_version_id} is committed and status is already 'ready'. Error was: ${finalizeErr?.message ?? finalizeErr}`);
          return;
        }
        // Resume was NOT committed — re-throw so the outer catch can handle
        // retry/fail normally.
        throw finalizeErr;
      }
      return;
    }

    // Advance to next stage and re-queue
    await continueToNextStage(workflowId, currentIdx + 1, lockVersion);
    await syncWorkflowToApplication(workflowId, "queued");

    // Immediately dispatch the next stage so the pipeline doesn't stall
    // between stages waiting for the 5-minute cron dispatcher.
    // Making an HTTP fetch to ourselves guarantees a fresh Cloudflare invocation
    // with a reset 50-subrequest limit.
    const baseUrl = process.env.TALENTOS_BASE_URL || 'https://talent.skarion.com';
    await backgroundDispatch(
      fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
        method: 'POST',
        headers: getWorkflowDispatchHeaders(),
      }).catch((err) => {
        console.error(`[Workflow ${workflowId}] Continue to stage ${currentIdx + 1} fetch failed:`, err);
      })
    );
  } catch (err: any) {
    if (!(await assertWorkflowClaim(workflowId, lockVersion))) {
      console.warn(`[Workflow ${workflowId}] ignoring failure from a superseded claim.`);
      return;
    }
    await ownedStageUpdate({
      status: "failed",
      error_code: err instanceof AiRouteCallError
        ? (err.errorCode ?? classifyAiErrorCode(err) ?? "stage_error")
        : (classifyAiErrorCode(err) ?? "stage_error"),
      error_message: err.message ?? "Unknown error",
      completed_at: new Date().toISOString(),
    });

    const isProviderCooldown = err instanceof AiRouteCallError &&
      ["rate_limit", "quota_exhausted"].includes(err.errorCode ?? "");
    // Provider capacity is not a content/agent attempt. Even if the normal
    // max_attempts budget was already consumed, leave the stage queued behind
    // a cooldown instead of converting a temporary 429 into a terminal
    // workflow failure.
    if (isProviderCooldown || retryAttemptNumber < maxAttempts) {
      await updateWorkflowStatus(workflowId, "queued", {
        current_stage: currentIdx,
        last_error: err.message,
        stage_retry_count: isProviderCooldown ? (wf.stage_retry_count ?? 0) : retryAttemptNumber,
        next_retry_at: isProviderCooldown
          ? new Date(Date.now() + 15 * 60_000).toISOString()
          : null,
      }, lockVersion);
      await syncWorkflowToApplication(workflowId, "queued");

      if (!isProviderCooldown) {
        // Ordinary failures retry immediately; capacity failures wait for the
        // persisted next_retry_at window instead of hammering the same key.
        const baseUrl = process.env.TALENTOS_BASE_URL || 'https://talent.skarion.com';
        await backgroundDispatch(
          fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
            method: 'POST',
            headers: getWorkflowDispatchHeaders(),
          }).catch((retryErr) => {
            console.error(`[Workflow ${workflowId}] Retry dispatch fetch failed:`, retryErr);
          })
        );
      }
    } else {
      await updateWorkflowStatus(workflowId, "failed", { last_error: err.message }, lockVersion);
      await syncWorkflowToApplication(workflowId, "failed", undefined, err.message);
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

    // A reclaimed workflow may still contain stage rows from the dead
    // invocation that owned the previous lease. Close those rows before the
    // replacement attempt so the queue never reports multiple active stages
    // for one workflow.
    await closeOrphanedStageRuns(wf.id).catch((err) =>
      console.warn(`[Dispatch] Failed to close superseded stage rows for ${wf.id}:`, err)
    );

    if (wf.status === 'failed') {
      // Previously only synced to applications.resume_generation_error -
      // the workflow row itself (what GET .../ai-workflow and the overview
      // endpoint surface) kept last_error: null, making an exhausted-retry
      // failure look identical to "no error ever recorded." Persist it in
      // both places so it's visible wherever someone's looking.
      const message = `Workflow failed after ${wf.recovery_count} recovery attempts at stage ${wf.current_stage} - each claim orphaned without completing or erroring cleanly`;
      await updateWorkflowStatus(wf.id, "failed", { last_error: message } as any, wf.lock_version).catch(() => { });
      await syncWorkflowToApplication(wf.id, 'failed', undefined, message);
      continue;
    }

    try {
      await processWorkflowStage(wf.id, wf.lock_version);
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
      const requeued = await updateWorkflowStatus(wf.id, "queued", {
        current_stage: wf.current_stage,
        last_error: `Dispatcher error: ${message}`,
        next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      } as any, wf.lock_version).catch(() => false);
      if (requeued) {
        await syncWorkflowToApplication(wf.id, "queued").catch(() => { });
      }
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

  // Same concurrency cap as claimNextPendingWorkflow (see that function's
  // comment): a queued workflow only gets claimed here if we're under the
  // limit on genuinely active workflows. Bulk-created tickets each call this
  // via their own auto-trigger, so without this check hundreds of them would
  // all claim+dispatch (and fire an AI provider call) at the same instant.
  // Over the cap, the workflow just stays 'queued' - the periodic dispatcher
  // picks it up in its turn once capacity frees up.
  const claimed = await queryOne<{ id: string; lock_version: number }>(
    `WITH config AS MATERIALIZED (
       SELECT workflow_max_concurrency, workflow_claim_ttl_seconds
       FROM ai_runtime_config WHERE singleton = true FOR UPDATE
     ), active_count AS (
       SELECT COUNT(*)::int AS n FROM application_ai_workflows
       WHERE status = 'running'
         AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()
     )
     UPDATE application_ai_workflows w
     SET status = 'running', claimed_at = NOW(),
         claim_expires_at = NOW() + make_interval(secs => c.workflow_claim_ttl_seconds),
         claimed_by = 'dispatcher', heartbeat_at = NOW(), updated_at = NOW(), lock_version = lock_version + 1
     FROM config c, active_count ac
     WHERE w.id = $1
       AND (status = 'queued' OR (status = 'running' AND claim_expires_at < NOW()))
       AND (
         status != 'queued'
         OR ac.n < c.workflow_max_concurrency
       )
    RETURNING w.id, w.lock_version`,
    [workflowId]
  );
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
  await processWorkflowStage(workflowId, claimed.lock_version).catch(async err => {
    console.error(`[Dispatch] Workflow ${workflowId} dispatch failed:`, err);
    const latest = await findWorkflowById(workflowId).catch(() => null);
    const requeued = await updateWorkflowStatus(workflowId, "queued", {
      current_stage: latest?.current_stage ?? wf.current_stage,
      last_error: `Dispatcher error: ${err?.message ?? String(err)}`,
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    }, claimed.lock_version).catch(() => false);
    if (requeued) {
      await syncWorkflowToApplication(workflowId, "queued").catch(() => { });
    }
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

  // A retry may target a legacy workflow created before target_jobs was
  // materialized. Repair this deterministic prerequisite before spending on
  // another AI attempt; the row is keyed idempotently by candidate + job.
  await upsertTargetJobByCandidateAndJob(appRow.candidate_id, appRow.job_id, {
    raw_description: jobDescriptionForTargetJob(job),
  });

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
  await closeOrphanedStageRuns(workflowId);
  await refreshWorkflowBaseResume(workflowId, wf);
  // last_error must be cleared here, not just status - otherwise the Kanban
  // (and Application Queue) keep showing the PREVIOUS failure's message
  // indefinitely after a successful retry, since nothing else ever
  // overwrites it until the workflow fails again. Confirmed live: a
  // freshly re-queued, not-yet-processed workflow displayed a stale
  // "All configured routes failed" error from before the retry, reading
  // as a brand-new failure when it wasn't one.
  await updateWorkflowStatus(workflowId, "queued", {
    last_error: null,
    next_retry_at: null,
    stage_retry_count: 0,
  });
  await syncWorkflowToApplication(workflowId, "queued");
}

/** Restart a failed/cancelled workflow from stage 0 (discards all progress). */
export async function restartWorkflow(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || (wf.status !== "failed" && wf.status !== "cancelled")) return;
  await closeOrphanedStageRuns(workflowId);
  await refreshWorkflowBaseResume(workflowId, wf);
  await query(
    "DELETE FROM application_ai_stage_runs WHERE workflow_id = $1",
    [workflowId]
  );
  await query(
    "DELETE FROM application_ai_artifacts WHERE workflow_id = $1",
    [workflowId]
  );
  await updateWorkflowStatus(workflowId, "queued", {
    current_stage: 0,
    last_error: null,
    next_retry_at: null,
    stage_retry_count: 0,
  });
  await syncWorkflowToApplication(workflowId, "queued");
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return;
  await closeOrphanedStageRuns(workflowId);
  await refreshWorkflowBaseResume(workflowId, wf);
  await updateWorkflowStatus(workflowId, "queued", {
    current_stage: Math.max(0, stage),
    last_error: null,
    next_retry_at: null,
    stage_retry_count: 0,
  });
  await syncWorkflowToApplication(workflowId, "queued");
}
