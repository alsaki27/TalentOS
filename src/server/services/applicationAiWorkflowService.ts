// Orchestrates the multi-agent application pipeline.
// Each stage runs in a single invocation, then the dispatcher picks up the next.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking, AiRouteCallError, type CallContext } from "@/lib/ai/routing";
import { APPLICATION_AGENT_IDS, type ApplicationAgentId, type AgentContext, type ArtifactRecord } from "@/lib/ai/application-agents/types";
import { SCHEMA_VERSIONS } from "@/lib/ai/application-agents/constants";
import { runJobLens } from "@/lib/ai/application-agents/jobLens";
import { runResumeForge } from "@/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "@/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "@/lib/ai/application-agents/finalPolish";
import { evaluateQualityGate } from "@/lib/ai/application-agents/qualityGate";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
import type { AgentOptions } from "@/lib/ai/application-agents/types";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import {
  createWorkflow,
  findWorkflowById,
  updateWorkflowStatus,
  createStageRun,
  updateStageRun,
  createArtifact,
  listStageRuns,
  listArtifacts,
  claimNextPendingWorkflow,
  updateWorkflowHeartbeat,
  type ArtifactRow,
  type WorkflowRow,
} from "@/server/repositories/applicationAiWorkflowRepository";
import { query, queryOne } from "@/server/db/neon";

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
  idempotencyKey?: string;
  startedBy?: string;
}): Promise<{ workflowId: string }> {
  const configSnapshot = {
    candidateId: input.candidateId,
    job: input.job,
    baseResume: input.baseResume,
    evidence: input.evidence,
  };

  const wf = await createWorkflow({
    applicationId: input.applicationId,
    baseResumeId: input.baseResume?.id,
    idempotencyKey: input.idempotencyKey,
    configSnapshot,
    startedBy: input.startedBy,
  });
  return { workflowId: wf.id };
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
  if (!wf) return;

  if (wf.status !== "queued" && wf.status !== "running") return;

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

  const agentOptions: AgentOptions = {
    system_prompt: agentConfig?.system_prompt ?? undefined,
    temperature: agentConfig?.temperature ?? undefined,
    max_output_tokens: agentConfig?.max_output_tokens ?? undefined,
    timeout_ms: agentConfig?.timeout_ms ?? undefined,
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

    console.log(`\n━━━ [Pipeline] Stage ${currentIdx}: ${agentId} ━━━`);
    console.log(`[Pipeline] ${agentId} INPUT:`, JSON.stringify({
      job: { title: ctx.job?.title, company: ctx.job?.company },
      baseResumeKeys: Object.keys(ctx.baseResume ?? {}),
      evidenceCount: ctx.evidence?.length ?? 0,
      previousOutputs: Object.keys(ctx.previousOutputs),
      previousDataKeys: Object.fromEntries(
        Object.entries(ctx.previousOutputs).map(([k, v]) => [k, Object.keys(v?.data ?? {})])
      ),
    }, null, 2));

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
        const callResult = await callWithUsageTracking(
          agentId,
          callCtx,
          async (provider: AiProvider) => {
            const agentFn = getAgentFn(agentId);
            return agentFn(agentOptions, provider, ctx);
          },
          failedKeyIds.size > 0 ? failedKeyIds : undefined,
        );
        agentOutput = callResult.result;
        resolvedProviderName = callResult.providerName;
        resolvedKeyId = callResult.aiKeyId;
        resolvedModel = callResult.model;
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (err instanceof AiRouteCallError && err.aiKeyId) {
          failedKeyIds.add(err.aiKeyId);
        }
        resolvedKeyId = null;
        if (fallbackAttempt < 3) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (lastError || !agentOutput) {
      console.log(`[Pipeline] ${agentId} FAILED:`, lastError?.message);
      throw lastError ?? new Error("No output from agent");
    }

    console.log(`[Pipeline] ${agentId} OUTPUT:`, JSON.stringify(agentOutput).slice(0, 2000));
    console.log(`[Pipeline] ${agentId} latency: ${Date.now() - startMs}ms`);

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

    // Quality gate after Hiring Panel
    if (agentId === "application_hiring_panel") {
      await syncWorkflowToApplication(workflowId, "running", currentIdx + 1);
      const gateResult = await evaluateQualityGate(
        agentOutput as import("@/lib/ai/application-agents/schemas").ReviewScoreV1,
        wf.application_id
      );
      if (!gateResult.passed) {
        const isHardFail = gateResult.action === "fail";
        await syncWorkflowToApplication(workflowId, isHardFail ? "failed" : "waiting", undefined, gateResult.reason ?? undefined);
        await updateWorkflowStatus(workflowId, isHardFail ? "failed" : "waiting", {
          current_stage: currentIdx + 1,
          last_error: gateResult.reason ?? undefined,
        });
        return;
      }
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

    // Advance to next stage and continue the cascade
    await continueToNextStage(workflowId, currentIdx + 1);
    await syncWorkflowToApplication(workflowId, "queued");
    await processWorkflowStage(workflowId);
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
    } else {
      await updateWorkflowStatus(workflowId, "failed", { last_error: err.message });
      await syncWorkflowToApplication(workflowId, "failed", undefined, err.message);
    }
  }
}

/** Claim and process up to 3 queued workflows per invocation to clear backlogs.
 *  Returns dispatch result metadata with the count of workflows processed. */
export async function dispatchNextQueuedWorkflow(): Promise<DispatchResult> {
  let count = 0;
  let lastDispatched: { id: string; current_stage: number } | null = null;

  for (let i = 0; i < 3; i++) {
    const wf = await claimNextPendingWorkflow();
    if (!wf) break;
    lastDispatched = wf;
    count++;

    if (wf.recovery_count >= 3 && wf.status === 'failed') {
      await syncWorkflowToApplication(wf.id, 'failed', undefined, 'Workflow failed after 3 recovery attempts');
      continue;
    }

    try {
      await processWorkflowStage(wf.id);
    } catch (err: any) {
      console.error(`[Dispatch] Workflow ${wf.id} stage processing failed:`, err);
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

  const claimed = await queryOne(
    `UPDATE application_ai_workflows 
     SET status = 'running', claimed_at = NOW(), claim_expires_at = NOW() + INTERVAL '5 minutes',
         claimed_by = 'dispatcher', heartbeat_at = NOW(), lock_version = lock_version + 1
     WHERE id = $1 AND (status = 'queued' OR (status = 'running' AND claim_expires_at < NOW()))
     RETURNING id`,
    [workflowId]
  );
  if (!claimed) {
    return { dispatched: false, workflowId, stage: wf.current_stage, count: 0, message: "Workflow already claimed by another dispatcher" };
  }

  await processWorkflowStage(workflowId);

  return { dispatched: true, workflowId, stage: wf.current_stage, count: 1 };
}

function getAgentFn(id: ApplicationAgentId) {
  switch (id) {
    case "application_job_lens": return runJobLens;
    case "application_resume_forge": return runResumeForge;
    case "application_hiring_panel": return runHiringPanel;
    case "application_final_polish": return runFinalPolish;
  }
}

function getSchemaVersion(id: ApplicationAgentId): string {
  switch (id) {
    case "application_job_lens": return SCHEMA_VERSIONS.jobAnalysis;
    case "application_resume_forge": return SCHEMA_VERSIONS.resumeDraft;
    case "application_hiring_panel": return SCHEMA_VERSIONS.reviewScore;
    case "application_final_polish": return SCHEMA_VERSIONS.finalResume;
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
  await updateWorkflowStatus(workflowId, "queued", { current_stage: 0 });
  await syncWorkflowToApplication(workflowId, "queued");
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return;
  await updateWorkflowStatus(workflowId, "queued", { current_stage: Math.max(0, stage) });
  await syncWorkflowToApplication(workflowId, "queued");
}
