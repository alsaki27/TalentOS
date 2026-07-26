// Orchestrates the multi-agent application pipeline.
// Each stage runs in a single invocation, then the dispatcher picks up the next.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking, AiRouteCallError, type CallContext } from "@/lib/ai/routing";
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
  claimNextPendingWorkflow,
  updateWorkflowHeartbeat,
  MAX_CONCURRENT_AI_WORKFLOWS,
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
  // Config snapshot bundles all inputs needed by agents
  const configSnapshot = {
    candidateId: input.candidateId,
    job: input.job,
    baseResume: input.baseResume,
    evidence: input.evidence,
    verifiedSkills: input.verifiedSkills ?? [],
    sourceOfTruth: input.sourceOfTruth ?? null,
  };

  const wf = await createWorkflow({
    applicationId: input.applicationId,
    baseResumeId: input.baseResume?.base_resume_id ?? null,
    idempotencyKey: input.idempotencyKey,
    configSnapshot,
    startedBy: input.startedBy,
    matchScore: input.matchScore,
    matchReason: input.matchReason,
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

  const baseUrl = process.env.TALENTOS_BASE_URL || 'https://skarion-talent-os.skarion-talentos.workers.dev';
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
  return { started: true, workflowId };
}

/** Build agent context from the immutable workflow snapshot + previous artifacts. */
async function buildAgentContext(wf: WorkflowRow, previousArtifacts: ArtifactRow[]): Promise<AgentContext> {
  const snapshot = (wf.config_snapshot ?? {}) as any;
  const mapped = mapArtifacts(previousArtifacts);
  const outputsMap: Record<string, ArtifactRecord> = {};
  for (const a of mapped) outputsMap[a.automationId] = a;

  return {
    applicationId: wf.application_id,
    candidateId: snapshot.candidateId ?? "",
    job: snapshot.job ?? {},
    baseResume: snapshot.baseResume ?? {},
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
async function continueToNextStage(workflowId: string, nextStage: number): Promise<number> {
  await updateWorkflowStatus(workflowId, "queued", { current_stage: nextStage });
  await updateWorkflowHeartbeat(workflowId);
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
 * - After successful stage, re-queues for the next stage via continueToNextStage().
 * - Retries on failure up to configured max_attempts.
 * - On final failure, marks workflow as failed.
 * - Implements runtime provider fallback (up to 3 distinct route attempts).
 * - Does NOT recurse — the dispatcher picks up the next stage.
 * - Checks for cancellation before and after the provider call.
 */
export async function processWorkflowStage(workflowId: string, _routeAttempt: number = 1): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) {
    console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} not found.`);
    return;
  }

  console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} status=${wf.status}, stage=${wf.current_stage}`);

  if (wf.status !== "queued" && wf.status !== "running") {
    console.log(`[Dispatch Chain] processWorkflowStage: workflow ${workflowId} skipped (status is ${wf.status}, not queued/running).`);
    return;
  }

  if (wf.status === "queued") {
    await updateWorkflowStatus(workflowId, "running", { current_stage: wf.current_stage, last_error: null } as any);
    await syncWorkflowToApplication(workflowId, "running", wf.current_stage);
    if (wf.current_stage === 0) {
      await query("UPDATE applications SET ai_workflow_id = $1, resume_generation_started_at = NOW() WHERE id = $2",
        [workflowId, wf.application_id]);
    }
  }

  const agentOrder = APPLICATION_AGENT_IDS;
  const currentIdx = wf.current_stage;

  if (currentIdx >= agentOrder.length) {
    await finalizeWorkflow(workflowId);
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
    });
    await updateStageRun(stageRun.id, {
      status: "failed",
      error_message: `Agent "${agentId}" is disabled via ai_agent_configs.is_active`,
      completed_at: new Date().toISOString(),
    });
    await updateWorkflowStatus(workflowId, "failed", { last_error: `Agent "${agentId}" is disabled` });
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
  });

  try {
    await updateStageRun(stageRun.id, { status: "running", started_at: new Date().toISOString() });
    await updateWorkflowHeartbeat(workflowId);

    // Check for cancellation before invoking the provider
    const currentWf = await findWorkflowById(workflowId);
    if (currentWf?.status === "cancelled") {
      await updateStageRun(stageRun.id, { status: "cancelled" });
      await syncWorkflowToApplication(workflowId, "cancelled");
      return;
    }

    const ctx = await buildAgentContext(wf, previousArtifacts);
    const startMs = Date.now();

    // Provider fallback: try up to 3 distinct routes, tracking failed key IDs.
    let lastError: Error | null = null;
    let agentOutput: any = null;
    let resolvedProviderName = "";
    let resolvedKeyId: string | null = null;
    let resolvedModel: string | null = null;
    const failedKeyIds = new Set<string>();

    for (let fallbackAttempt = 1; fallbackAttempt <= 3; fallbackAttempt++) {
      try {
        const callCtx: CallContext = {
          userId: wf.started_by ?? undefined,
          workflowId,
          applicationId: wf.application_id,
          attemptNumber,
        };
        // ai_agent_configs.timeout_ms was threaded through to AgentOptions
        // but never actually enforced anywhere - a hung upstream fetch (no
        // AbortController on any provider's fetch call) could block a claim
        // slot indefinitely instead of failing and freeing it up for retry.
        // Racing against a timeout here doesn't cancel the underlying fetch
        // (providers don't accept an abort signal), but it does let the
        // pipeline move on, record a clear timeout error, and retry/fail
        // cleanly instead of hanging past the claim TTL with no diagnostic.
        const timeoutMs = agentOptions.timeout_ms ?? 300_000;
        const callResult = await Promise.race([
          callWithUsageTracking(
            agentId,
            callCtx,
            async (provider: AiProvider) => {
              const agentFn = getAgentFn(agentId);
              return agentFn(agentOptions, provider, ctx);
            },
            failedKeyIds.size > 0 ? failedKeyIds : undefined,
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Agent call timed out after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);
        agentOutput = callResult.result;
        resolvedProviderName = callResult.providerName;
        resolvedKeyId = callResult.aiKeyId;
        resolvedModel = callResult.model;
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        // Only blacklist the key/route for a real provider-side failure
        // (auth, rate limit, timeout, server error - anything classifyErrorCode
        // in routing.ts recognizes). callWithUsageTracking wraps EVERY error
        // thrown inside fn - including an agent's own content-validation
        // rejection (e.g. Final Polish's "wiped the entire experience section
        // ... rejecting") - into an AiRouteCallError carrying the key that was
        // used, indistinguishable from an actual API failure. Blacklisting on
        // that meant one bad generation exhausted BOTH configured routes
        // (neither route was actually broken) and the 3rd fallback attempt hit
        // an empty route list, throwing the generic "All configured routes
        // failed and global fallback is disabled" - which overwrote the real,
        // useful validation error as the stage's recorded last_error. Confirmed
        // live via ai_usage_events: the true error was a content rejection, not
        // a routing/key problem, on both the primary and backup key. Errors
        // with no classifiable errorCode (validation/business-logic throws)
        // now just retry the same route instead of blacklisting it.
        if (err instanceof AiRouteCallError && err.aiKeyId && err.errorCode) {
          failedKeyIds.add(err.aiKeyId);
        }
        resolvedKeyId = null;
        if (fallbackAttempt < 3) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (lastError || !agentOutput) {
      throw lastError ?? new Error("No output from agent");
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

    await updateStageRun(stageRun.id, {
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
        await updateStageRun(stageRun.id, { status: "cancelled" });
        await syncWorkflowToApplication(workflowId, "cancelled");
        return;
      }
      await finalizeWorkflow(workflowId);
      return;
    }

    // Advance to next stage and re-queue
    await continueToNextStage(workflowId, currentIdx + 1);
    await syncWorkflowToApplication(workflowId, "queued");

    // Immediately dispatch the next stage so the pipeline doesn't stall
    // between stages waiting for the 5-minute cron dispatcher.
    // Making an HTTP fetch to ourselves guarantees a fresh Cloudflare invocation
    // with a reset 50-subrequest limit.
    const baseUrl = process.env.TALENTOS_BASE_URL || 'https://skarion-talent-os.skarion-talentos.workers.dev';
    await backgroundDispatch(
      fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
        method: 'POST'
      }).catch((err) => {
        console.error(`[Workflow ${workflowId}] Continue to stage ${currentIdx + 1} fetch failed:`, err);
      })
    );
  } catch (err: any) {
    await updateStageRun(stageRun.id, {
      status: "failed",
      error_message: err.message ?? "Unknown error",
      completed_at: new Date().toISOString(),
    });

    if (attemptNumber < maxAttempts) {
      await updateWorkflowStatus(workflowId, "queued", {
        current_stage: currentIdx,
        last_error: err.message,
      });
      await syncWorkflowToApplication(workflowId, "queued");

      // Continue retry immediately — don't wait for cron
      const baseUrl = process.env.TALENTOS_BASE_URL || 'https://skarion-talent-os.skarion-talentos.workers.dev';
      await backgroundDispatch(
        fetch(`${baseUrl}/api/application-ai-workflows/dispatch`, {
          method: 'POST'
        }).catch((retryErr) => {
          console.error(`[Workflow ${workflowId}] Retry dispatch fetch failed:`, retryErr);
        })
      );
    } else {
      await updateWorkflowStatus(workflowId, "failed", { last_error: err.message });
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
      await updateWorkflowStatus(wf.id, "running", { last_error: message } as any).catch(() => {});
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
  const claimed = await queryOne(
    `UPDATE application_ai_workflows
     SET status = 'running', claimed_at = NOW(), claim_expires_at = NOW() + INTERVAL '2 minutes',
         claimed_by = 'dispatcher', heartbeat_at = NOW(), updated_at = NOW(), lock_version = lock_version + 1
     WHERE id = $1
       AND (status = 'queued' OR (status = 'running' AND claim_expires_at < NOW()))
       AND (
         status != 'queued'
         OR (SELECT COUNT(*)::int FROM application_ai_workflows
             WHERE status = 'running' AND claim_expires_at IS NOT NULL AND claim_expires_at >= NOW()) < $2
       )
     RETURNING id`,
    [workflowId, MAX_CONCURRENT_AI_WORKFLOWS]
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

export async function cancelWorkflow(workflowId: string): Promise<void> {
  await updateWorkflowStatus(workflowId, "cancelled");
  await syncWorkflowToApplication(workflowId, "cancelled");
}

/** Retry a failed/cancelled workflow from its current stage (preserves progress). */
export async function retryWorkflow(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || (wf.status !== "failed" && wf.status !== "cancelled")) return;
  await updateWorkflowStatus(workflowId, "queued");
  await syncWorkflowToApplication(workflowId, "queued");
}

/** Restart a failed/cancelled workflow from stage 0 (discards all progress). */
export async function restartWorkflow(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || (wf.status !== "failed" && wf.status !== "cancelled")) return;
  await query(
    "DELETE FROM application_ai_stage_runs WHERE workflow_id = $1",
    [workflowId]
  );
  await query(
    "DELETE FROM application_ai_artifacts WHERE workflow_id = $1",
    [workflowId]
  );
  await updateWorkflowStatus(workflowId, "queued", { current_stage: 0 });
  await syncWorkflowToApplication(workflowId, "queued");
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return;
  await updateWorkflowStatus(workflowId, "queued", { current_stage: Math.max(0, stage) });
  await syncWorkflowToApplication(workflowId, "queued");
}
