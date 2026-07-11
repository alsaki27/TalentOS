// Orchestrates the multi-agent application pipeline.
// Each stage is dispatched asynchronously by the dispatcher.

import type { AiProvider } from "@/lib/ai/provider";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { APPLICATION_AGENT_IDS, type ApplicationAgentId, type ProviderSnapshot, type AgentContext, type ArtifactRecord, type StageRunRecord } from "@/lib/ai/application-agents/types";
import { SCHEMA_VERSIONS } from "@/lib/ai/application-agents/constants";
import { runJobLens } from "@/lib/ai/application-agents/jobLens";
import { runResumeForge } from "@/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "@/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "@/lib/ai/application-agents/finalPolish";
import { evaluateQualityGate } from "@/lib/ai/application-agents/qualityGate";
import { finalizeWorkflow } from "@/lib/ai/application-agents/finalizationService";
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
  type ArtifactRow,
} from "@/server/repositories/applicationAiWorkflowRepository";

function sha256(input: string): string {
  // Simple content hash (not cryptographic for this use case)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

function buildAgentContext(
  applicationId: string,
  candidateId: string,
  job: any,
  baseResume: any,
  evidence: any[],
  previousOutputs: ArtifactRow[]
): AgentContext {
  const mapped: ArtifactRecord[] = previousOutputs.map((a) => ({
    id: a.id,
    automationId: a.automation_id,
    sequenceNumber: a.sequence_number,
    schemaVersion: a.schema_version,
    contentHash: a.content_hash,
    data: a.data,
    createdAt: a.created_at,
  }));
  const outputsMap: Record<string, ArtifactRecord> = {};
  for (const a of mapped) {
    outputsMap[a.automationId] = a;
  }
  return { applicationId, candidateId, job, baseResume, evidence, previousOutputs: outputsMap };
}

export async function startWorkflow(input: {
  applicationId: string;
  candidateId: string;
  job: any;
  baseResume: any;
  evidence: any[];
  idempotencyKey?: string;
  startedBy?: string;
}): Promise<{ workflowId: string }> {
  const wf = await createWorkflow({
    applicationId: input.applicationId,
    baseResumeId: input.baseResume?.id,
    idempotencyKey: input.idempotencyKey,
    startedBy: input.startedBy,
  });
  return { workflowId: wf.id };
}

export async function processWorkflowStage(workflowId: string): Promise<void> {
  const wf = await findWorkflowById(workflowId);
  if (!wf || wf.status !== "running") return;

  const agentOrder = APPLICATION_AGENT_IDS;
  const currentIdx = wf.current_stage;

  if (currentIdx >= agentOrder.length) {
    await finalizeWorkflow(workflowId);
    return;
  }

  const agentId = agentOrder[currentIdx];
  const previousRuns = await listStageRuns(workflowId);
  const previousArtifacts = await listArtifacts(workflowId);
  const attemptNumber = previousRuns.filter((r) => r.automation_id === agentId && r.sequence_number === currentIdx + 1).length + 1;

  let stageRun = await createStageRun({
    workflowId,
    automationId: agentId,
    sequenceNumber: currentIdx + 1,
    attemptNumber,
  });

  try {
    await updateStageRun(stageRun.id, { status: "running", started_at: new Date().toISOString() });

    const { result: agentOutput, providerName, aiKeyId, model } = await callWithUsageTracking(
      agentId,
      undefined,
      async (provider: AiProvider) => {
        const agentFn = getAgentFn(agentId);
        const ctx = buildAgentContext(
          wf.application_id,
          "", // candidateId will be filled from application lookup
          {},
          {},
          [],
          previousArtifacts
        );
        return agentFn({}, provider, ctx);
      }
    );

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
      provider: providerName,
      model: model ?? null,
      ai_key_id: aiKeyId,
      output_artifact_id: artifact.id,
      completed_at: new Date().toISOString(),
    });

    // Run quality gate after Hiring Panel
    if (agentId === "application_hiring_panel") {
      const gateResult = await evaluateQualityGate(agentOutput as import("@/lib/ai/application-agents/schemas").ReviewScoreV1, wf.application_id);
      if (!gateResult.passed) {
        await updateWorkflowStatus(workflowId, "waiting", {
          current_stage: currentIdx + 2,
          last_error: gateResult.reason ?? undefined,
        });
        return;
      }
    }

    // Final polish complete → finalize
    if (agentId === "application_final_polish") {
      await finalizeWorkflow(workflowId);
      return;
    }

    await updateWorkflowStatus(workflowId, "running", { current_stage: currentIdx + 1 });
  } catch (err: any) {
    await updateStageRun(stageRun.id, {
      status: "failed",
      error_message: err.message ?? "Unknown error",
      completed_at: new Date().toISOString(),
    });

    // Retry logic
    if (attemptNumber < 3) {
      await updateWorkflowStatus(workflowId, "queued", { last_error: err.message });
    } else {
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
  await updateWorkflowStatus(workflowId, "queued", { current_stage: 0 });
}

export async function rerunFromStage(workflowId: string, stage: number): Promise<void> {
  await updateWorkflowStatus(workflowId, "queued", { current_stage: Math.max(0, stage) });
}
