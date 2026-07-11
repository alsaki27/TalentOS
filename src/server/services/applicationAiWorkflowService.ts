// Orchestrates the multi-agent application pipeline.
// Each stage runs synchronously, then dispatches the next stage.
// Uses ai_agent_configs for runtime parameters.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { APPLICATION_AGENT_IDS, type ApplicationAgentId, type AgentContext, type ArtifactRecord } from "@/lib/ai/application-agents/types";
import { SCHEMA_VERSIONS } from "@/lib/ai/application-agents/constants";
import { runJobLens } from "@/lib/ai/application-agents/jobLens";
import { runResumeForge } from "@/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "@/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "@/lib/ai/application-agents/finalPolish";
import { evaluateQualityGate } from "@/lib/ai/application-agents/qualityGate";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
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
  type ArtifactRow,
  type WorkflowRow,
} from "@/server/repositories/applicationAiWorkflowRepository";
import { query } from "@/server/db/neon";

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
 * Process exactly one stage for a workflow.
 * - Transitions from 'queued' → 'running' automatically.
 * - After successful stage, dispatches the next stage.
 * - Retries on failure up to configured max_attempts.
 * - On final failure, marks workflow as failed.
 * - Implements runtime provider fallback (up to 3 route attempts).
 */
export async function processWorkflowStage(workflowId: string, _routeAttempt: number = 1): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return;

  // Accept both queued and running states (auto-start from queued)
  if (wf.status !== "queued" && wf.status !== "running") return;

  // Transition queued → running + update application status
  if (wf.status === "queued") {
    await updateWorkflowStatus(workflowId, "running", { current_stage: 0, last_error: null } as any);
    await query("UPDATE applications SET resume_generation_status = $1, ai_workflow_id = $2, resume_generation_started_at = NOW() WHERE id = $3",
      ["job_analysis", workflowId, wf.application_id]);
  }

  const agentOrder = APPLICATION_AGENT_IDS;
  const currentIdx = wf.current_stage;

  // Completed all stages
  if (currentIdx >= agentOrder.length) {
    await finalizeWorkflow(workflowId);
    return;
  }

  const agentId = agentOrder[currentIdx];
  const agentConfig = await findAgentConfigByAutomationId(agentId);
  const maxAttempts = agentConfig?.max_attempts ?? 2;

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

    const ctx = await buildAgentContext(wf, previousArtifacts);
    const startMs = Date.now();

    // Call with provider fallback (up to 3 route attempts)
    let lastError: Error | null = null;
    let agentOutput: any = null;
    let resolvedProviderName = "";
    let resolvedKeyId: string | null = null;
    let resolvedModel: string | null = null;

    for (let fallbackAttempt = 1; fallbackAttempt <= 3; fallbackAttempt++) {
      try {
        const callResult = await callWithUsageTracking(
          agentId,
          { userId: wf.started_by ?? undefined },
          async (provider: AiProvider) => {
            const agentFn = getAgentFn(agentId);
            return agentFn({}, provider, ctx);
          }
        );
        agentOutput = callResult.result;
        resolvedProviderName = callResult.providerName;
        resolvedKeyId = callResult.aiKeyId;
        resolvedModel = callResult.model;
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (fallbackAttempt < 3) {
          // Brief delay before retry
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (lastError || !agentOutput) {
      throw lastError ?? new Error("No output from agent");
    }

    const latencyMs = Date.now() - startMs;

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
      await query("UPDATE applications SET resume_generation_status = 'resume_review' WHERE id = $1", [wf.application_id]);
      const gateResult = await evaluateQualityGate(
        agentOutput as import("@/lib/ai/application-agents/schemas").ReviewScoreV1,
        wf.application_id
      );
      if (!gateResult.passed) {
        const isHardFail = gateResult.action === "fail";
        await query("UPDATE applications SET resume_generation_status = $1, resume_generation_error = $2 WHERE id = $3",
          [isHardFail ? "failed" : "human_review", gateResult.reason ?? null, wf.application_id]);
        await updateWorkflowStatus(workflowId, isHardFail ? "failed" : "waiting", {
          current_stage: currentIdx + 1,
          last_error: gateResult.reason ?? undefined,
        });
        return; // Stop — waiting for human review or hard failed
      }
    }

    // Final polish complete → finalize
    if (agentId === "application_final_polish") {
      await finalizeWorkflow(workflowId);
      return;
    }

    // Advance and dispatch next stage
    await updateWorkflowStatus(workflowId, "running", { current_stage: currentIdx + 1 });
    await processWorkflowStage(workflowId); // Recursively dispatch next stage
  } catch (err: any) {
    await updateStageRun(stageRun.id, {
      status: "failed",
      error_message: err.message ?? "Unknown error",
      completed_at: new Date().toISOString(),
    });

    // Retry with incremented attempt_number
    if (attemptNumber < maxAttempts) {
      // Re-queue for retry — next invocation will create attempt+1
      await updateWorkflowStatus(workflowId, "queued", {
        current_stage: currentIdx,
        last_error: err.message,
      });
    } else {
      // Maxed out — fail permanently
      await updateWorkflowStatus(workflowId, "failed", { last_error: err.message });
    }
  }
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
}

export async function retryWorkflow(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || (wf.status !== "failed" && wf.status !== "cancelled")) return;
  await updateWorkflowStatus(workflowId, "queued", { current_stage: 0 });
  await processWorkflowStage(workflowId);
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf) return;
  await updateWorkflowStatus(workflowId, "queued", { current_stage: Math.max(0, stage) });
  await processWorkflowStage(workflowId);
}
