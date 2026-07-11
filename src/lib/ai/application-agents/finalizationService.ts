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
  // target_job_id is NOT NULL in the schema — derive from the application's target_jobs
  const tj = await queryOne<{ id: string }>(
    `SELECT id FROM target_jobs WHERE candidate_id = $1 AND job_id = (SELECT job_id FROM applications WHERE id = $2) LIMIT 1`,
    [wf.candidate_id, wf.application_id]
  );
  if (!tj) throw new Error(`No target_job found for candidate ${wf.candidate_id} in application ${wf.application_id}`);

  const versionRows = await execute(
    `INSERT INTO application_resume_versions
      (candidate_id, target_job_id, title, content, source_type, status, created_at)
     VALUES ($1, $2, $3, $4, $5, 'draft', NOW())
     RETURNING id`,
    [wf.candidate_id, tj.id, "AI-Generated Tailored Resume", JSON.stringify(finalData), "manual"]
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
