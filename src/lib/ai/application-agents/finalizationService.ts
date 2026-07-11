// Finalization service — creates application_resume_versions, updates packets, logs activity.
// Called when a workflow completes successfully.

import { updateWorkflowStatus, listArtifacts } from "@/server/repositories/applicationAiWorkflowRepository";
import { execute, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";

export async function finalizeWorkflow(workflowId: string): Promise<void> {
  const artifacts = await listArtifacts(workflowId);

  // Find the workflow + application (to get candidate_id)
  const wf = await queryOne<{ id: string; application_id: string; candidate_id: string; base_resume_id: string | null }>(
    `SELECT w.id, w.application_id, a.candidate_id, w.base_resume_id
     FROM application_ai_workflows w
     JOIN applications a ON w.application_id = a.id
     WHERE w.id = $1`,
    [workflowId]
  );
  if (!wf) throw new Error(`Workflow not found: ${workflowId}`);

  // Get the final resume artifact (from Final Polish)
  const finalArtifact = artifacts.find((a) => a.automation_id === "application_final_polish");
  const draftArtifact = artifacts.find((a) => a.automation_id === "application_resume_forge");
  const finalData = finalArtifact?.data ?? draftArtifact?.data;

  if (!finalData) {
    await updateWorkflowStatus(workflowId, "failed", { last_error: "No final resume artifact found" });
    return;
  }

  // Create application_resume_versions row (uses candidate_id, not application_id)
  const versionRows = await execute(
    `INSERT INTO application_resume_versions
      (candidate_id, title, content, source_type, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id`,
    [wf.candidate_id, "AI-Generated Tailored Resume", JSON.stringify(finalData), "ai_generated"]
  );

  // Log activity
  await logActivity({
    userId: undefined,
    actorName: "AI Agent Pipeline",
    type: "update",
    description: `Multi-agent workflow completed for application ${wf.application_id}`,
    entityType: "application",
    entityId: wf.application_id,
    entityName: `Workflow ${workflowId}`,
    metadata: { workflowId, artifactCount: artifacts.length },
  });

  // Trigger webhooks
  await triggerWebhooks("application.resume_generated", {
    applicationId: wf.application_id,
    workflowId,
    versionId: versionRows,
  });

  await updateWorkflowStatus(workflowId, "completed");
}
