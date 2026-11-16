// Orchestrates the multi-agent application pipeline.
// Each stage runs in a single invocation, then the dispatcher picks up the next.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { sha256Hex } from "@/lib/sha256";
import { callWithUsageTracking, recordUsageEvent, AiRouteCallError, classifyAiErrorCode, type CallContext, type CallWithUsageTrackingResult, type ResumeRouteSnapshot } from "@/lib/ai/routing";
import { type ApplicationAgentId, type AgentContext, type ArtifactRecord } from "@/lib/ai/application-agents/types";
import { EVIDENCE_RESUME_STAGES, LEGACY_RESUME_STAGES, RESUME_EVIDENCE_VARIANT, evidenceRouteId, resumeStages } from "@/lib/ai/application-agents/workflowStages";
import { prepareEvidenceStage, sendEvidenceTask } from "@/lib/ai/application-agents/evidencePipeline";
import { findCompletedResumeModelCheckpoint, ResumeModelCheckpointError, withResumeModelCheckpoint } from "@/server/repositories/resumeModelCheckpointRepository";
import { isOpenAiLuna } from "@/server/services/aiProvider";
import { configuredOpenAiReasoningEffort, forgeReasoningOutputBudget } from "@/lib/ai/openAiReasoning";
import { SCHEMA_VERSIONS, AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { getSourceOfTruth } from "@/server/services/sourceOfTruthService";
import type { SourceOfTruthData } from "@/lib/ai/application-agents/types";
import { resolveJobDescription } from "@/lib/ai/application-agents/prompts/jobLens";
import { classifyWorkflowFailure } from "@/lib/ai/application-agents/workflowFailureClassifier";
import { runResumeForge, JOB_ANALYSIS_CHECKPOINT_ID } from "@/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "@/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "@/lib/ai/application-agents/finalPolish";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import type { AgentOptions } from "@/lib/ai/application-agents/types";
import { findAgentConfigByAutomationId, listAgentConfigs, type AgentConfigRow } from "@/server/repositories/aiAgentConfigRepository";
import {
  createWorkflow,
  findWorkflowById,
  findActiveWorkflowByApplicationId,
  updateWorkflowStatus,
  createStageRun,
  updateStageRun,
  createArtifact,
  commitStageResult,
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
import { revertAeStageForPipelineRestart } from "@/server/repositories/applicationsRepository";
import { getAiRuntimeConfig, resumePipelineSettings } from "@/server/repositories/aiRuntimeConfigRepository";
import { manualResumeTransition, setStageDeadline } from "@/server/repositories/resumeWorkflowRecoveryRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { selectBestBaseResume } from "@/lib/ai/selectBestBaseResume";
import { query, queryOne, execute } from "@/server/db/neon";

function sha256(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
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

// The 3 real pipeline stages. Not application_job_lens explicitly - Resume
// Forge's stage always writes that artifact together with its own in the
// same call (see processWorkflowStage's split-artifact write for
// application_resume_forge), so its presence is already implied by
// application_resume_forge's.
const REQUIRED_APPLICATION_AGENT_IDS = LEGACY_RESUME_STAGES;

// Hard ceiling for one stage attempt. A stage runs inside a single dispatch
// request that scheduled-jobs.yml calls with `curl --max-time 660`, under a
// 720s workflow claim - a stage allowed to run past ~605s gets cut off by the
// client instead of failing cleanly. 605s is the budget that workflow file
// already documents as safe.
const STAGE_BUDGET_CEILING_MS = 605_000;

/**
 * Total time one stage attempt may take across all provider routes.
 * Most stages make one provider call per route, so timeout*2 (+5s) covers a
 * slow first route plus one fallover. Resume Forge now makes up to 4
 * sequential calls per route (job extraction, requirement analysis, draft,
 * optional coverage retry), so the flat timeout*2 budget - 365s with the
 * live 180s ai_agent_configs timeout - was routinely exceeded and every
 * such run failed as "Agent stage timed out". Give it room for its extra
 * calls, capped at the dispatch ceiling.
 */
function stageTimeBudgetMs(agentId: ApplicationAgentId, timeoutMs: number): number {
  const base = timeoutMs * 2 + 5_000;
  if (agentId !== "application_resume_forge") return base;
  return Math.max(base, Math.min(timeoutMs * 4 + 5_000, STAGE_BUDGET_CEILING_MS));
}

async function requeueFromMissingApplicationStage(
  workflowId: string,
  missingStage: number,
  lockVersion: number,
  artifacts: ArtifactRow[],
  agentOrder: readonly ApplicationAgentId[] = REQUIRED_APPLICATION_AGENT_IDS,
): Promise<void> {
  const missingAgent = agentOrder[missingStage];
  const updated = await updateWorkflowStatus(workflowId, "queued", {
    current_stage: missingStage,
    stage_retry_count: 0,
    last_error: `Pipeline integrity repair: missing ${missingAgent} artifact; requeued from stage ${missingStage}`,
  }, lockVersion);
  if (!updated) throw new Error("Workflow claim lost while requeuing an incomplete pipeline");
  await syncWorkflowToApplication(workflowId, "queued", missingStage);
  console.warn(
    `[Dispatch Chain] Requeued incomplete workflow ${workflowId} from stage ${missingStage}; ` +
      `artifacts=${artifacts.map((artifact) => artifact.automation_id).join(",")}`,
  );
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
  // Phase 0 A/B seam (2026-09-28): pins this workflow to a named pipeline
  // behavior variant for the life of the run, the same way routingStateId
  // pins a model config. No caller sets this today - it exists so a handful
  // of real workflows can be tagged for a canary (e.g. "final_polish_skip")
  // via a direct UPDATE of config_snapshot, without flipping the matching
  // global ai_runtime_config flag for all traffic. See finalPolish.ts's own
  // check of ctx.pipelineVariant for the one consumer that exists today.
  pipelineVariant?: string | null;
  // Phase 5 Regenerate reuse (2026-09-29): a prior run's per-candidate
  // requirementAnalysis, reused when regenerateAiWorkflowForApplication finds
  // an unchanged base-resume content hash for this same application - see
  // its own doc comment for the lookup. Skips a full AI call in
  // resumeForge.ts's analyzeJob() when present.
  cachedRequirementAnalysis?: unknown[] | null;
}): Promise<{ workflowId: string }> {
  const runtime = await getAiRuntimeConfig();
  const routingStateId = runtime.active_routing_state_id ?? null;
  const routeSnapshot = await loadRoutingStateRoutes(routingStateId);
  const settings = resumePipelineSettings(runtime);
  const variant = input.pipelineVariant ?? (settings.evidenceEnabled ? RESUME_EVIDENCE_VARIANT : null);
  const evidenceRouteChains = variant === RESUME_EVIDENCE_VARIANT
    ? await snapshotEvidenceRoutes(routeSnapshot)
    : null;
  const evidenceConfigs = variant === RESUME_EVIDENCE_VARIANT ? Object.fromEntries(
    (await listAgentConfigs()).filter(config => EVIDENCE_RESUME_STAGES.some(stage =>
      evidenceRouteId(stage) === config.automation_id,
    )).map(config => [config.automation_id, config]),
  ) : null;
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
    pipelineVariant: variant,
    evidenceRouteChains,
    evidenceConfigs,
    forgeInputChars: settings.forgeInputChars,
    resumeMaxPages: settings.resumeMaxPages,
    frozenInputsHash: variant === RESUME_EVIDENCE_VARIANT ? await sha256Hex(JSON.stringify({
      job: input.job, base: input.baseResume, evidence: input.evidence,
      verifiedSkills: input.verifiedSkills, sourceOfTruth: input.sourceOfTruth,
    })) : null,
    cachedRequirementAnalysis: input.cachedRequirementAnalysis ?? null,
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
  // No-op for a brand-new ticket (ae_stage is already 'in_ai_pipeline' at
  // creation - see createApplications). Only actually fires for Regenerate
  // on a ticket that had already reached 'ready_for_review' - see
  // revertAeStageForPipelineRestart's own doc comment for why this matters.
  await revertAeStageForPipelineRestart(input.applicationId);
  return { workflowId: wf.id };
}

type EvidenceRoute = { provider: string; model: string };

async function loadRoutingStateRoutes(routingStateId: string | null): Promise<ResumeRouteSnapshot[]> {
  if (!routingStateId) return [];
  return query<ResumeRouteSnapshot>(
    `SELECT r.automation_id, r.rank, r.ai_key_id, COALESCE(k.provider,r.provider) AS provider,
            COALESCE(r.model_override,k.model,k.default_model) AS model_override, r.reasoning_effort
       FROM ai_routing_state_routes r LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
      WHERE r.state_id = $1 AND r.is_enabled = true
      ORDER BY r.automation_id, r.rank`, [routingStateId],
  );
}

async function snapshotEvidenceRoutes(active: ResumeRouteSnapshot[]) {
  const ids = EVIDENCE_RESUME_STAGES.map(evidenceRouteId);
  const missing = ids.filter(id => !active.some(route => route.automation_id === id));
  const seeded = missing.length ? await query<ResumeRouteSnapshot>(
    `SELECT r.automation_id, r.rank, r.ai_key_id, COALESCE(k.provider,r.provider) AS provider,
            COALESCE(r.model_override,k.model,k.default_model) AS model_override, r.reasoning_effort
      FROM ai_automation_routes r LEFT JOIN ai_api_keys k ON k.id = r.ai_key_id
      WHERE r.automation_id = ANY($1::text[]) AND r.is_enabled ORDER BY r.rank`, [missing],
  ) : [];
  return Object.fromEntries(ids.map(id => [id, [...active, ...seeded].filter(route => route.automation_id === id)]));
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
 * preconditions the pipeline itself enforces (resolveJobDescription, checked
 * by Resume Forge's own job-analysis guard, and the target_jobs lookup
 * finalizationService.ts uses) against
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

  // An explicit base-resume choice for THIS attempt always wins, checked
  // before anything else. Previously the target_job-linked lookup below ran
  // unconditionally and only consulted preferredBaseResumeId if it came back
  // empty - so a candidate+job pair that already had a resume materialized
  // against it (even from an earlier, since-deleted application) silently
  // kept reusing that old resume forever, ignoring a freshly corrected
  // choice. Confirmed live: pick resume A, generate, delete the ticket, log
  // the job again picking resume B - the tailored output still came from A,
  // because A's materialized application_resume_versions row stays linked to
  // target_jobs(candidate_id, job_id) independent of any one application's
  // lifecycle (deleteApplication() now also clears this - see there - but
  // this ordering fix means a stale link can never win regardless of why it
  // exists).
  let resumeRow: any = null;
  let matchScore: number | null = null;
  let matchReason: string | null = null;
  if (preferredBaseResumeId) {
    matchReason = "User-selected base resume";
    resumeRow = await materializeFromBaseResume(appRow.candidate_id, appRow.job_id, applicationId, job, startedBy, preferredBaseResumeId);
  } else {
    // Prioritise the resume linked to the target_job for this application's
    // job, falling back to domain-matched base resume, then the candidate's
    // most recent base resume overall.
    resumeRow = await queryOne<any>(
      `SELECT arv.* FROM application_resume_versions arv
       WHERE arv.target_job_id IN (
         SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = $2
       )
       AND arv.source_type = 'base_resume' AND arv.status = 'active'
       ORDER BY arv.created_at DESC LIMIT 1`,
      [appRow.candidate_id, appRow.job_id]
    );
    if (!resumeRow) {
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

  return { started: true, workflowId };
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

  // Phase 5 Regenerate reuse (2026-09-29): Regenerate re-runs the whole
  // pipeline for the SAME application, so (job, candidate) are pinned by
  // applicationId itself - only the base resume can have changed since the
  // last run. When its content is byte-identical to what the previous run
  // actually analyzed (config_snapshot.baseResume is an immutable snapshot,
  // so this compares against what was really seen, not today's row), that
  // run's per-candidate requirementAnalysis is still exactly what this run
  // would recompute - reuse it and skip a full AI call. Staleness tolerance
  // deliberately matches the existing jobs.job_analysis cache: a job
  // description edited since the prior run does not invalidate either one.
  const priorRun = await queryOne<{ config_snapshot: any; job_lens_data: any }>(
    `SELECT w.config_snapshot, aa.data AS job_lens_data
       FROM application_ai_workflows w
       JOIN application_ai_artifacts aa
         ON aa.workflow_id = w.id AND aa.automation_id = 'application_job_lens'
      WHERE w.application_id = $1
      ORDER BY w.created_at DESC
      LIMIT 1`,
    [applicationId]
  );
  let cachedRequirementAnalysis: unknown[] | null = null;
  const priorBaseContent = priorRun?.config_snapshot?.baseResume?.content;
  const currentBaseContent = (resumeRow as any)?.content;
  if (priorBaseContent && currentBaseContent &&
      sha256(JSON.stringify(priorBaseContent)) === sha256(JSON.stringify(currentBaseContent))) {
    const priorAnalysis = priorRun?.job_lens_data?.requirementAnalysis;
    if (Array.isArray(priorAnalysis) && priorAnalysis.length > 0) {
      cachedRequirementAnalysis = priorAnalysis;
      console.log(`[Regenerate ${applicationId}] reusing prior requirementAnalysis (${priorAnalysis.length} requirement(s)) - base resume content unchanged`);
    }
  }

  const { workflowId } = await startWorkflow({
    applicationId,
    candidateId: appRow.candidate_id,
    job,
    baseResume: resumeRow,
    evidence: evidence ?? [],
    verifiedSkills: candidateRow?.verified_skills ?? [],
    sourceOfTruth,
    startedBy,
    cachedRequirementAnalysis,
  });

  // Mirrors the "reject and restart" review action's own convention: reset
  // the application's displayed generation status immediately so the queue
  // page reflects the new run in progress instead of continuing to show the
  // previous "Generated" result until this workflow eventually finishes.
  await execute(
    "UPDATE applications SET resume_generation_status = 'queued', resume_generation_error = NULL WHERE id = $1",
    [applicationId]
  );

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
  const frozen = snapshot.pipelineVariant === RESUME_EVIDENCE_VARIANT;
  const canonicalJob = frozen ? null : await queryOne<any>(
    `SELECT j.* FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = $1`,
    [wf.application_id]
  );
  const job = canonicalJob
    ? { ...(snapshot.job ?? {}), ...canonicalJob }
    : (snapshot.job ?? {});

  let baseResume = snapshot.baseResume ?? {};
  if (wf.base_resume_id && !frozen) {
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
    pipelineVariant: typeof snapshot.pipelineVariant === "string" ? snapshot.pipelineVariant : null,
    cachedRequirementAnalysis: Array.isArray(snapshot.cachedRequirementAnalysis) ? snapshot.cachedRequirementAnalysis : null,
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
    recovery_count: 0,
    next_retry_at: null,
    last_error: null,
    // A successful stage means whatever provider-capacity issue the PREVIOUS
    // stage may have been cooling down for has cleared - don't carry a stale
    // cooldown count into the next stage's own budget.
    cooldown_retry_count: 0,
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
    `UPDATE applications app SET resume_generation_status = $1, resume_generation_error = $3
      WHERE app.id = $2 AND app.applied_at IS NULL AND app.ai_workflow_id = $4
        AND EXISTS (SELECT 1 FROM application_ai_workflows w WHERE w.id = $4 AND w.status = $5)`,
    [genStatus, wf.application_id, error ?? null, workflowId, status],
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

  const stageRuntime = await getAiRuntimeConfig();
  const stageSettings = resumePipelineSettings(stageRuntime);
  await syncWorkflowToApplication(workflowId, "running", wf.current_stage);
  const evidenceVariant = snapshot.pipelineVariant === RESUME_EVIDENCE_VARIANT;
  const agentOrder = resumeStages(snapshot);
  const currentIdx = wf.current_stage;

  if (currentIdx === agentOrder.length) {
    // This recovery path can run after a stage-to-stage continuation was
    // interrupted. Do not let finalization repeat a cached artifact read; the
    // repository's fresh option uses a locking read to bypass Hyperdrive's
    // stale SELECT cache.
    const completedRuns = await listStageRuns(workflowId, true);
    const ids = completedStageOutputIds(completedRuns, snapshot);
    const authoritativeArtifacts = (await listArtifacts(workflowId, { fresh: true })).filter(artifact =>
      !agentOrder.some(agent => agent === artifact.automation_id) || ids.has(artifact.id));
    const missingStage = agentOrder.findIndex(agent => !authoritativeArtifacts.some(artifact => artifact.automation_id === agent));
    if (missingStage !== -1) {
      await requeueFromMissingApplicationStage(workflowId, missingStage, lockVersion, authoritativeArtifacts, agentOrder);
      return;
    }
    await finalizeWorkflow(workflowId, lockVersion, authoritativeArtifacts);
    return;
  }

  const agentId = agentOrder[currentIdx];
  if (!agentId) {
    await requeueFromMissingApplicationStage(workflowId, 0, lockVersion, [], agentOrder);
    return;
  }
  const agentConfig = evidenceVariant
    ? snapshot.evidenceConfigs?.[evidenceRouteId(agentId)] as AgentConfigRow | undefined
    : await findAgentConfigByAutomationId(agentId);
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
  if (evidenceVariant && !agentConfig)
    throw new Error(`Missing agent configuration for ${evidenceRouteId(agentId)}`);
  const legacyDefaults = AGENT_CONFIG_DEFAULTS[agentId as keyof typeof AGENT_CONFIG_DEFAULTS];
  const agentOptions: AgentOptions = {
    system_prompt: agentConfig?.system_prompt ?? undefined,
    temperature: Number.isFinite(parsedTemperature) ? parsedTemperature : undefined,
    max_output_tokens: agentConfig?.max_output_tokens ?? legacyDefaults?.maxOutputTokens,
    timeout_ms: agentConfig?.timeout_ms ?? legacyDefaults?.timeoutMs,
  };

  const previousRuns = await listStageRuns(workflowId, true);
  const priorArtifacts = await listArtifacts(workflowId, { fresh: true });
  const authoritativeIds = completedStageOutputIds(previousRuns, snapshot);
  const previousArtifacts = priorArtifacts.filter(artifact => (
    !agentOrder.some(id => id === artifact.automation_id) || authoritativeIds.has(artifact.id)
  ));
  const missingPrerequisite = agentOrder.findIndex((id, index) => index < currentIdx &&
    !previousArtifacts.some(artifact => artifact.automation_id === id));
  if (missingPrerequisite !== -1) {
    await requeueFromMissingApplicationStage(workflowId, missingPrerequisite, lockVersion, previousArtifacts, agentOrder);
    return;
  }
  const saved = previousArtifacts.some(item => item.automation_id === agentId);
  if (saved) {
    await continueToNextStage(workflowId, currentIdx + 1, lockVersion);
    await syncWorkflowToApplication(workflowId, "queued");
    return;
  }
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
      ...(evidenceVariant ? {
        frozenInputsHash: snapshot.frozenInputsHash,
        precedingArtifactIds: previousArtifacts
          .filter(artifact => agentOrder.some(agent => agent === artifact.automation_id))
          .map(artifact => artifact.id),
      } : { context: ctx }),
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

    // Resume Forge: persist the job-analysis half the moment it exists, so a
    // later timeout in the draft half (or a re-dispatched attempt) reuses it
    // instead of paying for those provider calls again. Attached after the
    // input artifact above so it is never serialized into it.
    // Stored under its own automation id (not application_job_lens) so no
    // downstream reader ever sees a half-finished stage's output, and tagged
    // with the job + base resume it was computed for: retryWorkflow keeps
    // artifacts but may switch the base resume, and requirement analysis is
    // candidate-specific, so a checkpoint is only reused when both match.
    if (!evidenceVariant && agentId === "application_resume_forge") {
      ctx.onJobAnalysis = async (analysis) => {
        const data = { jobId: ctx.job?.id ?? null, baseResumeId: ctx.baseResume?.id ?? null, analysis };
        await createArtifact({
          workflowId,
          automationId: JOB_ANALYSIS_CHECKPOINT_ID,
          sequenceNumber: currentIdx + 1,
          schemaVersion: "JobAnalysisCheckpointV1",
          contentHash: sha256(JSON.stringify(data)),
          data,
        });
      };
      // Phase 5 claim-check-before-call: see AgentContext.isClaimStillValid's
      // doc comment. Reuses the same heartbeat/ownership check the outer
      // dispatch loop already relies on, so "still valid" here means exactly
      // what it means everywhere else in this file.
      ctx.isClaimStillValid = () => updateWorkflowHeartbeat(workflowId, lockVersion);
    }

    // callWithUsageTracking owns the provider fallback chain. Keep the stage
    // itself to one routing call: wrapping it in another retry loop caused a
    // timeout to repeat the same OpenCode route instead of advancing to
    // Vertex, multiplying one slow stage into several minutes.
    let lastError: Error | null = null;
    let agentOutput: any = null;
    let resolvedProviderName = "";
    let resolvedKeyId: string | null = null;
    let resolvedModel: string | null = null;
    let resolvedInputTokens: number | null = null;
    let resolvedOutputTokens: number | null = null;
    let resolvedCostUsd: number | null = null;
    try {
      const routeId = evidenceVariant ? evidenceRouteId(agentId) : agentId;
      const savedRoutes = snapshot.evidenceRouteChains?.[routeId] as ResumeRouteSnapshot[] | undefined;
      const previousRoutes = Array.isArray(snapshot.routeSnapshot)
        ? (snapshot.routeSnapshot as ResumeRouteSnapshot[]).filter(route => route.automation_id === routeId)
        : [];
      const frozenRoutes = savedRoutes?.length ? savedRoutes : previousRoutes;
      const oldPin = !frozenRoutes.length ? snapshot.evidenceRoutes?.[routeId] as EvidenceRoute | undefined : undefined;
      const evidence = evidenceVariant
        ? await prepareEvidenceStage(agentId, ctx,
          snapshot.forgeInputChars ?? stageSettings.forgeInputChars, snapshot.resumeMaxPages ?? stageSettings.resumeMaxPages)
        : null;
      if (evidence?.task && agentOptions.system_prompt) {
        evidence.task.system += "\nTask guidance: " + agentOptions.system_prompt;
      }
      if (evidence && !evidence.task) {
        agentOutput = await evidence.finish();
        resolvedProviderName = "deterministic";
        resolvedInputTokens = 0;
        resolvedOutputTokens = 0;
      } else {
        const deadline = new AbortController();
        const timeoutMs = agentOptions.timeout_ms ?? 300_000;
        const stageBudgetMs = stageTimeBudgetMs(agentId, timeoutMs);
        if (stageRuntime.resume_pipeline_settings != null && !await setStageDeadline(workflowId, lockVersion, stageBudgetMs)) {
          throw new Error("Workflow claim lost before setting its deadline");
        }
        const budgetTimer = setTimeout(() => deadline.abort(new Error("AI stage timed out at its whole-stage deadline")), stageBudgetMs);
        const heartbeatTimer = setInterval(() => {
          void updateWorkflowHeartbeat(workflowId, lockVersion).then(alive => {
            if (!alive) deadline.abort(new Error("Workflow claim was superseded"));
          }).catch(error => console.warn("Workflow heartbeat failed", { workflowId, code: error?.code }));
        }, 20_000);
        try {
          const allowOpenCodeFallback = oldPin?.provider === "anthropic" &&
            (agentId === "application_hiring_panel" || agentId === "application_final_polish");
          const forgeTask = agentId === "application_resume_forge" ? evidence?.task : null;
          const draftIdentity = (model: string, effort?: string | null) => {
            const reasoning = configuredOpenAiReasoningEffort(model, effort);
            return {
              candidateId: ctx.candidateId, jobId: ctx.job.id, model,
              base: ctx.baseResume.content, job: resolveJobDescription(ctx.job), verifiedSkills: ctx.verifiedSkills,
              promptVersion: agentConfig?.prompt_version ?? null,
              // Preserve existing checkpoints made with the default (Off).
              ...(reasoning && reasoning !== "none" ? { reasoningEffort: reasoning } : {}),
            };
          };
          const callCtx: CallContext = {
            userId: wf.started_by ?? undefined, workflowId, applicationId: wf.application_id,
            stageRunId: stageRun.id, promptVersion: agentConfig?.prompt_version ?? null,
            attemptNumber: stageAttemptNumber, routingStateId: snapshot.routingStateId ?? undefined,
            maxProviderAttempts: evidence ? (frozenRoutes.length === 1 && frozenRoutes[0].provider !== "opencode" ? 1 : 3) : 4,
            resumeEvidenceRoute: evidence
              ? oldPin ? { ...oldPin, allowOpenCodeFallback } : { routes: frozenRoutes.length ? frozenRoutes : undefined }
              : undefined,
            checkpointResumeDraft: forgeTask ? async (route, invoke) => {
              if (route.name !== "openai" || !isOpenAiLuna(route.model)) {
                return { result: await invoke(), reused: false };
              }
              return withResumeModelCheckpoint({
                workflowId, task: forgeTask, identity: draftIdentity(route.model, route.reasoningEffort),
              }, invoke);
            } : undefined,
            signal: deadline.signal,
          };
          const primary = frozenRoutes.at(0);
          const primaryProvider = primary?.provider ?? oldPin?.provider;
          const primaryModel = primary?.model_override ?? oldPin?.model;
          const cached = forgeTask && primaryProvider === "openai" && isOpenAiLuna(primaryModel)
            ? await findCompletedResumeModelCheckpoint<CallWithUsageTrackingResult<unknown>>({
                task: forgeTask, identity: draftIdentity(primaryModel, primary?.reasoning_effort),
              })
            : null;
          const runStage = () => callWithUsageTracking(routeId, callCtx, async (provider, route) => {
            if (evidence?.task) {
              const task = forgeTask && route && (route.name !== "openai" || !isOpenAiLuna(route.model))
                ? { ...evidence.task, system: evidence.task.system + ' Return JSON only with a "prioritize" array of evidence IDs.' }
                : evidence.task;
              const reasoningBudget = forgeTask && route?.name === "openai"
                ? forgeReasoningOutputBudget(configuredOpenAiReasoningEffort(route.model, route.reasoningEffort))
                : 0;
              const output = await sendEvidenceTask(task, provider, reasoningBudget ? {
                ...agentOptions,
                max_output_tokens: Math.max(agentOptions.max_output_tokens ?? 0, reasoningBudget),
              } : agentOptions);
              if (agentId === "application_resume_forge") {
                await evidence.finish(output);
                return output;
              }
              return evidence.finish(output);
            }
            return getAgentFn(agentId)(agentOptions, provider, ctx);
          });
          const call = cached
            ? { ...cached, providerName: "checkpoint", aiKeyId: null, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 }
            : await runStage();
          agentOutput = forgeTask ? await evidence!.finish(call.result) : call.result;
          resolvedProviderName = call.providerName;
          resolvedKeyId = call.aiKeyId;
          resolvedModel = call.model;
          resolvedInputTokens = call.inputTokens;
          resolvedOutputTokens = call.outputTokens;
          resolvedCostUsd = call.estimatedCostUsd;
        } finally {
          clearTimeout(budgetTimer);
          clearInterval(heartbeatTimer);
        }
      }
    } catch (err: any) {
      lastError = err;
      resolvedKeyId = null;
    }

    if (lastError || !agentOutput) {
      throw lastError ?? new Error("No output from agent");
    }

    if (!(await assertWorkflowClaim(workflowId, lockVersion))) {
      console.warn(`[Workflow ${workflowId}] provider returned after its claim was superseded; discarding stale output.`);
      // The provider call already succeeded and was billed - record that
      // explicitly instead of letting the spend vanish with no trace. This
      // is the leading hypothesis for Resume Forge/Hiring Panel/Final Polish
      // success-count asymmetry in ai_usage_events.
      await recordUsageEvent({
        automationId: agentId,
        aiKeyId: resolvedKeyId,
        provider: resolvedProviderName || "unknown",
        model: resolvedModel,
        outcome: "discarded",
        latencyMs: Date.now() - startMs,
        inputTokens: resolvedInputTokens,
        outputTokens: resolvedOutputTokens,
        errorMessage: "Workflow claim superseded before output could be saved",
        errorCode: "claim_lost",
        userId: wf.started_by ?? null,
        workflowId,
        applicationId: wf.application_id,
        attemptNumber: stageAttemptNumber,
        routeRank: null,
      }).catch(() => {});
      return;
    }

    const latencyMs = Date.now() - startMs;

    // B8 (2026-09-28): removed a dead minimum_score gate that checked for a
    // literal `score` key on agentOutput. None of the three real agent
    // outputs (ResumeDraftV1, ReviewScoreV1, FinalResumeV1) has a field named
    // exactly "score" - Hiring Panel's are atsScore/recruiterScore/
    // roleFitScore - so this never fired in production; ai_agent_configs's
    // minimum_score=6.0 seed for Hiring Panel was inert. Deleting rather than
    // wiring it to a real field: the nearby design (see the Hiring Panel
    // comment just below) is explicitly "never stop the pipeline here" -
    // activating a hard gate would contradict that and could fail workflows
    // that succeed today, for a config value nothing has ever enforced.

    // Resume Forge now also does the job-analysis work that used to be its
    // own "Job Lens" stage (see resumeForge.ts's analyzeJob()). It returns
    // both pieces; write them as two separate artifacts under this same
    // stage so every downstream reader (Hiring Panel, Final Polish,
    // finalizeWorkflow's scoring, requirementCoverage.ts, disposition.ts)
    // keeps finding an 'application_job_lens' artifact exactly where it
    // always has, with zero changes to any of them.
    const forgeOutput = agentId === "application_resume_forge" ? agentOutput : null;
    const output = forgeOutput ? forgeOutput.draft : agentOutput;
    const analysis = forgeOutput?.jobAnalysis;
    const savedArtifacts = await commitStageResult({
      workflowId, lockVersion, stageRunId: stageRun.id, sequence: currentIdx + 1,
      output: {
        automationId: agentId, schemaVersion: getSchemaVersion(agentId),
        digest: await sha256Hex(JSON.stringify(output)), data: output,
      },
      analysis: analysis ? {
        automationId: "application_job_lens", schemaVersion: getSchemaVersion("application_job_lens"),
        digest: await sha256Hex(JSON.stringify(analysis)), data: analysis,
      } : undefined,
      provider: resolvedProviderName, model: resolvedModel, keyId: resolvedKeyId,
      promptVersion: agentConfig?.prompt_version ?? null, inputTokens: resolvedInputTokens,
      outputTokens: resolvedOutputTokens, cost: resolvedCostUsd, latencyMs,
    });
    if (!savedArtifacts.length) return;

    // Phase 2 consumption point (c): Hiring Panel/Final Polish attach their
    // computed DeterministicQaResult as `.qa` on their own output (see
    // ReviewScoreV1.qa / FinalResumeV1.qa's doc comments); Resume Forge's
    // output ({ jobAnalysis, draft }) has no such field, so this is null for
    // that stage - nothing to QA before a draft exists.
    //
    // Deliberately a SEPARATE, best-effort update from the one above: this is
    // purely observational measurement data, and bundling it into the same
    // UPDATE meant a schema drift on this one optional column (confirmed
    // live: qa_facts shipped in code before its migration had actually run
    // against production) failed the ENTIRE stage completion - discarding an
    // already-generated, already-artifact-saved resume/review over a column
    // that exists only for reporting. Same "must never fail the pipeline
    // stage" convention as the jobs.job_analysis cache write-back above.
    const qaFacts = (agentOutput as any)?.qa ?? null;
    if (qaFacts) {
      try {
        await updateStageRun(stageRun.id, { qa_facts: JSON.stringify(qaFacts) });
      } catch (err: any) {
        console.warn(`[Workflow ${workflowId}] failed to persist qa_facts for stage ${agentId} (non-fatal): ${err?.message ?? err}`);
      }
    }

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
    if (currentIdx === agentOrder.length - 1) {
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
        // Pass the artifact list we already hold (previousArtifacts + the
        // one just created above) instead of letting finalizeWorkflow
        // re-query through Hyperdrive's cache - see comment in
        // finalizeWorkflow for why that re-query can miss this exact
        // artifact.
        const finalArtifacts = [...previousArtifacts, ...savedArtifacts];
        const missingStage = agentOrder.findIndex(agent => !finalArtifacts.some(artifact => artifact.automation_id === agent));
        if (missingStage >= 0) {
          await requeueFromMissingApplicationStage(workflowId, missingStage, lockVersion, finalArtifacts, agentOrder);
          return;
        }
        await finalizeWorkflow(workflowId, lockVersion, finalArtifacts);
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

    // The awaited one-minute Cloudflare Cron picks up the next queued stage.
    // Do not launch it through HTTP waitUntil: a full stage exceeds its
    // 30-second post-response execution window and would be orphaned.
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
    // Phase 5 (2026-09-28): a cooldown requeue deliberately never increments
    // stage_retry_count (provider capacity is not a content/agent attempt),
    // so without a separate bound it could requeue every 15 minutes forever
    // if the provider's capacity issue never clears (a genuinely exhausted
    // weekly quota, not a transient blip). 8 cycles = ~2 hours of patience
    // before converting it to a real, visible failure instead of a workflow
    // that silently never completes.
    const MAX_COOLDOWN_RETRIES = stageSettings.cooldownLimit;
    const cooldownRetryCount = wf.cooldown_retry_count ?? 0;
    const cooldownExhausted = isProviderCooldown && cooldownRetryCount >= MAX_COOLDOWN_RETRIES;
    const shouldRequeue = !(err instanceof ResumeModelCheckpointError) && (isProviderCooldown ? !cooldownExhausted : retryAttemptNumber < maxAttempts);

    // Provider capacity is not a content/agent attempt. Even if the normal
    // max_attempts budget was already consumed, leave the stage queued behind
    // a cooldown instead of converting a temporary 429 into a terminal
    // workflow failure - up to the cooldown budget above.
    if (shouldRequeue) {
      await updateWorkflowStatus(workflowId, "queued", {
        current_stage: currentIdx,
        last_error: err.message,
        stage_retry_count: isProviderCooldown ? (wf.stage_retry_count ?? 0) : retryAttemptNumber,
        cooldown_retry_count: isProviderCooldown ? cooldownRetryCount + 1 : cooldownRetryCount,
        next_retry_at: isProviderCooldown
          ? new Date(Date.now() + stageSettings.cooldownDelaySeconds * 1000).toISOString()
          : null,
      }, lockVersion);
      await syncWorkflowToApplication(workflowId, "queued");

      if (!isProviderCooldown) {
        // Ordinary failures retry immediately; capacity failures wait for the
        // persisted next_retry_at window instead of hammering the same key.
        // The queued retry is picked up by the awaited one-minute Cron.
      }
    } else {
      const finalMessage = cooldownExhausted
        ? `${err.message} (gave up after ${MAX_COOLDOWN_RETRIES} provider-capacity cooldown cycles)`
        : err.message;
      await updateWorkflowStatus(workflowId, "failed", { last_error: finalMessage }, lockVersion);
      await syncWorkflowToApplication(workflowId, "failed", undefined, finalMessage);
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
  const settings = resumePipelineSettings(await getAiRuntimeConfig());
  let count = 0;
  let lastDispatched: { id: string; current_stage: number } | null = null;

  console.log(`[Dispatch Chain] dispatchNextQueuedWorkflow started (WORKFLOWS_PER_DISPATCH_CALL=${WORKFLOWS_PER_DISPATCH_CALL})`);

  for (let i = 0; i < WORKFLOWS_PER_DISPATCH_CALL; i++) {
    const wf = await claimNextPendingWorkflow(settings.recoveryMode === "enabled");
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
      await recordDispatchFailure(wf, err, settings);
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
  await processWorkflowStage(workflowId, claimed.lock_version).catch(async error => {
    await recordDispatchFailure(claimed, error, resumePipelineSettings(await getAiRuntimeConfig()));
  });

  return { dispatched: true, workflowId, stage: wf.current_stage, count: 1 };
}

async function recordDispatchFailure(wf: WorkflowRow, error: unknown, settings: ReturnType<typeof resumePipelineSettings>) {
  const nextAttempt = (wf.stage_retry_count ?? 0) + 1;
  const status = nextAttempt >= settings.recoveryLimit ? "failed" : "queued";
  const message = `Dispatcher error: ${error instanceof Error ? error.message : String(error)}`;
  await query(
    `WITH changed AS (
       UPDATE application_ai_workflows w SET status = $3::text, last_error = $4,
         stage_retry_count = $5,
         next_retry_at = CASE WHEN $3::text = 'queued' THEN NOW() + make_interval(secs => $6) ELSE NULL END,
         claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL, heartbeat_at = NULL, updated_at = NOW()
       WHERE w.id = $1 AND w.lock_version = $2 AND w.status = 'running' AND w.claim_expires_at >= NOW()
       RETURNING w.id, w.application_id
     ), closed AS (
       UPDATE application_ai_stage_runs sr SET status = 'failed', completed_at = NOW(), error_code = 'dispatcher_error', error_message = $4
       FROM changed WHERE sr.workflow_id = changed.id AND sr.status = 'running'
     )
     UPDATE applications a SET resume_generation_status = $3::text, resume_generation_error = $4
       FROM changed WHERE a.id = changed.application_id AND a.ai_workflow_id = changed.id AND a.applied_at IS NULL`,
    [wf.id, wf.lock_version, status, message, nextAttempt, settings.recoveryDelaySeconds],
  );
}

function completedStageOutputIds(
  runs: Awaited<ReturnType<typeof listStageRuns>>,
  snapshot: { resumeReplayThrough?: Record<string, number> },
) {
  return new Set(runs.filter(run => run.status === "success"
    && run.attempt_number > (snapshot.resumeReplayThrough?.[run.sequence_number] ?? 0))
    .map(run => run.output_artifact_id));
}

function getAgentFn(id: ApplicationAgentId): (options: AgentOptions, provider: AiProvider, ctx: AgentContext) => Promise<any> {
  switch (id) {
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
    case "application_opportunity_reviewer": return "OpportunityReviewV2";
    case "application_release_editor": return "EvidenceReleaseV2";
    default: throw new Error(`Unknown agent ID: ${id}`);
  }
}

export async function cancelWorkflow(workflowId: string): Promise<boolean> {
  return transitionForRetry(workflowId, "cancel", null);
}

/**
 * Terminal-fails a workflow outright, independent of its current stage or
 * lock version - for a deliberate one-time cutover (e.g. stopping every
 * workflow still running the old pipeline right before deploying a new one),
 * not a normal per-stage failure path. Unlike cancelWorkflow, this leaves an
 * explicit error message so the Application Queue UI shows why, and unlike
 * retryWorkflow's target statuses, this can be called on a workflow that is
 * still 'queued' or 'running' right now. See scripts/stop-inflight-workflows.ts.
 */
export async function failWorkflowForCutover(workflowId: string, reason: string): Promise<void> {
  await updateWorkflowStatus(workflowId, "failed", { last_error: reason });
  await syncWorkflowToApplication(workflowId, "failed", undefined, reason);
}

/**
 * Re-pin a workflow to the currently active routing state without touching its
 * immutable job/resume/evidence inputs or its completed stage artifacts.
 *
 * Workflows intentionally keep a routing snapshot for replayability. That is
 * correct while a workflow is running, but a queued/terminal workflow should
 * not remain pinned to a provider configuration that has since been retired.
 * Queue repair calls this only before a new attempt is dispatched.
 */
export async function refreshWorkflowRoutingSnapshot(workflowId: string): Promise<boolean> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return false;

  const runtime = await getAiRuntimeConfig();
  if (!runtime.active_routing_state_id) return false;

  const routeSnapshot = await loadRoutingStateRoutes(runtime.active_routing_state_id);
  const previous = (wf.config_snapshot ?? {}) as Record<string, unknown>;
  const configSnapshot = {
    ...previous,
    ...(previous.pipelineVariant === RESUME_EVIDENCE_VARIANT
      ? { evidenceRouteChains: await snapshotEvidenceRoutes(routeSnapshot), evidenceRoutes: null }
      : {}),
    routingStateId: runtime.active_routing_state_id,
    routeSnapshot,
  };

  await execute(
    `UPDATE application_ai_workflows
        SET routing_state_id = $1,
            route_snapshot = $2::jsonb,
            config_snapshot = $3::jsonb,
            updated_at = NOW()
      WHERE id = $4
        AND status IN ('queued', 'failed', 'cancelled')`,
    [
      runtime.active_routing_state_id,
      JSON.stringify(routeSnapshot),
      JSON.stringify(configSnapshot),
      workflowId,
    ],
  );
  return true;
}

/** Retry a failed/cancelled workflow from its current stage (preserves progress). */
export async function retryWorkflow(workflowId: string): Promise<boolean> {
  return transitionForRetry(workflowId, "retry", null);
}

export async function restartWorkflow(workflowId: string): Promise<boolean> {
  return transitionForRetry(workflowId, "restart", null);
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<boolean> {
  return transitionForRetry(workflowId, "rerun", stage);
}

async function transitionForRetry(id: string, action: "retry" | "restart" | "rerun" | "cancel", stage: number | null) {
  const [runtime, workflow] = await Promise.all([
    getAiRuntimeConfig(),
    action === "cancel" ? null : findWorkflowById(id),
  ]);
  const settings = resumePipelineSettings(runtime);
  const previous = workflow?.config_snapshot as { pipelineVariant?: string } | null;
  let routing;
  if (previous?.pipelineVariant === RESUME_EVIDENCE_VARIANT) {
    const routingStateId = runtime.active_routing_state_id;
    const routeSnapshot = await loadRoutingStateRoutes(routingStateId);
    routing = { routingStateId, routeSnapshot, evidenceRouteChains: await snapshotEvidenceRoutes(routeSnapshot), evidenceRoutes: null };
  }
  return Boolean(await manualResumeTransition({ id, action, stage, staleHeartbeatSeconds: settings.staleHeartbeatSeconds, routing }));
}
